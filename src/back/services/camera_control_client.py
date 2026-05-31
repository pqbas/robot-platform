"""Client for the camera-worker control socket (Phase 11).

Mirrors the recording_client pattern: synchronous, length-prefixed JSON,
one-shot socket per command. Raises ``CameraWorkerUnavailable`` when the
socket isn't there so route layers can return a clean 503.
"""

from __future__ import annotations

import json
import logging
import socket
import struct

logger = logging.getLogger("camera_control_client")


class CameraWorkerUnavailable(Exception):
    """Camera worker control socket is missing or refusing connections."""


class CameraControlClient:
    def __init__(self, socket_path: str, timeout: float = 5.0):
        self._socket_path = socket_path
        self._timeout = timeout

    def _send(self, payload: dict) -> dict:
        body = json.dumps(payload).encode()
        header = struct.pack(">I", len(body))

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self._timeout)
        try:
            try:
                sock.connect(self._socket_path)
            except (FileNotFoundError, ConnectionRefusedError, OSError) as exc:
                raise CameraWorkerUnavailable(
                    f"camera control socket {self._socket_path}: {exc}"
                ) from exc

            sock.sendall(header + body)

            resp_header = self._recv_exact(sock, 4)
            resp_len = struct.unpack(">I", resp_header)[0]
            resp_body = self._recv_exact(sock, resp_len)
            return json.loads(resp_body.decode())
        finally:
            try:
                sock.close()
            except OSError:
                pass

    @staticmethod
    def _recv_exact(sock: socket.socket, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("camera worker closed connection")
            buf += chunk
        return buf

    def reload(self) -> dict:
        return self._send({"cmd": "reload"})

    def status(self) -> dict:
        return self._send({"cmd": "status"})
