"""Synchronous Unix socket client for the camera worker."""

import json
import logging
import socket
import struct

import numpy as np

logger = logging.getLogger("camera_client")


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
        """Block until the next frame arrives. Reconnects once on failure."""
        try:
            self._connect()
            frame_len = struct.unpack(">I", self._recv_exact(4))[0]
            raw = self._recv_exact(frame_len)
        except (ConnectionError, OSError, struct.error):
            self._disconnect()
            self._connect()
            frame_len = struct.unpack(">I", self._recv_exact(4))[0]
            raw = self._recv_exact(frame_len)

        return np.frombuffer(raw, dtype=np.uint8).reshape(
            self._height, self._width, self._channels
        ).copy()

    def close(self) -> None:
        self._disconnect()
