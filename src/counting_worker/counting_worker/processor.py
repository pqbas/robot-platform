"""Offline counting: decode an MP4 frame-by-frame, run detect + ByteTrack +
line-crossing, and emit (1) the authoritative count and (2) a frame-aligned
detection sidecar (`{uuid}.jsonl`).

Why offline eliminates the live desync: the bbox for frame N is computed from
the exact pixels of frame N, so overlaying it on frame N is aligned by
construction. The live pipeline (camera -> JPEG -> socket -> worker ->
data-channel) had variable latency that drifted the bbox to an older frame.

The ROI crop, bbox-to-full-frame mapping, and centroid normalization mirror
``inference_worker/detector.py`` exactly so the geometry matches the live
overlay the operator validated against.

Two methods, dispatched by ``payload["method"]``:

- ``single`` (default): one detector over the ROI, one ObjectCounter on the
  configured line. The historical behavior.
- ``tiled``: ported from ``mlops-blueberry-counting``. Crops the center square,
  takes the central strip (width = side/2) and splits it into two stacked square
  tiles. Each tile runs its own YOLO instance (independent tracker) and counts
  crossings of a vertical line at its center; the total is the sum. Each tile is
  rescaled up at inference, so blueberries look bigger and track_id churn drops —
  which is the dominant source of mis-counting. Tile detections are remapped back
  to full-frame pixels so the JSONL sidecar (and therefore the replay) stays
  aligned exactly like ``single``.
"""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("counting_worker.processor")

_HORIZONTAL_DIRECTIONS = ("left2right", "right2left")


def count_video(payload: dict) -> dict:
    """Reprocess ``video_path`` and return {total_count, frames}.

    Dispatches on ``payload["method"]`` ("single" | "tiled"); defaults to
    "single" so old configs/recordings keep working. Imports cv2/ultralytics
    lazily (inside the worker thread) so the control socket stays light and numpy
    is already monkey-patched (see main.py).
    """
    method = payload.get("method", "single")
    if method == "tiled":
        return _count_tiled(payload)
    return _count_single(payload)


def _count_single(payload: dict) -> dict:
    """Historical single-detector line-crossing over the ROI."""
    import cv2
    from ultralytics import YOLO

    from counting_worker.object_counter import ObjectCounter

    video_path = payload["video_path"]
    jsonl_path = payload["jsonl_path"]
    engine_path = payload["engine_path"]
    target_class = payload.get("target_class")
    count_mode = payload.get("count_mode", "horizontal")
    threshold = float(payload.get("threshold", 0.5))
    direction = payload.get("direction", "left2right")
    roi_mode = payload.get("roi_mode", "square")
    confidence = float(payload.get("confidence", 0.25))

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"video not found: {video_path}")
    if not os.path.exists(engine_path):
        raise FileNotFoundError(f"engine not found: {engine_path}")

    model = YOLO(engine_path, task="detect")
    counter = ObjectCounter(count_mode, threshold, direction)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    os.makedirs(os.path.dirname(jsonl_path), exist_ok=True)
    frame_idx = 0
    try:
        with open(jsonl_path, "w") as out:
            while True:
                # Presentation timestamp of the frame about to be read. Captured
                # BEFORE read() so it refers to *this* frame (verified: frame 0 →
                # 0.0). The MP4 is variable-frame-rate (the recording-worker
                # stamps each buffer with its real arrival PTS), so a frame's
                # position can't be reconstructed from index/fps — the replay
                # matches the player's mediaTime against this exact pts.
                pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                ok, frame = cap.read()
                if not ok:
                    break
                h, w = frame.shape[:2]
                if roi_mode == "square":
                    sq = min(h, w)
                    x_off = (w - sq) // 2
                    roi = frame[:, x_off : x_off + sq]
                else:
                    x_off = 0
                    roi = frame

                # ByteTrack (no GMC) — cheap and accurate at native fps with
                # contiguous frames. persist=True keeps track ids across the
                # whole video (one continuous tracker per job).
                results = model.track(
                    roi,
                    conf=confidence,
                    persist=True,
                    tracker="bytetrack.yaml",
                    verbose=False,
                )
                result = results[0]

                dets: list[dict] = []
                tracking_data: list[dict] = []
                for box in result.boxes:
                    cls_id = int(box.cls[0])
                    cls_name = model.names[cls_id]
                    box_conf = float(box.conf[0])
                    xyxy = box.xyxy[0].tolist()
                    # ROI-space bbox back to full-frame pixels (matches the live
                    # detector + replay overlay, which scales by naturalWidth).
                    xyxy_full = [xyxy[0] + x_off, xyxy[1], xyxy[2] + x_off, xyxy[3]]

                    track_id = None
                    if box.id is not None:
                        track_id = int(box.id[0])
                        xywh = box.xywh[0].tolist()
                        tracking_data.append(
                            {
                                "track_id": track_id,
                                "cx": (xywh[0] + x_off) / w,
                                "cy": xywh[1] / h,
                            }
                        )

                    dets.append(
                        {
                            "cls": cls_name,
                            "conf": round(box_conf, 3),
                            "bbox": [round(v, 1) for v in xyxy_full],
                            "track_id": track_id,
                        }
                    )

                # Only crossings of the target class advance the count; pass all
                # tracks if no target_class was given (mirrors live behavior).
                if target_class is not None:
                    crossing = [
                        td
                        for td, d in zip(tracking_data, _with_tracks(dets))
                        if d["cls"] == target_class
                    ]
                else:
                    crossing = tracking_data
                counter.update(crossing)

                # One dense line per frame (line N ↔ frame N). `pts` is the
                # frame's own presentation timestamp (seconds, 0-based) — the
                # join key the replay uses to find the frame the player shows,
                # which is exact even for variable-frame-rate video. `count` is
                # the running accumulated total up to this frame, so the replay
                # can show the live counter rising as objects cross the line.
                out.write(
                    json.dumps(
                        {
                            "frame": frame_idx,
                            "pts": round(pts, 4),
                            "count": counter.get_count(),
                            "dets": dets,
                        }
                    )
                    + "\n"
                )
                frame_idx += 1
    finally:
        cap.release()

    total = counter.get_count()
    logger.info(
        "Counted %s [single]: total=%d frames=%d (%s)",
        os.path.basename(video_path),
        total,
        frame_idx,
        target_class or "all",
    )
    return {"total_count": total, "frames": frame_idx}


def _count_tiled(payload: dict) -> dict:
    """Tiled line-crossing: central strip split into top/bottom square tiles,
    each with its own detector+tracker and a vertical line at its center.

    Ported from ``mlops-blueberry-counting/ops/strategies/tiled_crossing.py`` but
    adapted to: the robot's ObjectCounter (normalized coords, get_count()), the
    TensorRT engine path, and the frame-aligned JSONL sidecar (tile detections
    are remapped to full-frame pixels so the replay overlay lines up).

    The method's geometry is fixed: count_mode is horizontal (vertical line),
    threshold 0.5 (tile center), ROI is the center square. Only ``direction``
    (left/right), ``confidence`` and the model are configurable.
    """
    import cv2
    from ultralytics import YOLO

    from counting_worker.object_counter import ObjectCounter

    video_path = payload["video_path"]
    jsonl_path = payload["jsonl_path"]
    engine_path = payload["engine_path"]
    target_class = payload.get("target_class")
    confidence = float(payload.get("confidence", 0.25))
    # Coerce to the directions tiled supports (movement is horizontal so the line
    # is vertical). A vertical-mode config falls back to left2right.
    direction = payload.get("direction", "left2right")
    if direction not in _HORIZONTAL_DIRECTIONS:
        direction = "left2right"

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"video not found: {video_path}")
    if not os.path.exists(engine_path):
        raise FileNotFoundError(f"engine not found: {engine_path}")

    # Two instances → two independent ByteTrack states (one per tile). Loading the
    # engine twice doubles its GPU memory; acceptable for one small detector.
    model_top = YOLO(engine_path, task="detect")
    model_bottom = YOLO(engine_path, task="detect")
    counter_top = ObjectCounter("horizontal", 0.5, direction)
    counter_bottom = ObjectCounter("horizontal", 0.5, direction)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    os.makedirs(os.path.dirname(jsonl_path), exist_ok=True)
    frame_idx = 0
    try:
        with open(jsonl_path, "w") as out:
            while True:
                pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                ok, frame = cap.read()
                if not ok:
                    break
                h, w = frame.shape[:2]
                geom = _tile_geometry(h, w)
                tile_top, tile_bottom = _slice_tiles(frame, geom)

                result_top = model_top.track(
                    tile_top,
                    conf=confidence,
                    persist=True,
                    tracker="bytetrack.yaml",
                    verbose=False,
                )[0]
                result_bottom = model_bottom.track(
                    tile_bottom,
                    conf=confidence,
                    persist=True,
                    tracker="bytetrack.yaml",
                    verbose=False,
                )[0]

                dets: list[dict] = []
                # y_off 0 for the top tile, ``half`` for the bottom one; x_off is
                # the strip's left edge in full-frame pixels (shared by both).
                top_dets, top_tracks = _tile_detections(
                    result_top, model_top, geom, target_class, y_off=0
                )
                bottom_dets, bottom_tracks = _tile_detections(
                    result_bottom, model_bottom, geom, target_class, y_off=geom["half"]
                )
                counter_top.update(top_tracks)
                counter_bottom.update(bottom_tracks)
                dets.extend(top_dets)
                dets.extend(bottom_dets)

                count = counter_top.get_count() + counter_bottom.get_count()
                out.write(
                    json.dumps(
                        {
                            "frame": frame_idx,
                            "pts": round(pts, 4),
                            "count": count,
                            "dets": dets,
                        }
                    )
                    + "\n"
                )
                frame_idx += 1
    finally:
        cap.release()

    total = counter_top.get_count() + counter_bottom.get_count()
    logger.info(
        "Counted %s [tiled]: total=%d (top=%d bottom=%d) frames=%d (%s)",
        os.path.basename(video_path),
        total,
        counter_top.get_count(),
        counter_bottom.get_count(),
        frame_idx,
        target_class or "all",
    )
    return {"total_count": total, "frames": frame_idx}


def _tile_geometry(h: int, w: int) -> dict:
    """Geometry of the two stacked tiles for a HxW frame.

    Center square (side = min(h, w)); central strip of width = side/2 centered in
    it; split horizontally into two square tiles of side ``half``. All offsets are
    in full-frame pixels so tile detections can be remapped back.

    Returns dict with: side, half, x_off (full-frame x of the square's left
    edge), strip_x0 (full-frame x of the strip's left edge = tile left edge).
    """
    side = min(h, w)
    half = side // 2
    x_off = (w - side) // 2
    strip_x0 = x_off + (side - half) // 2
    return {"side": side, "half": half, "x_off": x_off, "strip_x0": strip_x0}


def _slice_tiles(frame, geom: dict):
    """Return (tile_top, tile_bottom): two square ``half``x``half`` crops of the
    central strip, top and bottom. The square keeps full height, so the tiles'
    y already are full-frame y (top at 0, bottom at ``half``)."""
    half = geom["half"]
    strip_x0 = geom["strip_x0"]
    strip = frame[:, strip_x0 : strip_x0 + half]
    return strip[:half, :], strip[half : half * 2, :]


def _tile_detections(result, model, geom: dict, target_class, y_off: int):
    """Build (dets, tracking_data) for one tile.

    ``dets`` carry bboxes in **full-frame pixels** (strip x-offset + tile x; tile
    y + ``y_off``) so the JSONL/replay overlay aligns. ``tracking_data`` carry
    centroids normalized to the tile (line at 0.5), filtered to ``target_class``
    so only that class advances the counter.
    """
    strip_x0 = geom["strip_x0"]
    half = geom["half"]
    dets: list[dict] = []
    tracking_data: list[dict] = []
    for box in result.boxes:
        cls_id = int(box.cls[0])
        cls_name = model.names[cls_id]
        box_conf = float(box.conf[0])
        xyxy = box.xyxy[0].tolist()
        xyxy_full = [
            xyxy[0] + strip_x0,
            xyxy[1] + y_off,
            xyxy[2] + strip_x0,
            xyxy[3] + y_off,
        ]

        track_id = None
        if box.id is not None:
            track_id = int(box.id[0])
            if target_class is None or cls_name == target_class:
                xywh = box.xywh[0].tolist()
                # Normalized to the tile: line is at cx == 0.5 of the tile.
                tracking_data.append(
                    {
                        "track_id": track_id,
                        "cx": xywh[0] / half,
                        "cy": xywh[1] / half,
                    }
                )

        dets.append(
            {
                "cls": cls_name,
                "conf": round(box_conf, 3),
                "bbox": [round(v, 1) for v in xyxy_full],
                "track_id": track_id,
            }
        )
    return dets, tracking_data


def _with_tracks(dets: list[dict]) -> list[dict]:
    """Detections that carry a track_id, in the same order as tracking_data
    was appended (both iterate result.boxes, skipping id-less boxes)."""
    return [d for d in dets if d.get("track_id") is not None]
