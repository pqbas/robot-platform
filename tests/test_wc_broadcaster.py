"""Tests para back/services/wc_broadcaster.py + back/services/h264_encoder.py.

Mockean CameraClient, _InferenceWorker y H264AnnexBEncoder al nivel del
broadcaster para no tocar sockets reales ni GStreamer. El test de encoder real
se skipea cuando GStreamer no está disponible (sin extra `gstreamer`).
"""

from __future__ import annotations

import asyncio
import importlib
import json
import struct
import time

import numpy as np
import pytest

from back.services import wc_broadcaster as wc_mod
from back.services.wc_broadcaster import WCBroadcaster, _pack


@pytest.fixture
def fake_frame() -> np.ndarray:
    return np.full((4, 4, 3), 128, dtype=np.uint8)


class _FakeEncoder:
    """Cada push_frame yieldea exactamente un chunk; primer chunk keyframe,
    luego P-frames. Permite afirmar el flag is_keyframe en el header."""

    def __init__(self) -> None:
        self._counter = 0

    def push_frame(self, _bgr):
        is_keyframe = self._counter == 0
        self._counter += 1
        # Payload distinguible para detectar drops si los hubiera.
        yield is_keyframe, b"\x00\x00\x00\x01" + bytes([self._counter & 0xFF])

    def close(self) -> None:
        pass


@pytest.fixture
def patched_workers(monkeypatch, fake_frame):
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

    monkeypatch.setattr(wc_mod, "CameraClient", FakeCameraClient)
    monkeypatch.setattr(wc_mod, "_InferenceWorker", FakeInferenceWorker)
    monkeypatch.setattr(wc_mod, "H264AnnexBEncoder", _FakeEncoder)
    yield


def _decode_header(msg: bytes) -> dict:
    header_len = struct.unpack(">I", msg[:4])[0]
    return json.loads(msg[4 : 4 + header_len].decode("utf-8"))


def _decode_payload(msg: bytes) -> bytes:
    header_len = struct.unpack(">I", msg[:4])[0]
    return msg[4 + header_len :]


# ---------------------------------------------------------------------------
# _pack
# ---------------------------------------------------------------------------


def test_pack_header_length_prefix_and_payload():
    header = {
        "frame_id": 7,
        "timestamp_us": 233_333,
        "is_keyframe": True,
        "detections": [],
    }
    nal = b"\x00\x00\x00\x01\x67TEST\x00\x00\x00\x01\x65PAYLOAD"
    blob = _pack(header, nal)

    header_len = struct.unpack(">I", blob[:4])[0]
    assert header_len == len(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    assert json.loads(blob[4 : 4 + header_len].decode("utf-8")) == header
    assert blob[4 + header_len :] == nal


# ---------------------------------------------------------------------------
# WCBroadcaster lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_client_starts_thread_only_on_first(patched_workers):
    b = WCBroadcaster()
    assert b._thread is None

    cid1, _ = b.add_client()
    assert b._running is True
    assert b._thread is not None
    first_thread = b._thread

    cid2, _ = b.add_client()
    assert b._thread is first_thread, "second client must not spawn a new thread"
    assert cid1 != cid2

    b.remove_client(cid1)
    b.remove_client(cid2)
    await asyncio.sleep(0.2)
    assert b._running is False


@pytest.mark.asyncio
async def test_remove_last_client_stops_thread(patched_workers):
    b = WCBroadcaster()
    cid, _ = b.add_client()
    await asyncio.sleep(0.1)
    b.remove_client(cid)

    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        if b._thread is not None and not b._thread.is_alive():
            break
        await asyncio.sleep(0.05)

    assert b._running is False
    assert b._thread is not None and not b._thread.is_alive()


@pytest.mark.asyncio
async def test_two_clients_share_frame_id(patched_workers):
    b = WCBroadcaster()
    cid1, q1 = b.add_client()
    cid2, q2 = b.add_client()

    msg1 = await asyncio.wait_for(q1.get(), timeout=1.0)
    msg2 = await asyncio.wait_for(q2.get(), timeout=1.0)

    h1 = _decode_header(msg1)
    h2 = _decode_header(msg2)
    assert h1["frame_id"] == h2["frame_id"]
    # El primer chunk del fake encoder es keyframe.
    assert h1["is_keyframe"] is True
    assert h2["is_keyframe"] is True
    assert h1["timestamp_us"] == h1["frame_id"] * 1_000_000 // 30

    b.remove_client(cid1)
    b.remove_client(cid2)
    await asyncio.sleep(0.2)


@pytest.mark.asyncio
async def test_subsequent_frames_are_p_frames(patched_workers):
    """El primer chunk del encoder es keyframe; los siguientes deben venir con
    is_keyframe=False, así el cliente sabe cuándo configure() y cuándo dropear."""
    b = WCBroadcaster()
    cid, q = b.add_client()

    keyframe_seen = False
    delta_seen = False
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline and not (keyframe_seen and delta_seen):
        try:
            msg = await asyncio.wait_for(q.get(), timeout=0.5)
        except asyncio.TimeoutError:
            continue
        h = _decode_header(msg)
        if h["is_keyframe"]:
            keyframe_seen = True
        else:
            delta_seen = True

    assert keyframe_seen, "no keyframe observed"
    assert delta_seen, "no P-frame observed"

    b.remove_client(cid)
    await asyncio.sleep(0.2)


# ---------------------------------------------------------------------------
# Encoder real — skip si no hay GStreamer disponible.
# ---------------------------------------------------------------------------


def _gst_available() -> bool:
    try:
        importlib.import_module("gi")
        from back.services.nvenc_codec import HAS_GSTREAMER

        return bool(HAS_GSTREAMER)
    except Exception:
        return False


@pytest.mark.skipif(
    not _gst_available(),
    reason="GStreamer no disponible (sin extra `gstreamer`)",
)
def test_real_encoder_emits_keyframe_with_sps_pps_idr():
    """Primer chunk de un encoder fresco contiene SPS (NAL 7), PPS (NAL 8) e
    IDR (NAL 5) en Annex-B byte stream con start codes."""
    from back.services.h264_encoder import H264AnnexBEncoder

    enc = H264AnnexBEncoder()
    try:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        # x264enc en CI suele necesitar 2-3 pushes antes del primer access unit.
        first: tuple[bool, bytes] | None = None
        for _ in range(8):
            for is_keyframe, nal in enc.push_frame(frame):
                first = (is_keyframe, nal)
                break
            if first is not None:
                break
        assert first is not None, "encoder no emitió ningún access unit en 8 pushes"

        is_keyframe, nal = first
        assert is_keyframe is True

        # Buscar start codes y el NAL type del byte siguiente. NAL types
        # esperados: 7 (SPS), 8 (PPS), 5 (IDR). Mirar los primeros 200 bytes.
        types_seen: set[int] = set()
        i = 0
        head = nal[:200]
        while i < len(head) - 4:
            if head[i : i + 4] == b"\x00\x00\x00\x01":
                nal_type = head[i + 4] & 0x1F
                types_seen.add(nal_type)
                i += 4
            elif head[i : i + 3] == b"\x00\x00\x01":
                nal_type = head[i + 3] & 0x1F
                types_seen.add(nal_type)
                i += 3
            else:
                i += 1
        assert 7 in types_seen, f"SPS no encontrado, types={sorted(types_seen)}"
        assert 8 in types_seen, f"PPS no encontrado, types={sorted(types_seen)}"
        assert 5 in types_seen, f"IDR no encontrado, types={sorted(types_seen)}"
    finally:
        enc.close()


@pytest.mark.skipif(
    not _gst_available(),
    reason="GStreamer no disponible (sin extra `gstreamer`)",
)
def test_real_encoder_subsequent_frames_not_keyframe():
    """Después del primer keyframe los siguientes access units dentro del mismo
    GOP deben venir con is_keyframe=False."""
    from back.services.h264_encoder import H264AnnexBEncoder

    enc = H264AnnexBEncoder()
    try:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        chunks: list[tuple[bool, bytes]] = []
        for _ in range(15):
            for tup in enc.push_frame(frame):
                chunks.append(tup)
        assert len(chunks) >= 2, f"sólo {len(chunks)} access units emitidos"
        assert chunks[0][0] is True
        # Al menos un P-frame entre los siguientes.
        assert any(not k for k, _ in chunks[1:]), "no se observó P-frame"
    finally:
        enc.close()
