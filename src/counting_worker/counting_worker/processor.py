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
- ``tiled``: two squares of side H/2, vertically stacked (top y[0, H/2], bottom
  y[H/2, H]) and both centered on the frame's vertical axis (x = W/2). Each tile
  runs its own YOLO instance (independent tracker) and counts crossings of a
  vertical line at its center; the total is the sum. Each tile is rescaled up at
  inference, so blueberries look bigger and track_id churn drops — the dominant
  source of mis-counting. Tile detections are remapped back to full-frame pixels
  so the JSONL sidecar (and therefore the replay) stays aligned exactly like
  ``single``. NOTE: tiled's region is its own (these two squares); it does NOT
  use the single center square nor the ``roi_mode`` (Área de detección) setting.
"""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("counting_worker.processor")

_HORIZONTAL_DIRECTIONS = ("left2right", "right2left")

# Bottom-tile track_ids are offset by this so they never collide with top-tile
# ids — the two tiles run independent ByteTrack states, so id 5 can exist in
# both. The crop filename downstream is ``{track_id}_{frame}.jpg``, so a
# collision would overwrite one crop with the other's pixels.
_TILE_ID_OFFSET = 1_000_000


def _crossings_path(jsonl_path: str) -> str:
    """``{dir}/{uuid}.jsonl`` -> ``{dir}/{uuid}.crossings.jsonl``."""
    base, _ext = os.path.splitext(jsonl_path)
    return base + ".crossings.jsonl"


def _collect_crossings(crossed_ids, dets, frame_idx, pts, *, id_offset=0):
    """One crossing record per track that crossed in THIS frame.

    ``crossed_ids`` is the delta returned by ``ObjectCounter.update()`` for one
    tile/counter; ``dets`` are that same tile's detections (full-frame bboxes).
    We attribute the crossing to the object's bbox at the crossing frame so the
    classification worker can crop the exact pixels later. ``id_offset`` keeps
    bottom-tile ids disjoint from top-tile ids (see ``_TILE_ID_OFFSET``).
    """
    if not crossed_ids:
        return []
    det_by_tid = {d["track_id"]: d for d in dets if d.get("track_id") is not None}
    records = []
    for tid in crossed_ids:
        det = det_by_tid.get(tid)
        if det is None:
            continue
        records.append(
            {
                "track_id": tid + id_offset,
                "frame": frame_idx,
                "pts": round(pts, 4),
                "bbox": det["bbox"],
                "cls": det["cls"],
            }
        )
    return records


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

    crossings_path = _crossings_path(jsonl_path)
    os.makedirs(os.path.dirname(jsonl_path), exist_ok=True)
    frame_idx = 0
    crossings_total = 0
    try:
        with open(jsonl_path, "w") as out, open(crossings_path, "w") as cross_out:
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
                crossed = counter.update(crossing)
                for rec in _collect_crossings(crossed, dets, frame_idx, pts):
                    cross_out.write(json.dumps(rec) + "\n")
                    crossings_total += 1

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
        "Counted %s [single]: total=%d frames=%d crossings=%d (%s)",
        os.path.basename(video_path),
        total,
        frame_idx,
        crossings_total,
        target_class or "all",
    )
    return {"total_count": total, "frames": frame_idx, "crossings": crossings_total}


def _count_tiled(payload: dict) -> dict:
    """Tiled line-crossing: two H/2 squares stacked top/bottom, centered on the
    frame's vertical axis, each with its own detector+tracker and a vertical line
    at its center. See ``_tile_geometry`` for the exact geometry.

    Adapted from ``mlops-blueberry-counting/ops/strategies/tiled_crossing.py`` to:
    the robot's ObjectCounter (normalized coords, get_count()), the TensorRT
    engine path, and the frame-aligned JSONL sidecar (tile detections are
    remapped to full-frame pixels so the replay overlay lines up).

    The method's geometry is fixed: count_mode is horizontal (vertical line),
    threshold 0.5 (tile center). Only ``direction`` (left/right), ``confidence``
    and the model are configurable. ``roi_mode`` does not apply (tiled defines its
    own region).
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

    crossings_path = _crossings_path(jsonl_path)
    os.makedirs(os.path.dirname(jsonl_path), exist_ok=True)
    frame_idx = 0
    crossings_total = 0
    try:
        with open(jsonl_path, "w") as out, open(crossings_path, "w") as cross_out:
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
                # y_off 0 for the top tile, ``tile`` (=H/2) for the bottom one; x0
                # is each tile's left edge in full-frame pixels (shared by both,
                # since both are centered on x = W/2).
                top_dets, top_tracks = _tile_detections(
                    result_top, model_top, geom, target_class, y_off=0
                )
                bottom_dets, bottom_tracks = _tile_detections(
                    result_bottom, model_bottom, geom, target_class, y_off=geom["tile"]
                )
                crossed_top = counter_top.update(top_tracks)
                crossed_bottom = counter_bottom.update(bottom_tracks)
                # Attribute each crossing to its own tile's dets; bottom ids are
                # offset so the two tiles' track_ids stay disjoint downstream.
                records = _collect_crossings(crossed_top, top_dets, frame_idx, pts)
                records += _collect_crossings(
                    crossed_bottom, bottom_dets, frame_idx, pts, id_offset=_TILE_ID_OFFSET
                )
                for rec in records:
                    cross_out.write(json.dumps(rec) + "\n")
                    crossings_total += 1
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
        "Counted %s [tiled]: total=%d (top=%d bottom=%d) frames=%d crossings=%d (%s)",
        os.path.basename(video_path),
        total,
        counter_top.get_count(),
        counter_bottom.get_count(),
        frame_idx,
        crossings_total,
        target_class or "all",
    )
    return {"total_count": total, "frames": frame_idx, "crossings": crossings_total}


def _tile_geometry(h: int, w: int) -> dict:
    """Geometry of the two stacked tiles for an H x W (landscape) frame.

    Tiled is defined DIRECTLY on the original frame — NOT via a center-square
    crop: two squares of side ``H/2``, vertically stacked (top spans y[0, H/2],
    bottom spans y[H/2, H]), both horizontally centered on the frame's vertical
    axis (x = W/2). Their centers lie on that center line, and the crossing line
    is each tile's vertical center.

    Returns dict with: ``tile`` (side = H/2) and ``x0`` (full-frame x of each
    tile's left edge; shared, since both are centered on x = W/2). Offsets are
    full-frame pixels so tile detections remap back exactly.
    """
    tile = h // 2
    x0 = (w - tile) // 2
    return {"tile": tile, "x0": x0}


def _slice_tiles(frame, geom: dict):
    """Return (tile_top, tile_bottom): two ``tile``x``tile`` squares, top and
    bottom, both centered on the frame's vertical axis. y is already full-frame
    (top at 0, bottom at ``tile``)."""
    tile = geom["tile"]
    x0 = geom["x0"]
    band = frame[:, x0 : x0 + tile]
    return band[:tile, :], band[tile : tile * 2, :]


def _tile_detections(result, model, geom: dict, target_class, y_off: int):
    """Build (dets, tracking_data) for one tile.

    ``dets`` carry bboxes in **full-frame pixels** (tile x-offset ``x0`` + tile x;
    tile y + ``y_off``) so the JSONL/replay overlay aligns. ``tracking_data``
    carry centroids normalized to the tile (line at 0.5), filtered to
    ``target_class`` so only that class advances the counter.
    """
    x0 = geom["x0"]
    tile = geom["tile"]
    dets: list[dict] = []
    tracking_data: list[dict] = []
    for box in result.boxes:
        cls_id = int(box.cls[0])
        cls_name = model.names[cls_id]
        box_conf = float(box.conf[0])
        xyxy = box.xyxy[0].tolist()
        xyxy_full = [
            xyxy[0] + x0,
            xyxy[1] + y_off,
            xyxy[2] + x0,
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
                        "cx": xywh[0] / tile,
                        "cy": xywh[1] / tile,
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
