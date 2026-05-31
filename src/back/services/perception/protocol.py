"""Sync version of the length-prefixed protocol for Unix socket communication."""

import json
import struct


def send_request(sock, header: dict, jpeg_bytes: bytes) -> None:
    """Send a request: header_len + jpeg_len + header JSON + JPEG bytes."""
    header_data = json.dumps(header).encode()
    sock.sendall(struct.pack(">II", len(header_data), len(jpeg_bytes)))
    sock.sendall(header_data)
    sock.sendall(jpeg_bytes)


def recv_response(sock) -> dict:
    """Read a length-prefixed JSON response."""
    raw = _recvall(sock, 4)
    payload_len = struct.unpack(">I", raw)[0]
    data = _recvall(sock, payload_len)
    return json.loads(data)


def _recvall(sock, n: int) -> bytes:
    """Read exactly n bytes from socket."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Socket closed while reading")
        buf.extend(chunk)
    return bytes(buf)
