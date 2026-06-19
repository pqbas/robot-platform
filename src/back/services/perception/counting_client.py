"""Client for the counting-worker control socket.

Mirrors ``ConversionClient``: synchronous, length-prefixed JSON, one socket
per call. Backend uses this to enqueue an offline count for a finished
recording and to poll for completion every few seconds.
"""

import json
import logging
import os
import socket
import struct

logger = logging.getLogger("counting_client")


class CountingWorkerUnavailable(Exception):
    """Counting worker socket is missing or refusing connections."""


class CountingClient:
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
                raise CountingWorkerUnavailable(
                    f"counting worker socket {self._socket_path}: {exc}"
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
                raise ConnectionError("counting worker closed connection")
            buf += chunk
        return buf

    def count(
        self,
        uuid: str,
        video_path: str,
        jsonl_path: str,
        engine_path: str,
        target_class: str | None,
        count_mode: str,
        threshold: float,
        direction: str,
        roi_mode: str,
        confidence: float,
        started_epoch: float | None,
        fps: float | None,
    ) -> dict:
        return self._send(
            {
                "cmd": "count",
                "uuid": uuid,
                "video_path": os.path.abspath(video_path),
                "jsonl_path": os.path.abspath(jsonl_path),
                "engine_path": os.path.abspath(engine_path)
                if os.sep in engine_path
                else engine_path,
                "target_class": target_class,
                "count_mode": count_mode,
                "threshold": threshold,
                "direction": direction,
                "roi_mode": roi_mode,
                "confidence": confidence,
                "started_epoch": started_epoch,
                "fps": fps,
            }
        )

    def status(self) -> dict:
        return self._send({"cmd": "status"})
