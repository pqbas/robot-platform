"""Recording worker — encodes frames from camera socket to MP4 on demand.

Two Unix sockets:
- camera socket (default ``/tmp/camera.sock``) — read-only consumer of raw BGR
  frames from the camera-worker fan-out. We do NOT connect until a ``start``
  command arrives — idle = no CPU, no NVENC, no socket.
- control socket (default ``/tmp/recording.sock``) — JSON length-prefixed
  request/response. Backend FastAPI is the only client.

Protocol (request → response):
    {"cmd": "start", "uuid": "<uuid>", "output_path": "..."}
        → {"ok": true, "state": "recording", "uuid": "...",
           "started_at": "...", "backend": "..."}
        → {"ok": false, "error": "already_recording"|"camera_unavailable"}
    {"cmd": "stop"}
        → {"ok": true, "state": "idle", "uuid": "...",
           "duration_seconds": ..., "file_size_bytes": ...,
           "width": ..., "height": ..., "fps": ..., "backend": "..."}
        → {"ok": false, "error": "not_recording"}
    {"cmd": "status"}
        → {"ok": true, "state": "recording"|"idle", ...}
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
import struct
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from recording_worker.encoder import Encoder, detect_backend, make_encoder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("recording_worker")

_shutdown = asyncio.Event()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Recording worker")
    parser.add_argument(
        "--camera-socket",
        default=os.getenv("CAMERA_SOCKET", "/tmp/camera.sock"),
    )
    parser.add_argument(
        "--control-socket",
        default=os.getenv("RECORDING_SOCKET", "/tmp/recording.sock"),
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Camera socket reader
# ---------------------------------------------------------------------------


class CameraReader:
    """Synchronous reader off the camera worker socket. Used inside a thread
    via ``loop.run_in_executor`` since the encoder writes are also blocking."""

    def __init__(self, socket_path: str) -> None:
        self._socket_path = socket_path
        self._sock: Optional[socket.socket] = None
        self.width = 0
        self.height = 0
        self.channels = 3
        self.fps: float = 30.0

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5.0)
        sock.connect(self._socket_path)
        sock.settimeout(None)
        self._sock = sock
        header_len = struct.unpack(">I", self._recv_exact(4))[0]
        handshake = json.loads(self._recv_exact(header_len).decode())
        self.width = handshake["width"]
        self.height = handshake["height"]
        self.channels = handshake["channels"]
        # fps is optional for backwards compat with older camera_worker builds
        # that didn't include it in the handshake.
        self.fps = float(handshake.get("fps") or 30.0)

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    def _recv_exact(self, n: int) -> bytes:
        assert self._sock is not None
        buf = b""
        while len(buf) < n:
            chunk = self._sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("camera worker closed connection")
            buf += chunk
        return buf

    def read_frame(self) -> Optional[np.ndarray]:
        if self._sock is None:
            return None
        try:
            frame_len = struct.unpack(">I", self._recv_exact(4))[0]
            raw = self._recv_exact(frame_len)
        except (ConnectionError, OSError, struct.error):
            return None
        return np.frombuffer(raw, dtype=np.uint8).reshape(
            self.height, self.width, self.channels
        )


# ---------------------------------------------------------------------------
# Recording state machine
# ---------------------------------------------------------------------------


class RecordingState:
    def __init__(self) -> None:
        self.encoder: Optional[Encoder] = None
        self.reader: Optional[CameraReader] = None
        self.uuid: Optional[str] = None
        self.output_path: Optional[str] = None
        self.started_at: Optional[str] = None
        self.task: Optional[asyncio.Task] = None
        self.stop_requested = False
        # Filled in on stop:
        self.last_stats: dict = {}

    @property
    def recording(self) -> bool:
        return self.encoder is not None


async def encode_loop(state: RecordingState) -> None:
    """Read frames from the camera reader and feed them to the encoder.

    Returns when stop is requested or the camera socket closes.
    """
    loop = asyncio.get_event_loop()
    assert state.reader is not None and state.encoder is not None

    while not state.stop_requested and not _shutdown.is_set():
        frame = await loop.run_in_executor(None, state.reader.read_frame)
        if frame is None:
            logger.warning(
                "Camera socket closed mid-recording — finalising MP4 (uuid=%s)",
                state.uuid,
            )
            break
        await loop.run_in_executor(None, state.encoder.write_frame, frame)


async def cmd_start(state: RecordingState, payload: dict, camera_socket: str) -> dict:
    if state.recording:
        return {"ok": False, "error": "already_recording"}

    uuid = payload.get("uuid")
    output_path = payload.get("output_path")
    if not uuid or not output_path:
        return {"ok": False, "error": "missing_uuid_or_output_path"}

    reader = CameraReader(camera_socket)
    try:
        await asyncio.get_event_loop().run_in_executor(None, reader.connect)
    except (FileNotFoundError, ConnectionError, OSError) as exc:
        logger.error("Camera socket unavailable: %s", exc)
        return {"ok": False, "error": "camera_unavailable"}

    # Make sure the output directory exists before handing the path to the
    # encoder — PyAV defers the file open until the first mux, so a missing
    # dir would crash the encode loop mid-recording instead of failing fast.
    try:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    except OSError as exc:
        reader.close()
        return {"ok": False, "error": f"cannot_create_output_dir: {exc}"}

    encoder = make_encoder()
    fps = reader.fps
    try:
        encoder.start(uuid, output_path, reader.width, reader.height, fps)
    except Exception as exc:
        logger.exception("Encoder failed to start")
        reader.close()
        return {"ok": False, "error": f"encoder_start_failed: {exc}"}

    state.encoder = encoder
    state.reader = reader
    state.uuid = uuid
    state.output_path = output_path
    state.started_at = _now_iso()
    state.stop_requested = False
    state.task = asyncio.create_task(encode_loop(state), name=f"encode-{uuid[:8]}")

    logger.info(
        "Recording started uuid=%s backend=%s out=%s %dx%d @ %.1ffps",
        uuid, encoder.backend, output_path, reader.width, reader.height, fps,
    )
    return {
        "ok": True,
        "state": "recording",
        "uuid": uuid,
        "started_at": state.started_at,
        "backend": encoder.backend,
    }


async def cmd_stop(state: RecordingState) -> dict:
    if not state.recording:
        return {"ok": False, "error": "not_recording"}

    encoder = state.encoder
    reader = state.reader
    uuid = state.uuid
    output_path = state.output_path
    backend = encoder.backend if encoder else None

    state.stop_requested = True

    # Drain the encode task. If it died with an exception (e.g. PyAV
    # mux failure mid-recording), wait_for re-raises it — we must not
    # let it abort the cleanup path or the state will stay 'recording'
    # forever and every subsequent start will 409.
    task_error: Exception | None = None
    if state.task is not None:
        try:
            await asyncio.wait_for(state.task, timeout=10.0)
        except asyncio.TimeoutError:
            logger.warning("encode_loop did not exit within 10s — cancelling")
            state.task.cancel()
        except Exception as exc:
            logger.warning("encode_loop crashed mid-recording: %s", exc)
            task_error = exc

    loop = asyncio.get_event_loop()

    stats: dict = {}
    if encoder is not None:
        try:
            stats = await loop.run_in_executor(None, encoder.stop)
        except Exception:
            logger.exception("Encoder stop raised — continuing cleanup")

    if reader is not None:
        try:
            reader.close()
        except Exception:
            pass

    file_size = 0
    if output_path:
        try:
            file_size = os.path.getsize(output_path)
        except OSError:
            pass

    # Reset state BEFORE building the response so that even if logging
    # raises, the next start() will succeed.
    state.encoder = None
    state.reader = None
    state.uuid = None
    state.output_path = None
    state.started_at = None
    state.task = None
    state.last_stats = stats

    response = {
        "ok": True,
        "state": "idle",
        "uuid": uuid,
        "duration_seconds": stats.get("duration_seconds"),
        "file_size_bytes": file_size,
        "width": stats.get("width"),
        "height": stats.get("height"),
        "fps": stats.get("fps"),
        "backend": backend,
    }
    if task_error is not None:
        response["warning"] = f"encode_loop crashed: {task_error}"
    logger.info("Recording stopped: %s", response)
    return response


async def cmd_status(state: RecordingState) -> dict:
    if state.recording:
        return {
            "ok": True,
            "state": "recording",
            "uuid": state.uuid,
            "started_at": state.started_at,
            "backend": state.encoder.backend if state.encoder else None,
        }
    return {"ok": True, "state": "idle"}


# ---------------------------------------------------------------------------
# Control socket server
# ---------------------------------------------------------------------------


async def handle_control(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    state: RecordingState,
    camera_socket: str,
):
    try:
        header = await reader.readexactly(4)
        length = struct.unpack(">I", header)[0]
        body = await reader.readexactly(length)
    except (asyncio.IncompleteReadError, ConnectionError):
        writer.close()
        return

    try:
        payload = json.loads(body.decode())
    except json.JSONDecodeError:
        response = {"ok": False, "error": "invalid_json"}
    else:
        cmd = payload.get("cmd")
        if cmd == "start":
            response = await cmd_start(state, payload, camera_socket)
        elif cmd == "stop":
            response = await cmd_stop(state)
        elif cmd == "status":
            response = await cmd_status(state)
        else:
            response = {"ok": False, "error": f"unknown_cmd: {cmd}"}

    encoded = json.dumps(response).encode()
    writer.write(struct.pack(">I", len(encoded)) + encoded)
    try:
        await writer.drain()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def serve(args) -> None:
    loop = asyncio.get_event_loop()

    def _stop():
        _shutdown.set()

    loop.add_signal_handler(signal.SIGTERM, _stop)
    loop.add_signal_handler(signal.SIGINT, _stop)

    state = RecordingState()
    backend = detect_backend()
    logger.info("Recording worker — backend=%s", backend)

    def client_handler(reader, writer):
        asyncio.ensure_future(
            handle_control(reader, writer, state, args.camera_socket)
        )

    server = await asyncio.start_unix_server(
        client_handler, path=args.control_socket
    )
    logger.info("Listening on %s", args.control_socket)

    await _shutdown.wait()
    server.close()
    await server.wait_closed()

    if state.recording:
        logger.info("Shutdown — finalising in-flight recording")
        await cmd_stop(state)

    logger.info("Recording worker stopped")


def main() -> None:
    args = parse_args()

    try:
        os.unlink(args.control_socket)
    except FileNotFoundError:
        pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
