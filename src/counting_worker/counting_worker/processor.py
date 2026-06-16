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
"""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("counting_worker.processor")


def count_video(payload: dict) -> dict:
    """Reprocess ``video_path`` and return {total_count, frames}.

    Imports cv2/ultralytics lazily (inside the worker thread) so the control
    socket stays light and numpy is already monkey-patched (see main.py).
    """
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
    started_epoch = float(payload.get("started_epoch") or 0.0)
    fps = float(payload.get("fps") or 0.0)

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"video not found: {video_path}")
    if not os.path.exists(engine_path):
        raise FileNotFoundError(f"engine not found: {engine_path}")

    model = YOLO(engine_path, task="detect")
    counter = ObjectCounter(count_mode, threshold, direction)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    # Prefer the recording-worker's authoritative fps; fall back to the
    # container's metadata so `t` stays sane when fps wasn't passed.
    if fps <= 0:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    dt = 1.0 / fps if fps > 0 else 0.0

    os.makedirs(os.path.dirname(jsonl_path), exist_ok=True)
    frame_idx = 0
    try:
        with open(jsonl_path, "w") as out:
            while True:
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

                t = started_epoch + frame_idx * dt
                out.write(
                    json.dumps({"frame": frame_idx, "t": t, "dets": dets}) + "\n"
                )
                frame_idx += 1
    finally:
        cap.release()

    total = counter.get_count()
    logger.info(
        "Counted %s: total=%d frames=%d (%s)",
        os.path.basename(video_path),
        total,
        frame_idx,
        target_class or "all",
    )
    return {"total_count": total, "frames": frame_idx}


def _with_tracks(dets: list[dict]) -> list[dict]:
    """Detections that carry a track_id, in the same order as tracking_data
    was appended (both iterate result.boxes, skipping id-less boxes)."""
    return [d for d in dets if d.get("track_id") is not None]
