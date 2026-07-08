"""Classification worker — runs ripeness classification offline over the
crossing events the counting worker produced for a recorded MP4.

One Unix socket:
- control socket (default ``/tmp/classification.sock``) — JSON length-prefixed
  request/response. Backend FastAPI is the only client.

Protocol (request -> response):
    {"cmd": "classify", "uuid": "...", "video_path": "...",
     "crossings_path": "...", "classifications_path": "...",
     "crops_dir": "...", "model_path": "..."}
        -> {"ok": true, "state": "classifying", "started_at": "..."}
        -> {"ok": false, "error": "busy"|"missing_..."|...}
    {"cmd": "status"}
        -> {"ok": true, "state": "idle"|"classifying",
            "current": {...} | null,
            "last_result": {"ok": true, "uuid": "...", "total": ...,
                            "distribution": {...}, "duration_seconds": ...,
                            "finished_at": "..."} |
                           {"ok": false, "uuid": "...", "error": "..."} | null}

Idle = no thread, no GPU, ~0% CPU. One worker thread per ``classify`` job; only
one job runs at a time (the second returns ``busy``). Mirrors counting_worker.
"""

from __future__ import annotations

# JetPack ships TensorRT 8.5 whose tensorrt/__init__.py uses ``np.bool``.
# Removed in numpy>=1.24; patch defensively before any module imports numpy.
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
logger = logging.getLogger("classification_worker")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Classification worker")
    parser.add_argument(
        "--control-socket",
        default=os.getenv("CLASSIFICATION_SOCKET", "/tmp/classification.sock"),
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------


class ClassificationState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.thread: Optional[threading.Thread] = None
        self.current: Optional[dict] = None
        self.last_result: Optional[dict] = None

    @property
    def classifying(self) -> bool:
        with self._lock:
            return self.thread is not None and self.thread.is_alive()


def _run_classify(state: ClassificationState, payload: dict) -> None:
    """Thread entrypoint: import + run + record result."""
    uuid = payload.get("uuid")
    started = time.monotonic()
    try:
        from classification_worker.processor import classify_video

        out = classify_video(payload)
        duration = time.monotonic() - started
        result = {
            "ok": True,
            "uuid": uuid,
            "total": out["total"],
            "distribution": out["distribution"],
            "duration_seconds": round(duration, 1),
            "finished_at": _now_iso(),
        }
        logger.info("Classification succeeded: %s", result)
    except Exception as exc:
        duration = time.monotonic() - started
        result = {
            "ok": False,
            "uuid": uuid,
            "error": str(exc) or exc.__class__.__name__,
            "duration_seconds": round(duration, 1),
            "finished_at": _now_iso(),
        }
        logger.exception("Classification failed")

    with state._lock:
        state.last_result = result
        state.current = None
        state.thread = None


def cmd_classify(state: ClassificationState, payload: dict) -> dict:
    video_path = payload.get("video_path")
    crossings_path = payload.get("crossings_path")
    classifications_path = payload.get("classifications_path")
    crops_dir = payload.get("crops_dir")
    model_path = payload.get("model_path")

    if not video_path or not crossings_path or not classifications_path:
        return {"ok": False, "error": "missing_video_path_or_crossings_path_or_classifications_path"}
    if not crops_dir or not model_path:
        return {"ok": False, "error": "missing_crops_dir_or_model_path"}
    if not os.path.exists(video_path):
        return {"ok": False, "error": f"video_not_found: {video_path}"}
    if not os.path.exists(model_path):
        return {"ok": False, "error": f"model_not_found: {model_path}"}

    with state._lock:
        if state.thread is not None and state.thread.is_alive():
            return {"ok": False, "error": "busy"}

        state.current = {
            "uuid": payload.get("uuid"),
            "video_path": video_path,
            "crossings_path": crossings_path,
            "classifications_path": classifications_path,
            "crops_dir": crops_dir,
            "model_path": model_path,
            "started_at": _now_iso(),
        }
        thread = threading.Thread(
            target=_run_classify,
            args=(state, payload),
            name=f"classify-{os.path.basename(video_path)}",
            daemon=True,
        )
        state.thread = thread
        thread.start()

        return {
            "ok": True,
            "state": "classifying",
            "started_at": state.current["started_at"],
        }


def cmd_status(state: ClassificationState) -> dict:
    with state._lock:
        if state.thread is not None and state.thread.is_alive():
            return {
                "ok": True,
                "state": "classifying",
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
    state: ClassificationState,
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
        if cmd == "classify":
            response = cmd_classify(state, payload)
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

    state = ClassificationState()

    def client_handler(reader, writer):
        asyncio.ensure_future(handle_control(reader, writer, state))

    server = await asyncio.start_unix_server(client_handler, path=args.control_socket)
    logger.info("Listening on %s", args.control_socket)

    await shutdown.wait()
    server.close()
    await server.wait_closed()
    logger.info("Classification worker stopped")


def main() -> None:
    args = parse_args()

    try:
        os.unlink(args.control_socket)
    except FileNotFoundError:
        pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
