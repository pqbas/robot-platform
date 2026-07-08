"""Client for the classification-worker control socket.

Mirrors ``CountingClient``: synchronous, length-prefixed JSON, one socket per
call. Backend uses this to enqueue an offline ripeness classification for a
finished+counted recording and to poll for completion.
"""

import json
import logging
import os
import socket
import struct

logger = logging.getLogger("classification_client")


class ClassificationWorkerUnavailable(Exception):
    """Classification worker socket is missing or refusing connections."""


class ClassificationClient:
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
                raise ClassificationWorkerUnavailable(
                    f"classification worker socket {self._socket_path}: {exc}"
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
                raise ConnectionError("classification worker closed connection")
            buf += chunk
        return buf

    def classify(
        self,
        uuid: str,
        video_path: str,
        crossings_path: str,
        classifications_path: str,
        crops_dir: str,
        model_path: str,
    ) -> dict:
        return self._send(
            {
                "cmd": "classify",
                "uuid": uuid,
                "video_path": os.path.abspath(video_path),
                "crossings_path": os.path.abspath(crossings_path),
                "classifications_path": os.path.abspath(classifications_path),
                "crops_dir": os.path.abspath(crops_dir),
                "model_path": os.path.abspath(model_path)
                if os.sep in model_path
                else model_path,
            }
        )

    def status(self) -> dict:
        return self._send({"cmd": "status"})
