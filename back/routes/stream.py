import logging
import os

from aiortc import RTCPeerConnection, RTCSessionDescription
from fastapi import APIRouter
from fastapi.requests import Request
from fastapi.responses import FileResponse, JSONResponse

from back.services import camera
from back.services.perception import detector

logger = logging.getLogger("webrtc")

router = APIRouter()

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "scripts", "static")


@router.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@router.post("/offer")
async def offer(request: Request):
    params = await request.json()
    logger.info("Received offer")

    # Close any previous connections so the shared camera is free
    await camera.close_all_connections()

    offer_desc = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    camera.pcs.add(pc)

    track = camera.CameraStreamTrack()

    # receive data channel created by the frontend
    @pc.on("datachannel")
    def on_datachannel(channel):
        logger.info("Data channel received: %s", channel.label)
        track.set_data_channel(channel)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info("Connection state: %s", pc.connectionState)
        if pc.connectionState in ("failed", "closed", "disconnected"):
            await pc.close()
            track.stop()
            camera.pcs.discard(pc)

    pc.addTrack(track)
    await pc.setRemoteDescription(offer_desc)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    logger.info("Sending answer")
    return JSONResponse(
        {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
    )


@router.post("/toggle_processing")
async def toggle_processing():
    detector.enabled = not detector.enabled
    logger.info(
        "Processing %s",
        "enabled" if detector.enabled else "disabled",
    )
    return JSONResponse({"processing": detector.enabled})
