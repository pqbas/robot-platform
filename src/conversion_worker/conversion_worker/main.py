"""Conversion worker — builds TensorRT engines from .pt models on demand.

One Unix socket:
- control socket (default ``/tmp/conversion.sock``) — JSON length-prefixed
  request/response. Backend FastAPI is the only client.

Protocol (request -> response):
    {"cmd": "convert", "pt_path": "...", "engine_path": "...",
     "precision": "fp16"}
        -> {"ok": true, "state": "converting", "started_at": "..."}
        -> {"ok": false, "error": "busy"|"missing_pt_path"|...}
    {"cmd": "status"}
        -> {"ok": true, "state": "idle"|"converting",
            "current": {"pt_path": "...", "engine_path": "...",
                        "started_at": "..."} | null,
            "last_result": {"ok": true, "engine_path": "...",
                            "duration_seconds": ...} |
                           {"ok": false, "error": "..."} | null}

Idle = no thread, no GPU, ~0% CPU. We spawn one converter thread per
``convert`` job; only one job runs at a time (the second returns ``busy``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import struct
import threading
import time
from datetime import datetime, timezone
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("conversion_worker")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Conversion worker")
    parser.add_argument(
        "--control-socket",
        default=os.getenv("CONVERSION_SOCKET", "/tmp/conversion.sock"),
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------


class ConversionState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.thread: Optional[threading.Thread] = None
        self.current: Optional[dict] = None
        self.last_result: Optional[dict] = None

    @property
    def converting(self) -> bool:
        with self._lock:
            return self.thread is not None and self.thread.is_alive()


def _run_conversion(state: ConversionState, payload: dict) -> None:
    """Thread entrypoint: import + run + record result."""
    pt_path = payload["pt_path"]
    engine_path = payload["engine_path"]
    precision = payload.get("precision", "fp16")

    started = time.monotonic()
    try:
        from conversion_worker.converter import convert

        convert(pt_path, engine_path, precision=precision)
        duration = time.monotonic() - started
        result = {
            "ok": True,
            "engine_path": engine_path,
            "duration_seconds": round(duration, 1),
            "finished_at": _now_iso(),
        }
        logger.info("Conversion succeeded: %s", result)
    except Exception as exc:
        duration = time.monotonic() - started
        result = {
            "ok": False,
            "error": str(exc) or exc.__class__.__name__,
            "duration_seconds": round(duration, 1),
            "finished_at": _now_iso(),
        }
        logger.exception("Conversion failed")

    with state._lock:
        state.last_result = result
        state.current = None
        state.thread = None


def cmd_convert(state: ConversionState, payload: dict) -> dict:
    pt_path = payload.get("pt_path")
    engine_path = payload.get("engine_path")
    precision = payload.get("precision", "fp16")

    if not pt_path or not engine_path:
        return {"ok": False, "error": "missing_pt_path_or_engine_path"}

    if not os.path.exists(pt_path):
        return {"ok": False, "error": f"pt_not_found: {pt_path}"}

    with state._lock:
        if state.thread is not None and state.thread.is_alive():
            return {"ok": False, "error": "busy"}

        state.current = {
            "pt_path": pt_path,
            "engine_path": engine_path,
            "precision": precision,
            "started_at": _now_iso(),
        }
        thread = threading.Thread(
            target=_run_conversion,
            args=(state, state.current),
            name=f"convert-{os.path.basename(pt_path)}",
            daemon=True,
        )
        state.thread = thread
        thread.start()

        return {
            "ok": True,
            "state": "converting",
            "started_at": state.current["started_at"],
        }


def cmd_status(state: ConversionState) -> dict:
    with state._lock:
        if state.thread is not None and state.thread.is_alive():
            return {
                "ok": True,
                "state": "converting",
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
    state: ConversionState,
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
        if cmd == "convert":
            response = cmd_convert(state, payload)
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

    state = ConversionState()

    def client_handler(reader, writer):
        asyncio.ensure_future(handle_control(reader, writer, state))

    server = await asyncio.start_unix_server(client_handler, path=args.control_socket)
    logger.info("Listening on %s", args.control_socket)

    await shutdown.wait()
    server.close()
    await server.wait_closed()
    logger.info("Conversion worker stopped")


def main() -> None:
    args = parse_args()

    try:
        os.unlink(args.control_socket)
    except FileNotFoundError:
        pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
