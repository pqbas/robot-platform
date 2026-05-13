"""WebSocket route for the MJPEG broadcaster.

Wire format per message: [uint32 BE header_len][JSON header utf-8][JPEG bytes].
See back/services/stream_broadcaster.py for the producer side.
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from back.services.stream_broadcaster import get_broadcaster

logger = logging.getLogger("stream_ws")

router = APIRouter()


@router.websocket("/ws/stream")
async def stream_ws(ws: WebSocket) -> None:
    await ws.accept()
    broadcaster = get_broadcaster()
    client_id, queue = broadcaster.add_client()
    try:
        while True:
            msg = await queue.get()
            await ws.send_bytes(msg)
    except WebSocketDisconnect:
        logger.info("WS stream client disconnected (client_id=%d)", client_id)
    except Exception:
        logger.warning("WS stream send failed (client_id=%d)", client_id, exc_info=True)
    finally:
        broadcaster.remove_client(client_id)
