import logging

from aiortc import RTCPeerConnection, RTCSessionDescription
from fastapi import APIRouter
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from back.services import camera

logger = logging.getLogger("webrtc")

router = APIRouter()


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

    @track.on("ended")
    async def on_track_ended():
        logger.warning("Track ended — closing peer connection")
        if pc.connectionState not in ("closed", "failed"):
            await pc.close()
            camera.pcs.discard(pc)

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
    camera.processing_enabled = not camera.processing_enabled
    logger.info(
        "Processing %s",
        "enabled" if camera.processing_enabled else "disabled",
    )
    return JSONResponse({"processing": camera.processing_enabled})
