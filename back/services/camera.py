import asyncio
import logging
import threading
import time

import av
import cv2
import numpy as np
from aiortc import VideoStreamTrack

from back.config import config
from back.schemas import DetectionItem, FrameDetectionPayload
from back.services.perception import counter
from back.services.perception.inference_client import InferenceClient

logger = logging.getLogger("webrtc")

pcs = set()
processing_enabled = True

# Serializes camera open/release transitions across sessions so V4L2 never
# sees a new open() while a previous session's buffers are still live.
_camera_lock = threading.Lock()


async def close_all_connections() -> None:
    """Close all existing peer connections, which stops their tracks."""
    for pc in list(pcs):
        await pc.close()
    pcs.clear()
    logger.info("All connections closed")


class _InferenceWorker:
    """Runs inference via the socket-based worker, decoupled from the stream."""

    def __init__(self) -> None:
        self._frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._running = False
        self._thread: threading.Thread | None = None
        self._client = InferenceClient(config.perception.socket_path)

        # Latest result, consumed by recv() in the event loop
        self._result: FrameDetectionPayload | None = None
        self._result_lock = threading.Lock()

    def start(self) -> None:
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info("Inference worker started")

    def stop(self) -> None:
        self._running = False
        self._event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        logger.info("Inference worker stopped")

    def submit_frame(self, frame: np.ndarray) -> None:
        """Submit a frame for inference (non-blocking, drops old frames)."""
        with self._lock:
            self._frame = frame
        self._event.set()

    def consume_result(self) -> FrameDetectionPayload | None:
        """Get the latest inference result (called from recv in event loop)."""
        with self._result_lock:
            result = self._result
            self._result = None
            return result

    def _run(self) -> None:
        while self._running:
            self._event.wait(timeout=1.0)
            self._event.clear()

            with self._lock:
                frame = self._frame
                self._frame = None

            if frame is None:
                continue

            session = counter.get_active_session()
            if not processing_enabled or session is None:
                continue

            try:
                target_class = session.target_class
                conf = config.counting.confidence_threshold
                response = self._client.detect(frame, target_class, conf)

                if response is None:
                    continue

                detections = response.get("detections", [])
                tracking_data = response.get("tracking_data", [])
                count = response.get("count", 0)

                counter.update(tracking_data)
                logger.info("Inference: %d detections, count=%d", len(detections), count)

                payload = FrameDetectionPayload(
                    count=count,
                    target_class=target_class,
                    detections=[DetectionItem(**d) for d in detections],
                    session_active=True,
                    session_total=session.last_frame_count,
                )
                with self._result_lock:
                    self._result = payload

            except Exception:
                logger.warning("Inference failed, stream continues", exc_info=True)
                error_payload = FrameDetectionPayload(
                    count=0,
                    target_class="",
                    detections=[],
                    session_active=True,
                    error="inference error",
                )
                with self._result_lock:
                    self._result = error_payload


class CameraStreamTrack(VideoStreamTrack):
    kind = "video"

    def __init__(self):
        super().__init__()
        # Camera is opened lazily in the first recv() call via executor so that
        # cv2.VideoCapture() — which can block waiting for V4L2 — never runs
        # on the asyncio event loop and never stalls ICE/DTLS processing.
        self._cap: cv2.VideoCapture | None = None
        self._worker = _InferenceWorker()
        self._data_channel = None
        # Signalled by stop() so a watcher task can close the PC without
        # relying on pyee's async-handler scheduling (which can silently
        # drop futures when called from a cancelled task's finally block).
        self.stopped = asyncio.Event()

    def set_data_channel(self, dc):
        self._data_channel = dc

    def _open_camera(self) -> cv2.VideoCapture:
        """Open the camera device (runs in executor, may block on V4L2).

        Acquires _camera_lock so this open waits for any in-progress release
        from the previous session, then sleeps briefly to let V4L2 flush its
        buffer state before handing the device to a new VideoCapture.
        """
        cfg = config.camera
        with _camera_lock:
            time.sleep(0.3)
            cap = cv2.VideoCapture(cfg.index)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.frame_width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.frame_height)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                raise RuntimeError("Could not open camera")
        logger.info("Camera opened (index=%d)", cfg.index)
        return cap

    def _drain_and_read(self):
        """Discard buffered frames and return only the latest one."""
        assert self._cap is not None
        for _ in range(4):
            self._cap.grab()
        ret, frame = self._cap.read()
        return ret, frame

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        loop = asyncio.get_event_loop()

        # Open camera on first recv — in executor so V4L2 open never blocks
        # the event loop (important when a previous session's thread is still
        # holding the device after an unexpected disconnect).
        if self._cap is None:
            try:
                self._cap = await loop.run_in_executor(None, self._open_camera)
            except Exception as exc:
                logger.warning("Camera open failed: %s — stopping track", exc)
                self.stop()
                raise
            self._worker.start()
            read_fn = self._drain_and_read
        else:
            read_fn = self._cap.read

        try:
            ret, frame = await loop.run_in_executor(None, read_fn)
        except Exception as exc:
            logger.warning("Camera read exception: %s — stopping track", exc)
            self.stop()
            raise

        if not ret:
            logger.warning("Camera returned empty frame — stopping track")
            self.stop()
            raise RuntimeError("Camera disconnected")

        crop = config.camera.crop_width
        left = frame[:, :crop] if crop > 0 else frame

        # Submit frame to inference worker (non-blocking)
        self._worker.submit_frame(left.copy())

        # Send latest detection result over data channel (from event loop, thread-safe)
        result = self._worker.consume_result()
        if result is not None and self._data_channel is not None:
            try:
                if self._data_channel.readyState == "open":
                    self._data_channel.send(result.model_dump_json())
            except Exception:
                logger.debug("Data channel send failed", exc_info=True)

        # Stream sends the clean frame (no YOLO annotations)
        video_frame = av.VideoFrame.from_ndarray(left, format="bgr24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    def _release_camera(self) -> None:
        """Drain V4L2 buffers then release (runs in a daemon thread).

        Holds _camera_lock so _open_camera() in the next session blocks
        until this release is fully complete.
        """
        if self._cap is None:
            return
        with _camera_lock:
            try:
                if self._cap.isOpened():
                    for _ in range(4):
                        self._cap.grab()
            except Exception:
                pass
            try:
                self._cap.release()
                logger.info("Camera released")
            except Exception:
                logger.debug("Camera release error", exc_info=True)

    def stop(self):
        super().stop()
        self._worker.stop()
        # Release in a thread so drain+release holds _camera_lock without
        # blocking the event loop — _open_camera() will wait on the lock.
        threading.Thread(target=self._release_camera, daemon=True).start()
        self.stopped.set()
