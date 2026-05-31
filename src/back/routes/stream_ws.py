"""WebSocket route for the MJPEG broadcaster.

Wire format del frame (server→client): [uint32 BE header_len][JSON header utf-8][JPEG bytes].
Flow control: el cliente envía un mensaje de texto cualquiera ("ready") por
cada frame que está dispuesto a recibir — el server no manda nada hasta tener
crédito disponible. Esto evita que la pestaña móvil acumule frames cuando
decodea más lento que la red entrega.
"""

import asyncio
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

    # Crédito tope = 1: si el cliente manda dos "ready" seguidos, el segundo se
    # descarta. Garantiza un frame en vuelo por cliente.
    credits: asyncio.Queue[None] = asyncio.Queue(maxsize=1)

    async def receiver() -> None:
        try:
            while True:
                await ws.receive_text()
                try:
                    credits.put_nowait(None)
                except asyncio.QueueFull:
                    pass
        except WebSocketDisconnect:
            return

    async def sender() -> None:
        while True:
            await credits.get()
            msg = await queue.get()
            await ws.send_bytes(msg)

    recv_task = asyncio.create_task(receiver())
    send_task = asyncio.create_task(sender())
    try:
        # Cualquiera de los dos termina primero (disconnect en receiver, error
        # en sender) y cancelamos al otro para liberar await pendientes.
        done, _pending = await asyncio.wait(
            {recv_task, send_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for t in done:
            exc = t.exception()
            if exc is not None and not isinstance(exc, WebSocketDisconnect):
                raise exc
    except WebSocketDisconnect:
        logger.info("WS stream client disconnected (client_id=%d)", client_id)
    except Exception:
        logger.warning("WS stream failed (client_id=%d)", client_id, exc_info=True)
    finally:
        for t in (recv_task, send_task):
            if not t.done():
                t.cancel()
        broadcaster.remove_client(client_id)
