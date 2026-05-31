"""Client for the recording-worker control socket.

Mirrors the camera-worker client pattern (synchronous, length-prefixed JSON).
Each command opens a new socket — control traffic is rare so a pool is
overkill. Raises ``RecordingWorkerUnavailable`` if the worker isn't up so
the route layer can return a clean 503 instead of crashing.
"""

import json
import logging
import socket
import struct

logger = logging.getLogger("recording_client")


class RecordingWorkerUnavailable(Exception):
    """Recording worker socket is missing or refusing connections."""


class RecordingClient:
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
                raise RecordingWorkerUnavailable(
                    f"recording worker socket {self._socket_path}: {exc}"
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
                raise ConnectionError("recording worker closed connection")
            buf += chunk
        return buf

    def start(self, uuid: str, output_path: str) -> dict:
        return self._send({"cmd": "start", "uuid": uuid, "output_path": output_path})

    def stop(self) -> dict:
        return self._send({"cmd": "stop"})

    def status(self) -> dict:
        return self._send({"cmd": "status"})
