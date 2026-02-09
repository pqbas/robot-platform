import asyncio
import logging
import os
from contextlib import asynccontextmanager

import av
import cv2
import uvicorn
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.requests import Request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("webrtc")

pcs = set()
processing_enabled = True

CAMERA_INDEX = 2
FRAME_WIDTH = 2560
FRAME_HEIGHT = 720
CROP_WIDTH = 1280


class CameraStreamTrack(VideoStreamTrack):
    kind = "video"

    def __init__(self):
        super().__init__()
        self._cap = cv2.VideoCapture(CAMERA_INDEX)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
        if not self._cap.isOpened():
            raise RuntimeError("Could not open camera")
        logger.info("Camera opened successfully")

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        loop = asyncio.get_event_loop()
        ret, frame = await loop.run_in_executor(None, self._cap.read)
        if not ret:
            raise RuntimeError("Failed to read frame from camera")

        left = frame[:, :CROP_WIDTH]
        # processing stage
        if processing_enabled:
            left = cv2.cvtColor(left, cv2.COLOR_BGR2GRAY)
            left = cv2.cvtColor(left, cv2.COLOR_GRAY2BGR)
        video_frame = av.VideoFrame.from_ndarray(left, format="bgr24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    def stop(self):
        super().stop()
        if self._cap.isOpened():
            self._cap.release()
            logger.info("Camera released")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def index():
    html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    return FileResponse(html_path)


@app.post("/offer")
async def offer(request: Request):
    params = await request.json()
    logger.info("Received offer")
    offer_desc = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)

    track = CameraStreamTrack()

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info("Connection state: %s", pc.connectionState)
        if pc.connectionState in ("failed", "closed"):
            await pc.close()
            track.stop()
            pcs.discard(pc)

    pc.addTrack(track)
    await pc.setRemoteDescription(offer_desc)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    logger.info("Sending answer")
    return JSONResponse(
        {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
    )


@app.post("/toggle_processing")
async def toggle_processing():
    global processing_enabled
    processing_enabled = not processing_enabled
    logger.info("Processing %s", "enabled" if processing_enabled else "disabled")
    return JSONResponse({"processing": processing_enabled})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
