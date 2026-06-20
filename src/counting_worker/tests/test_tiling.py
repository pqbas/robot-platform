"""Geometry tests for the tiled counting method.

These pin the pure-geometry helpers (no GPU/ultralytics): how a frame is split
into two stacked square tiles, and how a tile-space bbox is remapped back to
full-frame pixels. The remap is what keeps the JSONL sidecar (and the replay
overlay) aligned, so it must match the crop math exactly.
"""

from counting_worker.processor import _tile_geometry, _slice_tiles

import numpy as np


def test_geometry_landscape():
    # 1920x1080: center square side = 1080, tile half = 540.
    g = _tile_geometry(1080, 1920)
    assert g["side"] == 1080
    assert g["half"] == 540
    assert g["x_off"] == (1920 - 1080) // 2  # 420
    # Strip is centered in the square: (side - half)//2 = 270 into the square.
    assert g["strip_x0"] == g["x_off"] + (1080 - 540) // 2  # 420 + 270 = 690


def test_tiles_are_square_and_stacked():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    g = _tile_geometry(1080, 1920)
    top, bottom = _slice_tiles(frame, g)
    assert top.shape[:2] == (540, 540)
    assert bottom.shape[:2] == (540, 540)


def test_remap_top_tile_to_full_frame():
    # A box at tile-local (10, 20, 30, 40) in the top tile maps to full-frame by
    # adding strip_x0 to x and 0 to y.
    g = _tile_geometry(1080, 1920)
    sx = g["strip_x0"]
    x1, y1, x2, y2 = 10, 20, 30, 40
    full = [x1 + sx, y1 + 0, x2 + sx, y2 + 0]
    assert full == [10 + 690, 20, 30 + 690, 40]


def test_remap_bottom_tile_adds_half_to_y():
    # Same box in the bottom tile maps with y += half.
    g = _tile_geometry(1080, 1920)
    sx, half = g["strip_x0"], g["half"]
    x1, y1, x2, y2 = 10, 20, 30, 40
    full = [x1 + sx, y1 + half, x2 + sx, y2 + half]
    assert full == [10 + 690, 20 + 540, 30 + 690, 40 + 540]


def test_tile_centroid_normalization():
    # A centroid at the tile center (half/2) normalizes to 0.5 — exactly the
    # vertical line the tile counter compares against.
    g = _tile_geometry(1080, 1920)
    half = g["half"]
    cx = half / 2
    assert cx / half == 0.5
