"""Unit tests for the numpy linear probe and bbox clamping.

These cover the torch-free parts of the worker so they run anywhere (no CUDA, no
JetPack torch). The encoder forward + full ``classify_video`` are validated on
the robot against a real recording (see spec validation).
"""

import numpy as np

from classification_worker.processor import _clamp_bbox, _probe_predict


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
