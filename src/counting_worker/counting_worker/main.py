"""Counting worker — reprocesses recorded MP4s offline to produce the
authoritative blueberry count + a frame-aligned detection sidecar.

One Unix socket:
- control socket (default ``/tmp/counting.sock``) — JSON length-prefixed
  request/response. Backend FastAPI is the only client.

Protocol (request -> response):
    {"cmd": "count", "uuid": "...", "video_path": "...", "jsonl_path": "...",
     "engine_path": "...", "target_class": "...", "count_mode": "...",
     "threshold": 0.5, "direction": "...", "roi_mode": "square",
     "confidence": 0.25, "started_epoch": 0.0, "fps": 30.0}
        -> {"ok": true, "state": "counting", "started_at": "..."}
        -> {"ok": false, "error": "busy"|"missing_video_path"|...}
    {"cmd": "status"}
        -> {"ok": true, "state": "idle"|"counting",
            "current": {"uuid": "...", "video_path": "...", ...} | null,
            "last_result": {"ok": true, "uuid": "...", "total_count": ...,
                            "frames": ..., "duration_seconds": ...,
                            "finished_at": "..."} |
                           {"ok": false, "uuid": "...", "error": "..."} | null}

Idle = no thread, no GPU, ~0% CPU. One counter thread per ``count`` job; only
one job runs at a time (the second returns ``busy``). Mirrors conversion_worker.
"""

from __future__ import annotations

# JetPack ships TensorRT 8.5 whose tensorrt/__init__.py uses ``np.bool``.
# That alias was removed in numpy>=1.24; ultralytics' AutoUpdate sometimes
# pulls in a newer numpy at runtime. Patch defensively before any module
# (cv2 / ultralytics / tensorrt) imports numpy.
import numpy as np  # noqa: E402

if not hasattr(np, "bool"):
    np.bool = bool  # type: ignore[attr-defined]
if not hasattr(np, "float"):
    np.float = float  # type: ignore[attr-defined]
if not hasattr(np, "int"):
    np.int = int  # type: ignore[attr-defined]
if not hasattr(np, "object"):
    np.object = object  # type: ignore[attr-defined]

import asyncio  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import signal  # noqa: E402
import struct  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from typing import Optional  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("counting_worker")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Counting worker")
    parser.add_argument(
        "--control-socket",
        default=os.getenv("COUNTING_SOCKET", "/tmp/counting.sock"),
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------


class CountingState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.thread: Optional[threading.Thread] = None
        self.current: Optional[dict] = None
        self.last_result: Optional[dict] = None

    @property
    def counting(self) -> bool:
        with self._lock:
            return self.thread is not None and self.thread.is_alive()


def _run_count(state: CountingState, payload: dict) -> None:
    """Thread entrypoint: import + run + record result."""
    uuid = payload.get("uuid")
    started = time.monotonic()
    try:
        from counting_worker.processor import count_video

        out = count_video(payload)
        duration = time.monotonic() - started
        result = {
            "ok": True,
            "uuid": uuid,
            "total_count": out["total_count"],
            "frames": out["frames"],
            "duration_seconds": round(duration, 1),
            "finished_at": _now_iso(),
        }
        logger.info("Count succeeded: %s", result)
    except Exception as exc:
        duration = time.monotonic() - started
        result = {
            "ok": False,
            "uuid": uuid,
            "error": str(exc) or exc.__class__.__name__,
            "duration_seconds": round(duration, 1),
            "finished_at": _now_iso(),
        }
        logger.exception("Count failed")

    with state._lock:
        state.last_result = result
        state.current = None
        state.thread = None


def cmd_count(state: CountingState, payload: dict) -> dict:
    video_path = payload.get("video_path")
    jsonl_path = payload.get("jsonl_path")
    engine_path = payload.get("engine_path")

    if not video_path or not jsonl_path or not engine_path:
        return {"ok": False, "error": "missing_video_path_or_jsonl_path_or_engine_path"}
    if not os.path.exists(video_path):
        return {"ok": False, "error": f"video_not_found: {video_path}"}

    with state._lock:
        if state.thread is not None and state.thread.is_alive():
            return {"ok": False, "error": "busy"}

        state.current = {
            "uuid": payload.get("uuid"),
            "video_path": video_path,
            "jsonl_path": jsonl_path,
            "engine_path": engine_path,
            "started_at": _now_iso(),
        }
        thread = threading.Thread(
            target=_run_count,
            args=(state, payload),
            name=f"count-{os.path.basename(video_path)}",
            daemon=True,
        )
        state.thread = thread
        thread.start()

        return {
            "ok": True,
            "state": "counting",
            "started_at": state.current["started_at"],
        }


def cmd_status(state: CountingState) -> dict:
    with state._lock:
        if state.thread is not None and state.thread.is_alive():
            return {
                "ok": True,
                "state": "counting",
                "current": dict(state.current) if state.current else None,
                "last_result": state.last_result,
            }
        return {
            "ok": True,
            "state": "idle",
            "current": None,
            "last_result": state.last_result,
        }


# ---------------------------------------------------------------------------
# Control socket
# ---------------------------------------------------------------------------


async def handle_control(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    state: CountingState,
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
        if cmd == "count":
            response = cmd_count(state, payload)
        elif cmd == "status":
            response = cmd_status(state)
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
    shutdown = asyncio.Event()

    def _stop():
        shutdown.set()

    loop.add_signal_handler(signal.SIGTERM, _stop)
    loop.add_signal_handler(signal.SIGINT, _stop)

    state = CountingState()

    def client_handler(reader, writer):
        asyncio.ensure_future(handle_control(reader, writer, state))

    server = await asyncio.start_unix_server(client_handler, path=args.control_socket)
    logger.info("Listening on %s", args.control_socket)

    await shutdown.wait()
    server.close()
    await server.wait_closed()
    logger.info("Counting worker stopped")


def main() -> None:
    args = parse_args()

    try:
        os.unlink(args.control_socket)
    except FileNotFoundError:
        pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
