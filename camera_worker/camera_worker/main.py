"""Camera worker — captures V4L2 frames and serves them via Unix socket.

Fan-out: opens the camera once, broadcasts each frame to every connected client
(per-client asyncio.Queue with maxsize=2 + drop-oldest if a consumer lags).
"""

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
    parser.add_argument("--index", type=int, default=int(os.getenv("CAMERA_INDEX", "0")))
    parser.add_argument("--width", type=int, default=int(os.getenv("CAMERA_WIDTH", "2560")))
    parser.add_argument("--height", type=int, default=int(os.getenv("CAMERA_HEIGHT", "720")))
    parser.add_argument("--crop", type=int, default=int(os.getenv("CAMERA_CROP", "1280")))
    parser.add_argument("--fps", type=float, default=float(os.getenv("CAMERA_FPS", "30")))
    return parser.parse_args()


def open_camera(args):
    while True:
        cap = cv2.VideoCapture(args.index)
        # Force YUYV (uncompressed) so the encoder receives clean pixels
        # instead of a re-encoded MJPEG source. Falls back silently to
        # whatever the camera negotiates if YUYV is rejected.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"YUYV"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
        cap.set(cv2.CAP_PROP_FPS, args.fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            actual_fps = float(cap.get(cv2.CAP_PROP_FPS)) or args.fps
            actual_fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
            fourcc_str = "".join(
                chr((actual_fourcc >> 8 * i) & 0xFF) for i in range(4)
            )
            logger.info(
                "Camera opened (index=%d) — actual %dx%d @ %.1ffps fourcc=%s",
                args.index, actual_width, actual_height, actual_fps, fourcc_str,
            )
            return cap, actual_width, actual_height, actual_fps
        cap.release()
        logger.warning("Camera not available — retrying in 1s")
        time.sleep(1)


class FrameBroadcaster:
    """Single producer (V4L2 capture), multiple consumers (asyncio Queues).

    Each consumer gets its own queue (maxsize=2). When a queue is full, the
    oldest frame is dropped — slow consumers cannot stall fast ones.
    """

    def __init__(self, args):
        self._args = args
        self._cap = None
        self._actual_width = 0
        self._actual_height = 0
        self._actual_fps = 0.0
        self._out_width = 0
        self._out_height = 0
        self._clients: list[asyncio.Queue[bytes]] = []
        self._produce_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    @property
    def out_width(self) -> int:
        return self._out_width

    @property
    def out_height(self) -> int:
        return self._out_height

    @property
    def out_fps(self) -> float:
        return self._actual_fps

    async def start(self):
        loop = asyncio.get_event_loop()
        (
            self._cap,
            self._actual_width,
            self._actual_height,
            self._actual_fps,
        ) = await loop.run_in_executor(None, open_camera, self._args)
        crop = self._args.crop
        self._out_width = (
            min(crop, self._actual_width) if crop > 0 else self._actual_width
        )
        self._out_height = self._actual_height
        self._produce_task = asyncio.create_task(self._produce(), name="frame-producer")

    async def add_client(self) -> asyncio.Queue[bytes]:
        q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=2)
        async with self._lock:
            self._clients.append(q)
        return q

    async def remove_client(self, q: asyncio.Queue[bytes]) -> None:
        async with self._lock:
            try:
                self._clients.remove(q)
            except ValueError:
                pass

    async def _produce(self) -> None:
        loop = asyncio.get_event_loop()

        def read_frame():
            return self._cap.read()

        while not _shutdown.is_set():
            try:
                ret, frame = await loop.run_in_executor(None, read_frame)
            except Exception as exc:
                logger.warning("Camera read error: %s — reopening", exc)
                ret, frame = False, None

            if not ret or frame is None:
                logger.warning("Camera disconnected — reopening")
                try:
                    self._cap.release()
                except Exception:
                    pass
                (
                    self._cap,
                    self._actual_width,
                    self._actual_height,
                    self._actual_fps,
                ) = await loop.run_in_executor(None, open_camera, self._args)
                continue

            cropped = (
                frame[:, : self._out_width]
                if self._out_width < self._actual_width
                else frame
            )
            raw = cropped.tobytes()

            # Snapshot client list under the lock so we can iterate without holding it.
            async with self._lock:
                clients = list(self._clients)

            for q in clients:
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                try:
                    q.put_nowait(raw)
                except asyncio.QueueFull:
                    pass

        try:
            self._cap.release()
        except Exception:
            pass


async def handle_client(
    _reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    broadcaster: FrameBroadcaster,
):
    logger.info("Client connected")

    handshake = json.dumps(
        {
            "width": broadcaster.out_width,
            "height": broadcaster.out_height,
            "channels": 3,
            "fps": broadcaster.out_fps,
        }
    ).encode()
    header = struct.pack(">I", len(handshake))
    writer.write(header + handshake)
    try:
        await writer.drain()
    except (ConnectionResetError, BrokenPipeError, OSError):
        logger.info("Client disconnected during handshake")
        writer.close()
        return

    q = await broadcaster.add_client()

    try:
        while not _shutdown.is_set():
            try:
                raw = await asyncio.wait_for(q.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            frame_len = struct.pack(">I", len(raw))
            try:
                writer.write(frame_len + raw)
                await writer.drain()
            except (ConnectionResetError, BrokenPipeError, OSError):
                logger.info("Client disconnected")
                break
    finally:
        await broadcaster.remove_client(q)
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

    broadcaster = FrameBroadcaster(args)
    await broadcaster.start()

    def client_handler(reader, writer):
        asyncio.ensure_future(handle_client(reader, writer, broadcaster))

    server = await asyncio.start_unix_server(client_handler, path=args.socket_path)
    logger.info("Listening on %s", args.socket_path)

    await _shutdown.wait()
    server.close()
    await server.wait_closed()
    logger.info("Camera worker stopped")


def main():
    args = parse_args()

    try:
        os.unlink(args.socket_path)
    except FileNotFoundError:
        pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
