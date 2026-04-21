import asyncio
import logging
import threading

import av
import numpy as np
from aiortc import VideoStreamTrack

from back.config import config
from back.schemas import DetectionItem, FrameDetectionPayload
from back.services.camera_client import CameraClient
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
        self._client = CameraClient(config.camera.socket_path)
        self._worker = _InferenceWorker()
        self._data_channel = None
        self.stopped = asyncio.Event()
        self._first_frame = True

    def set_data_channel(self, dc):
        self._data_channel = dc

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        loop = asyncio.get_event_loop()

        try:
            frame = await loop.run_in_executor(None, self._client.read_frame)
        except Exception as exc:
            logger.warning("Camera read failed: %s — stopping track", exc)
            self.stop()
            raise

        if self._first_frame:
            self._first_frame = False
            self._worker.start()

        # Submit frame to inference worker (non-blocking)
        self._worker.submit_frame(frame.copy())

        # Send latest detection result over data channel
        result = self._worker.consume_result()
        if result is not None and self._data_channel is not None:
            try:
                if self._data_channel.readyState == "open":
                    self._data_channel.send(result.model_dump_json())
            except Exception:
                logger.debug("Data channel send failed", exc_info=True)

        video_frame = av.VideoFrame.from_ndarray(frame, format="bgr24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    def stop(self):
        super().stop()
        self._worker.stop()
        self._client.close()
        self.stopped.set()
        logger.info("Track stopped")
