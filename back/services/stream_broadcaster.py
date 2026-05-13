"""Shared MJPEG broadcaster — single camera read, fan-out to N WebSocket clients.

One thread reads BGR frames from the camera worker, encodes JPEG, dispatches
inference (when a counting session is active), and pushes a length-prefixed
binary message to every connected client's per-client asyncio queue.

Message layout: [uint32 BE header_len][JSON header utf-8][JPEG bytes].

Lazy lifecycle: the thread starts on the first add_client() and stops when the
last client disconnects, so we don't hold the camera socket open when nobody
is watching.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import threading
import time

import cv2

from back.config import config
from back.services import camera as camera_module
from back.services.camera import _InferenceWorker
from back.services.camera_client import CameraClient
from back.services.perception import counter

logger = logging.getLogger("stream_broadcaster")

JPEG_QUALITY = 80
_READ_RETRY_DELAY = 1.0


def _pack(header: dict, jpeg: bytes) -> bytes:
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(header_bytes)) + header_bytes + jpeg


def _push_drop_oldest(queue: asyncio.Queue, msg: bytes) -> None:
    """Runs on the asyncio loop thread (scheduled via call_soon_threadsafe).

    asyncio.Queue is not thread-safe, so put_nowait must be called from the
    loop. If the queue is full, drop the stale frame and replace with the
    fresh one — keeps slow clients from holding back the rest.
    """
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


class StreamBroadcaster:
    def __init__(self) -> None:
        self._clients: dict[int, tuple[asyncio.AbstractEventLoop, asyncio.Queue[bytes]]] = {}
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._frame_id = 0
        self._next_client_id = 0
        self._camera_client: CameraClient | None = None
        self._inference: _InferenceWorker | None = None
        # Cache último resultado de inferencia para no titilar entre frames sin
        # resultado fresco (inferencia ~10-15 fps, cámara ~30 fps). Se limpia
        # cuando termina la sesión.
        self._last_result = None

    def add_client(self) -> tuple[int, asyncio.Queue[bytes]]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=1)

        # Drain the previous thread before starting a new one. read_frame can
        # block up to STREAM_READ_TIMEOUT_S, so a rapid disconnect/reconnect
        # would otherwise race two threads on the same CameraClient.
        thread_to_join: threading.Thread | None = None
        with self._lock:
            if not self._running and self._thread is not None and self._thread.is_alive():
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
                    target=self._run, name="stream-broadcaster", daemon=True
                )
                self._thread.start()
                logger.info("StreamBroadcaster thread started (client_id=%d)", client_id)
            else:
                logger.info("StreamBroadcaster client added (client_id=%d, total=%d)",
                            client_id, len(self._clients))
        return client_id, queue

    def remove_client(self, client_id: int) -> None:
        stop_thread = False
        with self._lock:
            if client_id in self._clients:
                del self._clients[client_id]
                logger.info(
                    "StreamBroadcaster client removed (client_id=%d, remaining=%d)",
                    client_id, len(self._clients),
                )
            if not self._clients and self._running:
                self._running = False
                stop_thread = True
        if stop_thread and self._thread is not None:
            # Don't join from the loop thread; the broadcaster cleans itself up.
            logger.info("StreamBroadcaster marked for shutdown (no clients)")

    def _snapshot_clients(self) -> list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[bytes]]]:
        with self._lock:
            return list(self._clients.values())

    def _run(self) -> None:
        self._camera_client = CameraClient(config.camera.socket_path)
        self._inference = _InferenceWorker()
        self._inference.start()

        try:
            while self._running:
                try:
                    frame = self._camera_client.read_frame()
                except Exception as exc:
                    logger.warning("Broadcaster camera read failed: %s — retrying", exc)
                    time.sleep(_READ_RETRY_DELAY)
                    continue

                self._frame_id += 1

                session = counter.get_active_session()
                if session is None:
                    self._last_result = None
                if camera_module.processing_enabled and session is not None:
                    self._inference.submit_frame(frame.copy())

                ok, jpeg_buf = cv2.imencode(
                    ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                )
                if not ok:
                    logger.warning("JPEG encode failed for frame_id=%d", self._frame_id)
                    continue
                jpeg = jpeg_buf.tobytes()

                header: dict = {
                    "frame_id": self._frame_id,
                    "detections": [],
                    "target_class": None,
                    "session_active": False,
                    "session_total": 0,
                }
                fresh = self._inference.consume_result()
                if fresh is not None:
                    self._last_result = fresh
                if self._last_result is not None:
                    header["detections"] = [d.model_dump() for d in self._last_result.detections]
                    header["target_class"] = self._last_result.target_class or None
                    header["session_active"] = self._last_result.session_active
                    header["session_total"] = self._last_result.session_total
                    if self._last_result.error:
                        header["error"] = self._last_result.error
                elif session is not None:
                    header["target_class"] = session.target_class
                    header["session_active"] = True
                    header["session_total"] = session.last_frame_count

                msg = _pack(header, jpeg)

                for loop, queue in self._snapshot_clients():
                    try:
                        loop.call_soon_threadsafe(_push_drop_oldest, queue, msg)
                    except RuntimeError:
                        # Loop closed; client will be cleaned up by remove_client.
                        pass
        finally:
            if self._inference is not None:
                self._inference.stop()
                self._inference = None
            if self._camera_client is not None:
                self._camera_client.close()
                self._camera_client = None
            logger.info("StreamBroadcaster thread stopped")


_broadcaster: StreamBroadcaster | None = None
_singleton_lock = threading.Lock()


def get_broadcaster() -> StreamBroadcaster:
    global _broadcaster
    with _singleton_lock:
        if _broadcaster is None:
            _broadcaster = StreamBroadcaster()
        return _broadcaster
