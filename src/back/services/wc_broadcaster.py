"""Broadcaster H264 Annex-B sobre WebSocket — fan-out a N clientes WebCodecs.

Un solo thread lee BGR del camera worker, encoder único Annex-B, dispatch a
inferencia (cuando hay sesión activa), y push del binary message a la cola
drop-oldest de cada cliente.

Wire format del mensaje: [uint32 BE header_len][JSON header utf-8][H264 NAL].
Header lleva detections + flags de sesión + frame_id/timestamp_us/is_keyframe
para que `VideoDecoder` del cliente sepa cuándo configure() y cuándo droppear.

Lazy lifecycle igual que `stream_broadcaster.py`: arranca en el primer
`add_client()`, se detiene cuando se va el último cliente.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import threading
import time

from back.config import config
from back.services import camera as camera_module
from back.services.camera import _InferenceWorker
from back.services.camera_client import CameraClient
from back.services.h264_encoder import H264AnnexBEncoder, H264AnnexBEncoderPyAV, make_h264_encoder
from back.services.perception import counter

logger = logging.getLogger("wc_broadcaster")

_READ_RETRY_DELAY = 1.0


def _pack(header: dict, payload: bytes) -> bytes:
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(header_bytes)) + header_bytes + payload


def _push_drop_oldest(queue: asyncio.Queue, msg: bytes) -> None:
    """Igual que stream_broadcaster: drop-oldest desde el loop del cliente."""
    try:
        queue.put_nowait(msg)
    except asyncio.QueueFull:
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
        try:
            queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass


class WCBroadcaster:
    def __init__(self) -> None:
        self._clients: dict[
            int, tuple[asyncio.AbstractEventLoop, asyncio.Queue[bytes]]
        ] = {}
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._frame_id = 0
        self._next_client_id = 0
        self._camera_client: CameraClient | None = None
        self._inference: _InferenceWorker | None = None
        self._encoder: H264AnnexBEncoder | H264AnnexBEncoderPyAV | None = None
        # Cache último resultado para no titilar el overlay entre frames sin
        # inferencia fresca (inferencia ~10–15 fps, video ~30 fps).
        self._last_result = None

    def add_client(self) -> tuple[int, asyncio.Queue[bytes]]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=1)

        thread_to_join: threading.Thread | None = None
        with self._lock:
            if (
                not self._running
                and self._thread is not None
                and self._thread.is_alive()
            ):
                thread_to_join = self._thread
        if thread_to_join is not None:
            thread_to_join.join(timeout=6.0)

        with self._lock:
            client_id = self._next_client_id
            self._next_client_id += 1
            self._clients[client_id] = (loop, queue)
            start_thread = not self._running
            if start_thread:
                self._running = True
                self._thread = threading.Thread(
                    target=self._run, name="wc-broadcaster", daemon=True
                )
                self._thread.start()
                logger.info(
                    "WCBroadcaster thread started (client_id=%d)", client_id
                )
            else:
                logger.info(
                    "WCBroadcaster client added (client_id=%d, total=%d)",
                    client_id,
                    len(self._clients),
                )
        return client_id, queue

    def remove_client(self, client_id: int) -> None:
        with self._lock:
            if client_id in self._clients:
                del self._clients[client_id]
                logger.info(
                    "WCBroadcaster client removed (client_id=%d, remaining=%d)",
                    client_id,
                    len(self._clients),
                )
            if not self._clients and self._running:
                self._running = False
                logger.info("WCBroadcaster marked for shutdown (no clients)")

    def _snapshot_clients(
        self,
    ) -> list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[bytes]]]:
        with self._lock:
            return list(self._clients.values())

    def _run(self) -> None:
        self._camera_client = CameraClient(config.camera.socket_path)
        self._inference = _InferenceWorker()
        self._inference.start()
        try:
            self._encoder = make_h264_encoder()
        except Exception:
            logger.exception("Failed to construct H264AnnexBEncoder; aborting WC broadcaster")
            self._running = False
            if self._inference is not None:
                self._inference.stop()
                self._inference = None
            if self._camera_client is not None:
                self._camera_client.close()
                self._camera_client = None
            return

        try:
            while self._running:
                try:
                    frame = self._camera_client.read_frame()
                except Exception as exc:
                    logger.warning(
                        "WCBroadcaster camera read failed: %s — retrying", exc
                    )
                    time.sleep(_READ_RETRY_DELAY)
                    continue

                self._frame_id += 1

                session = counter.get_active_session()
                if session is None:
                    self._last_result = None
                if camera_module.processing_enabled and session is not None:
                    self._inference.submit_frame(frame.copy())

                for is_keyframe, nal_bytes in self._encoder.push_frame(frame):
                    header: dict = {
                        "frame_id": self._frame_id,
                        "timestamp_us": self._frame_id * 1_000_000 // 30,
                        "is_keyframe": is_keyframe,
                        "detections": [],
                        "target_class": None,
                        "session_active": False,
                        "session_total": 0,
                    }
                    fresh = self._inference.consume_result()
                    if fresh is not None:
                        self._last_result = fresh
                    if self._last_result is not None:
                        header["detections"] = [
                            d.model_dump() for d in self._last_result.detections
                        ]
                        header["target_class"] = (
                            self._last_result.target_class or None
                        )
                        header["session_active"] = self._last_result.session_active
                        header["session_total"] = self._last_result.session_total
                        if self._last_result.error:
                            header["error"] = self._last_result.error
                    elif session is not None:
                        header["target_class"] = session.target_class
                        header["session_active"] = True
                        header["session_total"] = session.last_frame_count

                    msg = _pack(header, nal_bytes)

                    for loop, queue in self._snapshot_clients():
                        try:
                            loop.call_soon_threadsafe(
                                _push_drop_oldest, queue, msg
                            )
                        except RuntimeError:
                            pass
        finally:
            if self._encoder is not None:
                self._encoder.close()
                self._encoder = None
            if self._inference is not None:
                self._inference.stop()
                self._inference = None
            if self._camera_client is not None:
                self._camera_client.close()
                self._camera_client = None
            logger.info("WCBroadcaster thread stopped")


_broadcaster: WCBroadcaster | None = None
_singleton_lock = threading.Lock()


def get_wc_broadcaster() -> WCBroadcaster:
    global _broadcaster
    with _singleton_lock:
        if _broadcaster is None:
            _broadcaster = WCBroadcaster()
        return _broadcaster
