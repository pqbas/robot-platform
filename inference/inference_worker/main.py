"""Inference worker — Unix socket server that receives JPEG frames and returns detections."""

import argparse
import asyncio
import logging
import os
import signal
import sys

import cv2
import numpy as np

from inference_worker.detector import Detector
from inference_worker.protocol import read_request, write_response

logger = logging.getLogger("inference_worker")


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
            frame = cv2.imdecode(np.frombuffer(jpeg_bytes, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await write_response(writer, {"error": "invalid JPEG"})
                continue

            target_class = header.get("target_class")
            conf = header.get("confidence", 0.5)
            result = detector.detect(frame, target_class=target_class, conf=conf)
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
