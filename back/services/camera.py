import asyncio
import logging
import threading

import av
import cv2
import numpy as np
from aiortc import VideoStreamTrack

from back.config import config
from back.schemas import DetectionItem, FrameDetectionPayload
from back.services.perception import counter, detector

logger = logging.getLogger("webrtc")

pcs = set()


async def close_all_connections() -> None:
    """Close all existing peer connections, which stops their tracks."""
    for pc in list(pcs):
        await pc.close()
    pcs.clear()
    logger.info("All connections closed")


class _InferenceWorker:
    """Runs YOLO inference in a background thread, decoupled from the stream."""

    def __init__(self) -> None:
        self._frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._running = False
        self._thread: threading.Thread | None = None

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
            if not detector.enabled or session is None:
                continue

            try:
                target_class = session.target_class
                _annotated, detections, count, tracking_data = detector.detect(
                    frame, target_class
                )
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

            except Exception as exc:
                logger.warning("Inference failed, stream continues", exc_info=True)
                error_payload = FrameDetectionPayload(
                    count=0,
                    target_class="",
                    detections=[],
                    session_active=True,
                    error=str(exc),
                )
                with self._result_lock:
                    self._result = error_payload


class CameraStreamTrack(VideoStreamTrack):
    kind = "video"

    def __init__(self):
        super().__init__()
        cfg = config.camera
        self._cap = cv2.VideoCapture(cfg.index)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.frame_width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.frame_height)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not self._cap.isOpened():
            raise RuntimeError("Could not open camera")
        logger.info("Camera opened (index=%d)", cfg.index)
        self._first_frame = True
        self._worker = _InferenceWorker()
        self._data_channel = None

    def set_data_channel(self, dc):
        self._data_channel = dc

    def _drain_and_read(self):
        """Discard buffered frames and return only the latest one."""
        for _ in range(4):
            self._cap.grab()
        ret, frame = self._cap.read()
        return ret, frame

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        loop = asyncio.get_event_loop()

        # Start worker on first frame
        if self._first_frame:
            self._first_frame = False
            self._worker.start()
            ret, frame = await loop.run_in_executor(None, self._drain_and_read)
        else:
            ret, frame = await loop.run_in_executor(None, self._cap.read)
        if not ret:
            raise RuntimeError("Failed to read frame from camera")

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
        if self._cap.isOpened():
            self._cap.release()
            logger.info("Camera released")
