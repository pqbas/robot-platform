"""Inference worker — Unix socket server that receives JPEG frames and returns detections."""

import argparse
import asyncio
import logging
import os
import signal
import sys

# JetPack ships TensorRT 8.5 whose tensorrt/__init__.py uses ``np.bool``.
# That alias was removed in numpy>=1.24; ultralytics' AutoUpdate sometimes
# pulls in a newer numpy at runtime, leaving the worker calling into trt
# code that AttributeErrors on ``np.bool``. Patch defensively before any
# other module imports numpy.
import numpy as np  # noqa: E402

if not hasattr(np, "bool"):
    np.bool = bool  # type: ignore[attr-defined]
if not hasattr(np, "float"):
    np.float = float  # type: ignore[attr-defined]
if not hasattr(np, "int"):
    np.int = int  # type: ignore[attr-defined]
if not hasattr(np, "object"):
    np.object = object  # type: ignore[attr-defined]

import cv2  # noqa: E402

from inference_worker.detector import Detector  # noqa: E402
from inference_worker.protocol import read_request, write_response  # noqa: E402

logger = logging.getLogger("inference_worker")


def handle_command(header: dict, detector: Detector) -> dict:
    """Handle a control command (no JPEG payload)."""
    cmd = header.get("command")
    if cmd == "reload_model":
        model_path = header.get("model_path")
        if not model_path:
            return {"ok": False, "error": "model_path required"}
        try:
            detector.reload_model(model_path)
            return {"ok": True, "model_path": model_path}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
    elif cmd == "status":
        return {"ok": True, "model_path": detector.model_path}
    elif cmd == "timing":
        return {"ok": True, "model_path": detector.model_path, **detector.timing_stats()}
    return {"ok": False, "error": f"unknown command: {cmd}"}


async def handle_client(reader, writer, detector: Detector) -> None:
    peer = "client"
    logger.info("%s connected", peer)
    try:
        while True:
            try:
                req = await read_request(reader)
            except asyncio.IncompleteReadError:
                break
            if req is None:
                break

            header, jpeg_bytes = req

            # Control commands (no JPEG payload)
            if "command" in header:
                response = handle_command(header, detector)
                await write_response(writer, response)
                continue

            frame = cv2.imdecode(np.frombuffer(jpeg_bytes, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await write_response(writer, {"error": "invalid JPEG"})
                continue

            target_class = header.get("target_class")
            conf = header.get("confidence", 0.5)
            roi_mode = header.get("roi_mode", "square")
            result = detector.detect(
                frame, target_class=target_class, conf=conf, roi_mode=roi_mode,
            )
            await write_response(writer, result)
    except ConnectionResetError:
        pass
    finally:
        writer.close()
        logger.info("%s disconnected", peer)


async def run_server(socket_path: str, model_path: str) -> None:
    # Clean stale socket
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    detector = Detector(model_path)

    async def on_connect(reader, writer):
        await handle_client(reader, writer, detector)

    server = await asyncio.start_unix_server(on_connect, path=socket_path)
    logger.info("Listening on %s", socket_path)

    stop = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()
    server.close()
    await server.wait_closed()
    if os.path.exists(socket_path):
        os.unlink(socket_path)
    logger.info("Server stopped")


def main():
    parser = argparse.ArgumentParser(description="YOLO inference worker")
    parser.add_argument("--socket-path", default="/tmp/inference.sock")
    parser.add_argument("--model", default="yolo11n.pt", help="Path to YOLO .pt model")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    asyncio.run(run_server(args.socket_path, args.model))


if __name__ == "__main__":
    main()
