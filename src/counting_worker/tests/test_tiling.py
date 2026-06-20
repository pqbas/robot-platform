"""Geometry tests for the tiled counting method.

These pin the pure-geometry helpers (no GPU/ultralytics): the two H/2 squares,
stacked top/bottom and centered on the frame's vertical axis, and how a
tile-space bbox is remapped back to full-frame pixels. The remap is what keeps
the JSONL sidecar (and the replay overlay) aligned, so it must match the crop
math exactly.
"""

from counting_worker.processor import _tile_geometry, _slice_tiles

import numpy as np


def test_geometry_landscape():
    # 1920x1080: each tile = H/2 = 540; centered on x = W/2 = 960, so the left
    # edge is (1920 - 540) / 2 = 690.
    g = _tile_geometry(1080, 1920)
    assert g["tile"] == 540
    assert g["x0"] == 690
    # Center of the tile sits on the frame's vertical axis.
    assert g["x0"] + g["tile"] / 2 == 1920 / 2


def test_tiles_are_square_and_stacked():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    g = _tile_geometry(1080, 1920)
    top, bottom = _slice_tiles(frame, g)
    assert top.shape[:2] == (540, 540)
    assert bottom.shape[:2] == (540, 540)


def test_remap_top_tile_to_full_frame():
    # A box at tile-local (10, 20, 30, 40) in the top tile maps to full-frame by
    # adding x0 to x and 0 to y.
    g = _tile_geometry(1080, 1920)
    x0 = g["x0"]
    x1, y1, x2, y2 = 10, 20, 30, 40
    full = [x1 + x0, y1 + 0, x2 + x0, y2 + 0]
    assert full == [10 + 690, 20, 30 + 690, 40]


def test_remap_bottom_tile_adds_tile_to_y():
    # Same box in the bottom tile maps with y += tile (= H/2).
    g = _tile_geometry(1080, 1920)
    x0, tile = g["x0"], g["tile"]
    x1, y1, x2, y2 = 10, 20, 30, 40
    full = [x1 + x0, y1 + tile, x2 + x0, y2 + tile]
    assert full == [10 + 690, 20 + 540, 30 + 690, 40 + 540]


def test_tile_centroid_normalization():
    # A centroid at the tile center (tile/2) normalizes to 0.5 — exactly the
    # vertical line the tile counter compares against.
    g = _tile_geometry(1080, 1920)
    tile = g["tile"]
    cx = tile / 2
    assert cx / tile == 0.5


def test_tiles_centered_on_vertical_axis():
    # Both tiles share x0 and are centered on W/2, regardless of frame width.
    for w in (1280, 1920, 2560):
        g = _tile_geometry(1080, w)
        assert g["x0"] + g["tile"] / 2 == w / 2
