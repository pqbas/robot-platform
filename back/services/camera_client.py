"""Synchronous Unix socket client for the camera worker."""

import json
import logging
import socket
import struct
import time

import numpy as np

logger = logging.getLogger("camera_client")

# How long wait_for_socket probes between attempts (seconds)
_SOCKET_PROBE_INTERVAL = 0.25

# How long read_frame retries before abandoning the track
STREAM_READ_TIMEOUT_S = 5


def wait_for_socket(path: str, timeout: float) -> None:
    """Block until the Unix socket at *path* accepts a connection or raise TimeoutError.

    Checks both that the path exists AND that a real connect succeeds, because
    the camera-worker may have created the socket file before it called
    accept().  Retries every _SOCKET_PROBE_INTERVAL seconds up to *timeout*.
    """
    deadline = time.monotonic() + timeout
    attempt = 0
    while True:
        attempt += 1
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(1.0)
            sock.connect(path)
            sock.close()
            logger.info(
                "wait_for_socket: camera socket ready after %d probe(s)", attempt
            )
            return
        except (FileNotFoundError, ConnectionRefusedError):
            pass
        except OSError:
            pass
        finally:
            try:
                sock.close()
            except Exception:
                pass

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(
                f"Camera socket {path!r} not available after {timeout:.1f}s"
            )
        time.sleep(min(_SOCKET_PROBE_INTERVAL, remaining))


class CameraClient:
    def __init__(self, socket_path: str):
        self._socket_path = socket_path
        self._sock: socket.socket | None = None
        self._width: int = 0
        self._height: int = 0
        self._channels: int = 3

    def _connect(self) -> None:
        if self._sock is not None:
            return
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self._socket_path)
        self._sock = sock
        # Read handshake
        header_len = struct.unpack(">I", self._recv_exact(4))[0]
        handshake = json.loads(self._recv_exact(header_len).decode())
        self._width = handshake["width"]
        self._height = handshake["height"]
        self._channels = handshake["channels"]
        logger.info(
            "Connected to camera worker — %dx%dx%d",
            self._width,
            self._height,
            self._channels,
        )

    def _disconnect(self) -> None:
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
                raise ConnectionError("Camera worker closed connection")
            buf += chunk
        return buf

    def read_frame(self) -> np.ndarray:
        """Block until the next frame arrives.

        On failure, retries reconnecting with short backoff delays for up to
        STREAM_READ_TIMEOUT_S seconds before raising.  Each attempt disconnects
        fully and reconnects from scratch so we never try to recv on a broken
        socket.
        """
        _BACKOFF = [0.0, 0.2, 0.5, 1.0]  # seconds; first attempt is immediate
        deadline = time.monotonic() + STREAM_READ_TIMEOUT_S
        last_exc: Exception | None = None

        for attempt, delay in enumerate(_BACKOFF):
            if attempt > 0:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(min(delay, remaining))
                logger.info(
                    "[camera_client] read_frame retry %d (%.1fs budget remaining)",
                    attempt,
                    deadline - time.monotonic(),
                )
                self._disconnect()

            try:
                self._connect()
                frame_len = struct.unpack(">I", self._recv_exact(4))[0]
                raw = self._recv_exact(frame_len)
                return np.frombuffer(raw, dtype=np.uint8).reshape(
                    self._height, self._width, self._channels
                ).copy()
            except (ConnectionError, OSError, struct.error) as exc:
                last_exc = exc
                self._disconnect()

        # Budget exhausted — propagate so CameraStreamTrack.recv can stop the track
        raise ConnectionError(
            f"Camera read failed after {STREAM_READ_TIMEOUT_S}s ({last_exc})"
        )

    def close(self) -> None:
        self._disconnect()
