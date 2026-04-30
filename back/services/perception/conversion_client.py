"""Client for the conversion-worker control socket.

Mirrors ``RecordingClient``: synchronous, length-prefixed JSON, one socket
per call. Backend uses this to kick off TensorRT engine builds and to
poll for completion every few seconds.
"""

import json
import logging
import socket
import struct

logger = logging.getLogger("conversion_client")


class ConversionWorkerUnavailable(Exception):
    """Conversion worker socket is missing or refusing connections."""


class ConversionClient:
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
                raise ConversionWorkerUnavailable(
                    f"conversion worker socket {self._socket_path}: {exc}"
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
                raise ConnectionError("conversion worker closed connection")
            buf += chunk
        return buf

    def convert(
        self, pt_path: str, engine_path: str, precision: str = "fp16"
    ) -> dict:
        return self._send(
            {
                "cmd": "convert",
                "pt_path": pt_path,
                "engine_path": engine_path,
                "precision": precision,
            }
        )

    def status(self) -> dict:
        return self._send({"cmd": "status"})
