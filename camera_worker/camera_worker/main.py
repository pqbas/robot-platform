"""Camera worker — captures V4L2 frames and serves them via Unix socket."""

import asyncio
import json
import logging
import os
import signal
import struct
import time

import cv2

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("camera_worker")

_shutdown = asyncio.Event()


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Camera worker")
    parser.add_argument(
        "--socket-path",
        default=os.getenv("CAMERA_SOCKET", "/tmp/camera.sock"),
    )
    parser.add_argument("--index", type=int, default=int(os.getenv("CAMERA_INDEX", "1")))
    parser.add_argument("--width", type=int, default=int(os.getenv("CAMERA_WIDTH", "2560")))
    parser.add_argument("--height", type=int, default=int(os.getenv("CAMERA_HEIGHT", "720")))
    parser.add_argument("--crop", type=int, default=int(os.getenv("CAMERA_CROP", "1280")))
    return parser.parse_args()


def open_camera(args) -> tuple[cv2.VideoCapture, int, int]:
    while True:
        cap = cv2.VideoCapture(args.index)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            logger.info(
                "Camera opened (index=%d) — actual resolution %dx%d",
                args.index, actual_width, actual_height,
            )
            return cap, actual_width, actual_height
        cap.release()
        logger.warning("Camera not available — retrying in 1s")
        time.sleep(1)


async def handle_client(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter, args):
    logger.info("Client connected")

    loop = asyncio.get_event_loop()
    cap, actual_width, actual_height = await loop.run_in_executor(None, open_camera, args)

    # Clamp crop to actual width; if crop=0 or exceeds actual width, send full frame
    out_width = min(args.crop, actual_width) if args.crop > 0 else actual_width
    out_height = actual_height

    # Send handshake with real dimensions
    handshake = json.dumps(
        {"width": out_width, "height": out_height, "channels": 3}
    ).encode()
    header = struct.pack(">I", len(handshake))
    writer.write(header + handshake)
    await writer.drain()

    def read_frame():
        ret, frame = cap.read()
        return ret, frame

    try:
        while not _shutdown.is_set():
            try:
                ret, frame = await loop.run_in_executor(None, read_frame)
            except Exception as exc:
                logger.warning("Camera read error: %s", exc)
                break

            if not ret or frame is None:
                logger.warning("Camera disconnected — waiting for reconnect")
                break

            cropped = frame[:, :out_width] if out_width < actual_width else frame
            raw = cropped.tobytes()
            frame_len = struct.pack(">I", len(raw))
            try:
                writer.write(frame_len + raw)
                await writer.drain()
            except (ConnectionResetError, BrokenPipeError, OSError):
                logger.info("Client disconnected")
                break
    finally:
        cap.release()
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        logger.info("Client session ended")


async def serve(args):
    loop = asyncio.get_event_loop()

    def _stop():
        _shutdown.set()

    loop.add_signal_handler(signal.SIGTERM, _stop)
    loop.add_signal_handler(signal.SIGINT, _stop)

    def client_handler(reader, writer):
        asyncio.ensure_future(handle_client(reader, writer, args))

    server = await asyncio.start_unix_server(client_handler, path=args.socket_path)
    logger.info("Listening on %s", args.socket_path)

    await _shutdown.wait()
    server.close()
    await server.wait_closed()
    logger.info("Camera worker stopped")


def main():
    args = parse_args()

    # Remove stale socket
    try:
        os.unlink(args.socket_path)
    except FileNotFoundError:
        pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
