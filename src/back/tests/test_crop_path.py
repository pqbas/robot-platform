"""Crop-serving path resolution — the path-traversal guard on the crops route.

``GET /api/recordings/{uuid}/crops/{filename}`` serves a per-object ripeness JPG.
The filename comes from client input, so the resolver must never let a request
escape the recording's crops dir. These cases pin that guard plus the exists/404
behavior. (The route itself is a thin wrapper: rec lookup → this resolver →
FileResponse; the security-critical logic all lives here.)

Run: PYTHONPATH=src/back python -m pytest src/back/tests/test_crop_path.py
"""

import pytest
from fastapi import HTTPException

from back.routes.recordings import _resolve_crop_path


def test_serves_existing_crop(tmp_path):
    crops = tmp_path / "crops"
    crops.mkdir()
    (crops / "7_214.jpg").write_bytes(b"jpegbytes")
    assert _resolve_crop_path(str(crops), "7_214.jpg") == str(crops / "7_214.jpg")


def test_missing_crop_is_404(tmp_path):
    with pytest.raises(HTTPException) as ei:
        _resolve_crop_path(str(tmp_path), "nope.jpg")
    assert ei.value.status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        "../secret.txt",
        "..",
        "sub/dir.jpg",
        "a\\b.jpg",
        "../../etc/passwd",
    ],
)
def test_path_traversal_is_rejected(tmp_path, bad):
    # Even if the traversal target happens to exist, the separator/.. guard trips
    # first (400) — the resolver never reaches the filesystem for these.
    with pytest.raises(HTTPException) as ei:
        _resolve_crop_path(str(tmp_path), bad)
    assert ei.value.status_code == 400
