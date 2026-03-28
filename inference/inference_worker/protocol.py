"""Length-prefixed protocol for Unix socket communication.

Request (backend -> worker):
  [4 bytes: header_len (uint32 BE)]
  [4 bytes: jpeg_len (uint32 BE)]
  [header JSON bytes]
  [JPEG frame bytes]

Response (worker -> backend):
  [4 bytes: payload_len (uint32 BE)]
  [JSON payload bytes]
"""

import json
import struct


async def read_request(reader) -> tuple[dict, bytes] | None:
    """Read a request from the stream. Returns (header, jpeg_bytes) or None on EOF."""
    raw = await reader.readexactly(8)
    header_len, jpeg_len = struct.unpack(">II", raw)
    header_bytes = await reader.readexactly(header_len)
    jpeg_bytes = await reader.readexactly(jpeg_len)
    header = json.loads(header_bytes)
    return header, jpeg_bytes


async def write_response(writer, payload: dict) -> None:
    """Write a length-prefixed JSON response."""
    data = json.dumps(payload).encode()
    writer.write(struct.pack(">I", len(data)))
    writer.write(data)
    await writer.drain()
