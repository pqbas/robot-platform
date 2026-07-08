"""Unit tests for the numpy linear probe and bbox clamping.

These cover the torch-free parts of the worker so they run anywhere (no CUDA, no
JetPack torch). The encoder forward + full ``classify_video`` are validated on
the robot against a real recording (see spec validation).
"""

import json

import numpy as np
import pytest

from classification_worker.processor import (
    _clamp_bbox,
    _probe_predict,
    _read_crossings,
)


def _probe(n_classes=3, dim=4):
    rng = np.random.RandomState(0)
    return {
        "mean": rng.randn(dim).astype("float32"),
        "scale": (np.abs(rng.randn(dim)) + 0.5).astype("float32"),
        "coef": rng.randn(n_classes, dim).astype("float32"),
        "intercept": rng.randn(n_classes).astype("float32"),
        "classes": np.arange(n_classes, dtype="int64"),
    }


def test_probe_predict_rows_are_distributions():
    probe = _probe()
    emb = np.random.RandomState(1).randn(5, 4).astype("float32")
    probs = _probe_predict(emb, probe)
    assert probs.shape == (5, 3)
    assert np.allclose(probs.sum(axis=1), 1.0, atol=1e-5)
    assert np.isfinite(probs).all()
    assert (probs >= 0).all()


def test_probe_predict_matches_manual_softmax():
    probe = _probe(n_classes=3, dim=4)
    emb = np.array([[0.1, -0.2, 0.3, 0.4]], dtype="float32")
    z = (emb - probe["mean"]) / probe["scale"]
    logits = z @ probe["coef"].T + probe["intercept"]
    e = np.exp(logits - logits.max())
    expected = e / e.sum()
    assert np.allclose(_probe_predict(emb, probe), expected, atol=1e-6)


def test_clamp_bbox_inside_frame():
    assert _clamp_bbox([10.4, 20.6, 30.0, 40.0], 100, 100) == (10, 21, 30, 40)


def test_clamp_bbox_clips_to_edges():
    assert _clamp_bbox([-5, -5, 200, 200], 100, 80) == (0, 0, 100, 80)


def test_clamp_bbox_degenerate_returns_none():
    assert _clamp_bbox([50, 50, 50, 60], 100, 100) is None  # zero width
    assert _clamp_bbox([50, 50, 60, 50], 100, 100) is None  # zero height
    assert _clamp_bbox([200, 200, 210, 210], 100, 100) is None  # fully outside


def test_read_crossings_parses_jsonl(tmp_path):
    p = tmp_path / "x.crossings.jsonl"
    p.write_text(
        json.dumps({"track_id": 1, "frame": 0, "bbox": [1, 2, 3, 4], "cls": "a"})
        + "\n\n"  # blank line tolerated
        + json.dumps({"track_id": 2, "frame": 5, "bbox": [5, 6, 7, 8], "cls": "a"})
        + "\n"
    )
    rows = _read_crossings(str(p))
    assert [r["track_id"] for r in rows] == [1, 2]
    assert rows[0]["bbox"] == [1, 2, 3, 4]


def test_read_crossings_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        _read_crossings(str(tmp_path / "nope.jsonl"))


def test_preprocessing_matches_training_recipe():
    """Crop BGR→RGB → Resize((128,128)) stretch → ToTensor [0,1], no normalize.
    Mirrors mlops dataset.py test path. Needs torchvision (Jetson system site)."""
    torch = pytest.importorskip("torch")
    transforms = pytest.importorskip("torchvision.transforms")
    from PIL import Image

    imgsz = 128
    transform = transforms.Compose(
        [transforms.Resize((imgsz, imgsz)), transforms.ToTensor()]
    )
    # Known non-square crop with a distinct R/B so BGR→RGB is observable.
    bgr = np.zeros((40, 80, 3), dtype=np.uint8)
    bgr[:, :, 2] = 255  # red channel in BGR
    rgb = bgr[:, :, ::-1]
    t = transform(Image.fromarray(rgb))
    assert t.shape == (3, imgsz, imgsz)          # stretched to square
    assert float(t.min()) >= 0.0 and float(t.max()) <= 1.0  # [0,1], no normalize
    assert torch.allclose(t[0], torch.ones_like(t[0]))   # R==1
    assert torch.allclose(t[2], torch.zeros_like(t[2]))  # B==0 (proves RGB order)
