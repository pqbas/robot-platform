"""WebSocket route para el broadcaster WebCodecs (H264 Annex-B).

Wire format del frame (server→client): [uint32 BE header_len][JSON header utf-8][H264 NAL].

Sin credit/ACK: el sender corre libre y el server droppea con su queue de
fan-out (maxsize=1). El cliente maneja backpressure descartando P-frames
cuando `VideoDecoder.decodeQueueSize > 3`.
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from back.services.wc_broadcaster import get_wc_broadcaster

logger = logging.getLogger("stream_wc")

router = APIRouter()


@router.websocket("/ws/wc-stream")
async def stream_wc(ws: WebSocket) -> None:
    await ws.accept()
    broadcaster = get_wc_broadcaster()
    client_id, queue = broadcaster.add_client()

    async def receiver() -> None:
        # El cliente no envía nada — solo detectamos disconnect.
        # receive_text() raisea WebSocketDisconnect limpio (a diferencia de
        # receive() que devuelve el disconnect dict y luego rompe en la
        # próxima iteración con "Cannot call receive once disconnected").
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            return

    async def sender() -> None:
        while True:
            msg = await queue.get()
            await ws.send_bytes(msg)

    recv_task = asyncio.create_task(receiver())
    send_task = asyncio.create_task(sender())
    try:
        done, _pending = await asyncio.wait(
            {recv_task, send_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for t in done:
            exc = t.exception()
            if exc is not None and not isinstance(exc, WebSocketDisconnect):
                raise exc
    except WebSocketDisconnect:
        logger.info("WS wc-stream client disconnected (client_id=%d)", client_id)
    except Exception:
        logger.warning(
            "WS wc-stream failed (client_id=%d)", client_id, exc_info=True
        )
    finally:
        for t in (recv_task, send_task):
            if not t.done():
                t.cancel()
        broadcaster.remove_client(client_id)
