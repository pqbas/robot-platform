"""Camera worker — captures V4L2 frames and serves them via Unix socket.

Fan-out: opens the camera once, broadcasts each frame to every connected client
(per-client asyncio.Queue with maxsize=2 + drop-oldest if a consumer lags).

Two sockets:
- frames socket (default ``/tmp/camera.sock``) — handshake + length-prefixed
  raw YUYV (YUY2 4:2:2, 2 bytes/px) frames. Color conversion to NV12 happens
  downstream in hardware (nvvidconv/VIC). Consumers: WebRTC backend +
  recording-worker.
- control socket (default ``/tmp/camera-control.sock``) — JSON length-prefixed
  request/response. Used by the backend to swap the active resolution preset
  without restarting the systemd unit (Phase 11).
"""

import asyncio
import json
import logging
import os
import signal
import struct
import time
import urllib.request

import cv2
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("camera_worker")

_shutdown = asyncio.Event()


# Closed set of resolution presets the camera-worker accepts via the settings
# JSON. Numbers come from `camera_worker/README.md` (Resolution modes); the
# crop selects the left eye out of the ZED 2i side-by-side stereo frame.
PRESETS: dict[str, dict[str, int]] = {
    "1080p": {"width": 3840, "height": 1080, "crop": 1920},
    "720p": {"width": 2560, "height": 720, "crop": 1280},
}


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Camera worker")
    parser.add_argument(
        "--socket-path",
        default=os.getenv("CAMERA_SOCKET", "/tmp/camera.sock"),
    )
    parser.add_argument(
        "--control-socket",
        default=os.getenv("CAMERA_CONTROL_SOCKET", "/tmp/camera-control.sock"),
    )
    parser.add_argument(
        "--settings-path",
        default=os.getenv("CAMERA_SETTINGS_PATH", "data/robot/camera_settings.json"),
    )
    parser.add_argument("--index", type=int, default=int(os.getenv("CAMERA_INDEX", "0")))
    parser.add_argument("--width", type=int, default=int(os.getenv("CAMERA_WIDTH", "2560")))
    parser.add_argument("--height", type=int, default=int(os.getenv("CAMERA_HEIGHT", "720")))
    parser.add_argument("--crop", type=int, default=int(os.getenv("CAMERA_CROP", "1280")))
    parser.add_argument("--fps", type=float, default=float(os.getenv("CAMERA_FPS", "30")))
    parser.add_argument(
        "--rtsp-url",
        default=os.getenv("CAMERA_RTSP_URL", ""),
        help="RTSP/HTTP URL for IP camera. If set, ignores --index.",
    )
    return parser.parse_args()


def _load_preset_override(settings_path: str | None) -> dict | None:
    """Return override dict from the settings JSON.

    May contain width/height/crop (from preset) and/or rtsp_url.
    None means "no JSON / unreadable" — caller keeps the values already on
    `args` (env vars or CLI flags).
    """
    if not settings_path or not os.path.exists(settings_path):
        return None
    try:
        with open(settings_path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning(
            "Camera settings file %s unreadable (%s) — falling back to env/CLI",
            settings_path, exc,
        )
        return None
    override: dict = {}
    preset = data.get("preset")
    if preset is not None:
        if preset not in PRESETS:
            logger.warning(
                "Camera settings file %s has invalid preset=%r — ignoring preset",
                settings_path, preset,
            )
        else:
            logger.info("Camera settings: applying preset=%s from %s", preset, settings_path)
            override.update(PRESETS[preset])
    rtsp_url = data.get("rtsp_url")
    if rtsp_url:
        logger.info("Camera settings: applying rtsp_url from %s", settings_path)
        override["rtsp_url"] = rtsp_url
    return override if override else None


def _apply_override(args, override: dict | None) -> None:
    if override is None:
        return
    if "width" in override:
        args.width = override["width"]
    if "height" in override:
        args.height = override["height"]
    if "crop" in override:
        args.crop = override["crop"]
    if "rtsp_url" in override:
        args.rtsp_url = override["rtsp_url"]


class MultipartYUYVCapture:
    """Reads raw YUYV frames from an HTTP ``multipart/x-mixed-replace`` stream.

    The IP camera server streams uncompressed YUYV (YUY2 4:2:2, 2 bytes/px)
    parts, each preceded by a boundary line and MIME-style headers
    (``Content-Length`` + ``X-Frame-Width`` / ``X-Frame-Height``). Reading those
    bytes straight through preserves the fan-out contract (raw YUYV,
    ``channels=2``) with **zero CPU color conversion**.

    ``cv2.VideoCapture`` cannot be used here: for network sources OpenCV's
    FFmpeg backend always decodes to 3-channel BGR and ignores
    ``CAP_PROP_CONVERT_RGB=0``, so it hands back 3 bytes/px that then blow up the
    ``(H, W, 2)`` reshape in the consumer. This reader keeps the pixels raw.

    Exposes the subset of the ``cv2.VideoCapture`` interface that the worker
    uses: ``isOpened()``, ``read() -> (ok, frame)``, ``get(prop)``, ``release()``.
    """

    def __init__(self, url, timeout=10.0):
        self._url = url
        self._timeout = timeout
        self._resp = None
        self.width = 0
        self.height = 0
        self._pending = None

        req = urllib.request.Request(url, headers={"User-Agent": "camera-worker"})
        self._resp = urllib.request.urlopen(req, timeout=timeout)
        ctype = self._resp.headers.get("Content-Type", "")
        if "multipart/x-mixed-replace" not in ctype:
            self.release()
            raise RuntimeError(
                f"expected multipart/x-mixed-replace stream, got {ctype!r}"
            )

        # Prime one frame so width/height are known before the handshake.
        ok, frame = self._read_part()
        if not ok:
            self.release()
            raise RuntimeError("could not read first frame from multipart stream")
        self._pending = frame

    def isOpened(self):
        return self._resp is not None

    def _read_exact(self, n):
        buf = bytearray()
        while len(buf) < n:
            chunk = self._resp.read(n - len(buf))
            if not chunk:
                raise ConnectionError("stream closed mid-frame")
            buf += chunk
        return bytes(buf)

    def _read_part(self):
        # Skip blank lines until the boundary marker (``--frame``).
        line = self._resp.readline()
        while line in (b"\r\n", b"\n"):
            line = self._resp.readline()
        if not line:
            return False, None  # stream ended cleanly

        # Parse the part headers up to the blank separator line.
        headers = {}
        while True:
            hline = self._resp.readline()
            if hline in (b"\r\n", b"\n", b""):
                break
            key, _, val = hline.decode("latin-1").partition(":")
            headers[key.strip().lower()] = val.strip()

        length = int(headers["content-length"])
        width = int(headers.get("x-frame-width", self.width))
        height = int(headers.get("x-frame-height", self.height))
        expected = width * height * 2
        if length != expected:
            raise ValueError(
                f"YUYV size mismatch: got {length} bytes, expected {expected} "
                f"for {width}x{height} (2 bytes/px)"
            )
        body = self._read_exact(length)
        self.width, self.height = width, height
        frame = np.frombuffer(body, dtype=np.uint8).reshape(height, width, 2)
        return True, frame

    def read(self):
        if self._pending is not None:
            frame, self._pending = self._pending, None
            return True, frame
        try:
            return self._read_part()
        except Exception as exc:
            logger.warning("multipart YUYV read failed: %s", exc)
            return False, None

    def get(self, prop):
        if prop == cv2.CAP_PROP_FRAME_WIDTH:
            return float(self.width)
        if prop == cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self.height)
        return 0.0

    def release(self):
        if self._resp is not None:
            try:
                self._resp.close()
            except Exception:
                pass
            self._resp = None


def open_camera(args):
    rtsp_url = getattr(args, "rtsp_url", "")
    if rtsp_url:
        # IP camera path.
        # Crop is forced to 0: stereo-split only applies to the ZED 2i USB camera.
        args.crop = 0
        is_http = rtsp_url.lower().startswith(("http://", "https://"))
        while True:
            if is_http:
                # HTTP multipart/x-mixed-replace of raw YUYV parts. Read the
                # bytes straight through (no decode) so the fan-out stays raw
                # YUYV; cv2.VideoCapture would force a CPU BGR decode here.
                try:
                    cap = MultipartYUYVCapture(rtsp_url)
                    actual_width = cap.width
                    actual_height = cap.height
                    actual_fps = args.fps
                    logger.info(
                        "Camera opened (ip=%s) — actual %dx%d @ %.1ffps (raw YUYV)",
                        rtsp_url, actual_width, actual_height, actual_fps,
                    )
                    return cap, actual_width, actual_height, actual_fps
                except Exception as exc:
                    logger.warning(
                        "IP camera stream not available (%s) — retrying in 1s", exc
                    )
                    time.sleep(1)
                    continue
            # Non-HTTP (e.g. rtsp://) still goes through OpenCV.
            cap = cv2.VideoCapture(rtsp_url)
            if cap.isOpened():
                actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                actual_fps = float(cap.get(cv2.CAP_PROP_FPS)) or args.fps
                logger.info(
                    "Camera opened (rtsp=%s) — actual %dx%d @ %.1ffps",
                    rtsp_url, actual_width, actual_height, actual_fps,
                )
                return cap, actual_width, actual_height, actual_fps
            cap.release()
            logger.warning("RTSP stream not available — retrying in 1s")
            time.sleep(1)
    else:
        # V4L2 USB camera path (default).
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
            # Ask V4L2 for the raw YUYV buffer (2 bytes/px, shape (H, W, 2))
            # instead of letting OpenCV decode it to BGR on the CPU. The single
            # color conversion then happens downstream in hardware (nvvidconv /
            # VIC), never per-frame on a CPU core.
            cap.set(cv2.CAP_PROP_CONVERT_RGB, 0)
            if cap.isOpened():
                actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                actual_fps = float(cap.get(cv2.CAP_PROP_FPS)) or args.fps
                actual_fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
                fourcc_str = "".join(
                    chr((actual_fourcc >> 8 * i) & 0xFF) for i in range(4)
                )
                convert_rgb = cap.get(cv2.CAP_PROP_CONVERT_RGB)
                logger.info(
                    "Camera opened (index=%d) — actual %dx%d @ %.1ffps "
                    "fourcc=%s convert_rgb=%s",
                    args.index, actual_width, actual_height, actual_fps,
                    fourcc_str, convert_rgb,
                )
                # If the driver ignored CONVERT_RGB=0 it will hand us decoded
                # BGR (3 bytes/px) while the handshake advertises YUYV (2 bytes).
                # Abort loudly rather than serve mislabeled frames.
                if convert_rgb >= 0.5:
                    cap.release()
                    raise RuntimeError(
                        "camera driver ignored CAP_PROP_CONVERT_RGB=0 "
                        "(get() returned %s); the fan-out expects raw YUYV. "
                        "Re-enable the CPU BGR path or use a driver that "
                        "honors the flag." % convert_rgb
                    )
                return cap, actual_width, actual_height, actual_fps
            cap.release()
            logger.warning("Camera not available — retrying in 1s")
            time.sleep(1)


class FrameBroadcaster:
    """Single producer (V4L2 capture), multiple consumers (asyncio Queues).

    Each consumer gets its own queue (maxsize=2). When a queue is full, the
    oldest frame is dropped — slow consumers cannot stall fast ones.

    Reload: the control socket can request a settings reload. The producer
    closes the V4L2 device, re-reads the preset JSON, reopens the camera at
    the new dimensions, and existing clients are kicked with a sentinel so
    they reconnect and receive the new handshake.
    """

    _SENTINEL: bytes = b""

    def __init__(self, args):
        self._args = args
        self._settings_path = args.settings_path
        self._cap = None
        self._actual_width = 0
        self._actual_height = 0
        self._actual_fps = 0.0
        self._out_width = 0
        self._out_height = 0
        self._clients: list[asyncio.Queue[bytes]] = []
        self._produce_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        # Reload coordination. _reload_request is set by reload(), checked by
        # _produce(). _reload_complete is set when the producer has finished
        # the swap; reload() awaits it. add_client() also awaits it so a new
        # consumer never reads the stale handshake mid-swap.
        self._reload_request: asyncio.Event = asyncio.Event()
        self._reload_complete: asyncio.Event = asyncio.Event()
        self._reload_complete.set()

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
        # Apply settings JSON override before the first open, so the worker
        # respects the operator's saved preset across restarts.
        override = _load_preset_override(self._settings_path)
        _apply_override(self._args, override)
        (
            self._cap,
            self._actual_width,
            self._actual_height,
            self._actual_fps,
        ) = await loop.run_in_executor(None, open_camera, self._args)
        crop = self._args.crop
        # Force an even output width: a YUYV macropixel spans 2 columns, so an
        # odd crop would split it and corrupt the chroma. No-op at 1920.
        self._out_width = (
            min(crop, self._actual_width) if crop > 0 else self._actual_width
        ) & ~1
        self._out_height = self._actual_height
        self._produce_task = asyncio.create_task(self._produce(), name="frame-producer")

    async def add_client(self) -> asyncio.Queue[bytes]:
        # If a reload is in flight, hold off until the producer has swapped
        # so the handshake we send the new client matches the frames it
        # will receive.
        await self._reload_complete.wait()
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

    async def reload(self) -> dict:
        """Disconnect every consumer, reopen the camera with the JSON preset.

        Returns the new dimensions/fps so the control client can confirm the
        swap landed.
        """
        # 1) Drop existing clients with a sentinel so handle_client closes
        #    its writer and the downstream consumer reconnects.
        async with self._lock:
            existing = list(self._clients)
            self._clients = []
        for q in existing:
            # Drain so put_nowait will succeed even if the queue is full.
            while True:
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    break
            try:
                q.put_nowait(self._SENTINEL)
            except asyncio.QueueFull:
                pass

        # 2) Ask the producer to swap the camera. add_client() blocks on
        #    _reload_complete so any new connection waits for the new
        #    handshake values.
        self._reload_complete.clear()
        self._reload_request.set()
        await self._reload_complete.wait()
        return {
            "width": self._out_width,
            "height": self._out_height,
            "fps": self._actual_fps,
        }

    async def _produce(self) -> None:
        loop = asyncio.get_event_loop()

        def read_frame():
            return self._cap.read()

        def reopen():
            try:
                self._cap.release()
            except Exception:
                pass
            override = _load_preset_override(self._settings_path)
            _apply_override(self._args, override)
            return open_camera(self._args)

        while not _shutdown.is_set():
            if self._reload_request.is_set():
                logger.info("Reload requested — reopening camera")
                try:
                    (
                        self._cap,
                        self._actual_width,
                        self._actual_height,
                        self._actual_fps,
                    ) = await loop.run_in_executor(None, reopen)
                    crop = self._args.crop
                    self._out_width = (
                        min(crop, self._actual_width)
                        if crop > 0
                        else self._actual_width
                    ) & ~1
                    self._out_height = self._actual_height
                finally:
                    self._reload_request.clear()
                    self._reload_complete.set()
                continue

            try:
                ret, frame = await loop.run_in_executor(None, read_frame)
            except Exception as exc:
                logger.warning("Camera read error: %s — reopening", exc)
                ret, frame = False, None

            if not ret or frame is None:
                logger.warning("Camera disconnected — reopening")
                (
                    self._cap,
                    self._actual_width,
                    self._actual_height,
                    self._actual_fps,
                ) = await loop.run_in_executor(None, reopen)
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

    # Register first so the handshake values are read after any in-flight
    # reload has settled (add_client awaits _reload_complete).
    q = await broadcaster.add_client()

    handshake = json.dumps(
        {
            "width": broadcaster.out_width,
            "height": broadcaster.out_height,
            "channels": 2,
            "fps": broadcaster.out_fps,
        }
    ).encode()
    header = struct.pack(">I", len(handshake))
    writer.write(header + handshake)
    try:
        await writer.drain()
    except (ConnectionResetError, BrokenPipeError, OSError):
        logger.info("Client disconnected during handshake")
        await broadcaster.remove_client(q)
        writer.close()
        return

    try:
        while not _shutdown.is_set():
            try:
                raw = await asyncio.wait_for(q.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            # Reload sentinel: empty bytes means the broadcaster has dropped
            # us so it can swap resolutions. Close the writer and let the
            # consumer reconnect to pick up the new handshake.
            if raw == b"":
                logger.info("Reload sentinel — closing client")
                break

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


async def handle_control(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    broadcaster: FrameBroadcaster,
):
    """JSON length-prefixed request/response for the control socket.

    Commands:
      {"cmd": "reload"} → {"ok": true, "width": ..., "height": ..., "fps": ...}
      {"cmd": "status"} → {"ok": true, "width": ..., "height": ..., "fps": ...}
      anything else      → {"ok": false, "error": "unknown_cmd: ..."}
    """
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
        if cmd == "reload":
            try:
                dims = await broadcaster.reload()
                response = {"ok": True, **dims}
            except Exception as exc:
                logger.exception("Reload failed")
                response = {"ok": False, "error": f"reload_failed: {exc}"}
        elif cmd == "status":
            response = {
                "ok": True,
                "width": broadcaster.out_width,
                "height": broadcaster.out_height,
                "fps": broadcaster.out_fps,
            }
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

    def control_handler(reader, writer):
        asyncio.ensure_future(handle_control(reader, writer, broadcaster))

    frames_server = await asyncio.start_unix_server(client_handler, path=args.socket_path)
    logger.info("Frames listening on %s", args.socket_path)

    control_server = await asyncio.start_unix_server(control_handler, path=args.control_socket)
    logger.info("Control listening on %s", args.control_socket)

    await _shutdown.wait()
    frames_server.close()
    control_server.close()
    await frames_server.wait_closed()
    await control_server.wait_closed()
    logger.info("Camera worker stopped")


def main():
    args = parse_args()

    for path in (args.socket_path, args.control_socket):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass

    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
