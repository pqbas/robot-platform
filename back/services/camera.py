import asyncio
import logging

import av
import cv2
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


class CameraStreamTrack(VideoStreamTrack):
    kind = "video"

    def __init__(self):
        super().__init__()
        cfg = config.camera
        self._cap = cv2.VideoCapture(cfg.index)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.frame_width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.frame_height)
        if not self._cap.isOpened():
            raise RuntimeError("Could not open camera")
        logger.info("Camera opened (index=%d)", cfg.index)
        self._data_channel = None

    def set_data_channel(self, dc):
        self._data_channel = dc

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        loop = asyncio.get_event_loop()
        ret, frame = await loop.run_in_executor(None, self._cap.read)
        if not ret:
            raise RuntimeError("Failed to read frame from camera")

        crop = config.camera.crop_width
        left = frame[:, :crop] if crop > 0 else frame

        session = counter.get_active_session()

        if detector.enabled and session is not None:
            target_class = session.target_class

            annotated, detections, count, results_raw = await loop.run_in_executor(
                None, detector.detect, left, target_class
            )
            left = annotated
            counter.update(results_raw)

            # send detections over data channel
            if self._data_channel is not None:
                try:
                    if self._data_channel.readyState == "open":
                        payload = FrameDetectionPayload(
                            count=count,
                            target_class=target_class,
                            detections=[
                                DetectionItem(**d) for d in detections
                            ],
                            session_active=True,
                            session_total=session.last_frame_count,
                        )
                        self._data_channel.send(payload.model_dump_json())
                except Exception:
                    logger.debug("Data channel send failed", exc_info=True)

        video_frame = av.VideoFrame.from_ndarray(left, format="bgr24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    def stop(self):
        super().stop()
        if self._cap.isOpened():
            self._cap.release()
            logger.info("Camera released")
