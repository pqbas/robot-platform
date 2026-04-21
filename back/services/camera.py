import asyncio
import logging
import threading

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

    def set_data_channel(self, dc):
        self._data_channel = dc

    def _open_camera(self) -> cv2.VideoCapture:
        """Open the camera device (runs in executor, may block on V4L2)."""
        cfg = config.camera
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

    def stop(self):
        super().stop()
        self._worker.stop()
        if self._cap is not None and self._cap.isOpened():
            self._cap.release()
            logger.info("Camera released")
