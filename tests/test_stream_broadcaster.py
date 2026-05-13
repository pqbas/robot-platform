"""Tests for back/services/stream_broadcaster.py.

Mocks the camera + inference workers so we can verify lifecycle, fan-out,
drop-oldest, and the binary message layout without any sockets.
"""

import asyncio
import json
import struct
import time

import numpy as np
import pytest

from back.services import stream_broadcaster
from back.services.stream_broadcaster import StreamBroadcaster, _pack


@pytest.fixture
def fake_frame() -> np.ndarray:
    return np.full((4, 4, 3), 128, dtype=np.uint8)


@pytest.fixture
def patched_workers(monkeypatch, fake_frame):
    """Replace CameraClient.read_frame and _InferenceWorker so no real
    sockets are touched. Inference is a no-op."""

    class FakeCameraClient:
        def __init__(self, _path):
            pass

        def read_frame(self):
            time.sleep(0.02)
            return fake_frame

        def close(self):
            pass

    class FakeInferenceWorker:
        def start(self):
            pass

        def stop(self):
            pass

        def submit_frame(self, _frame):
            pass

        def consume_result(self):
            return None

    monkeypatch.setattr(stream_broadcaster, "CameraClient", FakeCameraClient)
    monkeypatch.setattr(stream_broadcaster, "_InferenceWorker", FakeInferenceWorker)
    yield


# ---------------------------------------------------------------------------
# _pack
# ---------------------------------------------------------------------------


def test_pack_header_length_prefix_and_jpeg_payload():
    header = {"frame_id": 42, "detections": [], "session_active": True}
    jpeg = b"\xff\xd8\xff\xe0PAYLOAD\xff\xd9"
    blob = _pack(header, jpeg)

    # Prefix is uint32 big-endian = header_len
    header_len = struct.unpack(">I", blob[:4])[0]
    assert header_len == len(json.dumps(header, separators=(",", ":")).encode("utf-8"))

    # Header bytes decode to the same dict
    header_bytes = blob[4 : 4 + header_len]
    assert json.loads(header_bytes.decode("utf-8")) == header

    # JPEG tail is the original bytes intact
    assert blob[4 + header_len :] == jpeg


# ---------------------------------------------------------------------------
# StreamBroadcaster lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_client_starts_thread_only_on_first(patched_workers):
    b = StreamBroadcaster()
    assert b._thread is None

    cid1, q1 = b.add_client()
    assert b._running is True
    assert b._thread is not None
    thread_after_first = b._thread

    cid2, q2 = b.add_client()
    assert b._thread is thread_after_first, "second client should not spawn a new thread"
    assert cid1 != cid2

    # Each client has its own queue with maxsize=1
    assert q1.maxsize == 1
    assert q2.maxsize == 1

    b.remove_client(cid1)
    b.remove_client(cid2)
    # Allow the loop one iteration to notice _running=False and exit.
    await asyncio.sleep(0.2)
    assert b._running is False


@pytest.mark.asyncio
async def test_remove_last_client_stops_thread_and_releases_camera(patched_workers):
    b = StreamBroadcaster()
    cid, _ = b.add_client()
    await asyncio.sleep(0.1)  # let the loop tick
    b.remove_client(cid)

    # Wait up to 1s for the thread to actually exit; read_frame sleeps 20ms
    # per iteration so this is enough.
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        if b._thread is not None and not b._thread.is_alive():
            break
        await asyncio.sleep(0.05)

    assert b._running is False
    assert b._thread is not None and not b._thread.is_alive()


@pytest.mark.asyncio
async def test_two_clients_receive_same_frame_id(patched_workers):
    b = StreamBroadcaster()
    cid1, q1 = b.add_client()
    cid2, q2 = b.add_client()

    msg1 = await asyncio.wait_for(q1.get(), timeout=1.0)
    msg2 = await asyncio.wait_for(q2.get(), timeout=1.0)

    def header_of(msg: bytes) -> dict:
        header_len = struct.unpack(">I", msg[:4])[0]
        return json.loads(msg[4 : 4 + header_len].decode("utf-8"))

    # We grabbed the first frame each queue saw. They were emitted from the
    # same broadcaster pass, so the frame_id matches.
    h1 = header_of(msg1)
    h2 = header_of(msg2)
    assert h1["frame_id"] == h2["frame_id"]
    assert h1["session_active"] is False
    assert h1["detections"] == []

    b.remove_client(cid1)
    b.remove_client(cid2)
    await asyncio.sleep(0.2)


@pytest.mark.asyncio
async def test_drop_oldest_replaces_stale_frame(patched_workers):
    """A slow client that never reads should not block; its queue keeps the
    newest frame and the rest of the system stays responsive."""
    b = StreamBroadcaster()
    cid_slow, q_slow = b.add_client()
    cid_fast, q_fast = b.add_client()

    # Let the broadcaster produce several frames.
    await asyncio.sleep(0.25)

    # Fast client drains; slow client never reads. The slow queue holds at
    # most one frame.
    drained = 0
    while not q_fast.empty():
        q_fast.get_nowait()
        drained += 1

    assert drained >= 1, "fast client should have received at least one frame"
    assert q_slow.qsize() == 1, "slow client queue should have exactly one frame (drop-oldest)"

    # Read the frame from the slow client — it should be a newer one, not the
    # very first.
    msg = q_slow.get_nowait()
    header_len = struct.unpack(">I", msg[:4])[0]
    header = json.loads(msg[4 : 4 + header_len].decode("utf-8"))
    assert header["frame_id"] >= 1

    b.remove_client(cid_slow)
    b.remove_client(cid_fast)
    await asyncio.sleep(0.2)
