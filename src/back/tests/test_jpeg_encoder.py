"""JPEG encoder para la inferencia en vivo (perception/jpeg_encoder.py).

Cubre el helper CPU (contrato de color YUYV/BGR), el factory (HW vs CPU) y un
smoke HW opcional que solo corre en Jetson con nvjpegenc.

Run: PYTHONPATH=src/back uv run pytest tests/test_jpeg_encoder.py
"""

import cv2
import numpy as np
import pytest

import back.services.perception.jpeg_encoder as je
from back.services.perception.jpeg_encoder import (
    CpuJpegEncoder,
    _cpu_encode,
    make_jpeg_encoder,
)


def _make_yuyv(h: int = 64, w: int = 64) -> np.ndarray:
    """Frame YUYV (H, W, 2) determinista con estructura (bandas + gradiente)."""
    rng = np.arange(w, dtype=np.int32)
    y = np.tile((rng % 256).astype(np.uint8), (h, 1))
    chroma = np.tile(((rng * 3) % 256).astype(np.uint8), (h, 1))
    return np.dstack([y, chroma]).astype(np.uint8)


def test_cpu_encode_yuyv_roundtrips_to_bgr_correct_colors():
    # Un frame YUYV (H,W,2) → JPEG → imdecode debe reconstruir (H,W,3) BGR y
    # coincidir (dentro de la tolerancia JPEG) con el cvtColor de referencia.
    yuyv = _make_yuyv()
    reference_bgr = cv2.cvtColor(yuyv, cv2.COLOR_YUV2BGR_YUYV)

    jpeg = _cpu_encode(yuyv)
    assert isinstance(jpeg, bytes) and len(jpeg) > 0

    decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (64, 64, 3)
    # JPEG q85 introduce ruido de cuantización, pero el color debe ser el mismo.
    assert np.mean(np.abs(decoded.astype(int) - reference_bgr.astype(int))) < 10


def test_cpu_encode_bgr_does_not_reconvert():
    # Frame ya-BGR (H,W,3) → imencode directo (sin cvtColor), JPEG válido.
    bgr = np.zeros((64, 64, 3), np.uint8)
    bgr[:, :, 2] = 200  # rojo en BGR
    jpeg = _cpu_encode(bgr)
    decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (64, 64, 3)
    # El canal rojo (índice 2 en BGR) domina — no se re-interpretó como YUYV.
    assert decoded[:, :, 2].mean() > decoded[:, :, 0].mean()
    assert decoded[:, :, 2].mean() > decoded[:, :, 1].mean()


def test_factory_picks_hw_when_nvjpegenc_present(monkeypatch):
    monkeypatch.setattr(je, "_has_nvjpegenc", lambda: True)
    sentinel = object()
    monkeypatch.setattr(je, "HwJpegEncoder", lambda: sentinel)
    assert make_jpeg_encoder() is sentinel


def test_factory_falls_back_to_cpu_when_absent(monkeypatch):
    monkeypatch.setattr(je, "_has_nvjpegenc", lambda: False)
    assert isinstance(make_jpeg_encoder(), CpuJpegEncoder)


def test_cpu_encoder_encode_matches_helper():
    yuyv = _make_yuyv()
    enc = CpuJpegEncoder()
    assert enc.encode(yuyv) == _cpu_encode(yuyv)
    enc.close()  # no-op, no debe fallar


@pytest.mark.skipif(not je._has_nvjpegenc(), reason="requiere nvjpegenc (Jetson)")
def test_hw_encode_smoke_matches_cpu():
    # Smoke HW: appsrc(YUY2)!nvvidconv!I420!nvjpegenc produce un JPEG decodable a
    # BGR cercano al del path CPU (reproduce el prototipo de la fase).
    yuyv = _make_yuyv()
    enc = je.HwJpegEncoder()
    try:
        hw_jpeg = enc.encode(yuyv)
    finally:
        enc.close()
    assert hw_jpeg is not None
    hw_bgr = cv2.imdecode(np.frombuffer(hw_jpeg, np.uint8), cv2.IMREAD_COLOR)
    cpu_bgr = cv2.imdecode(np.frombuffer(_cpu_encode(yuyv), np.uint8), cv2.IMREAD_COLOR)
    assert hw_bgr.shape == cpu_bgr.shape == (64, 64, 3)
    # I420 (4:2:0) vs BGR full-chroma difieren en croma subsampleado; el color
    # global debe seguir siendo el mismo.
    assert np.mean(np.abs(hw_bgr.astype(int) - cpu_bgr.astype(int))) < 25
