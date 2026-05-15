from __future__ import annotations

import collections
import logging
import time

import numpy as np
from ultralytics import YOLO

logger = logging.getLogger("inference_worker.detector")

# Rolling per-frame inference times. Keep ~20s worth at 30 fps.
_TIMING_WINDOW = 600
# Log a summary every N frames so logs aren't spammed.
_TIMING_LOG_EVERY = 150


class Detector:
    def __init__(self, model_path: str):
        self._model = YOLO(model_path, task="detect")
        self._model_path = model_path
        # {model_label: system_label} — empty means pass all, no rename
        self._class_filter: dict[str, str] = {}
        self._times_ms: collections.deque[float] = collections.deque(
            maxlen=_TIMING_WINDOW
        )
        self._pre_ms: collections.deque[float] = collections.deque(maxlen=_TIMING_WINDOW)
        self._inf_ms: collections.deque[float] = collections.deque(maxlen=_TIMING_WINDOW)
        self._post_ms: collections.deque[float] = collections.deque(maxlen=_TIMING_WINDOW)
        self._frame_count = 0
        logger.info("Model loaded: %s", model_path)

    def set_class_filter(self, class_mapping: list) -> None:
        """Recibe class_mapping del backend y construye el dict de filtro/renombre."""
        result: dict[str, str] = {}
        for entry in class_mapping:
            if isinstance(entry, str):
                result[entry] = entry
            elif isinstance(entry, dict):
                ml = entry.get("model_label", "")
                sl = entry.get("system_label") or ml
                if ml:
                    result[ml] = sl
        self._class_filter = result
        logger.info("Class filter updated: %s", self._class_filter)

    def reload_model(self, model_path: str) -> None:
        self._model = YOLO(model_path, task="detect")
        self._model_path = model_path
        self._class_filter = {}
        self._times_ms.clear()
        self._pre_ms.clear()
        self._inf_ms.clear()
        self._post_ms.clear()
        self._frame_count = 0
        logger.info("Model reloaded: %s", model_path)

    @property
    def model_path(self) -> str:
        return self._model_path

    def get_class_names(self) -> list[str]:
        return list(self._model.names.values())

    def _log_timing_summary(self) -> None:
        if not self._times_ms:
            return
        sorted_times = sorted(self._times_ms)
        n = len(sorted_times)
        p50 = sorted_times[n // 2]
        p90 = sorted_times[min(int(n * 0.90), n - 1)]
        p99 = sorted_times[min(int(n * 0.99), n - 1)]
        mean = sum(sorted_times) / n
        fps = 1000.0 / mean if mean > 0 else 0.0
        backend = "engine" if self._model_path.endswith(".engine") else "pt"
        pre_mean = sum(self._pre_ms) / len(self._pre_ms) if self._pre_ms else 0.0
        inf_mean = sum(self._inf_ms) / len(self._inf_ms) if self._inf_ms else 0.0
        post_mean = sum(self._post_ms) / len(self._post_ms) if self._post_ms else 0.0
        logger.info(
            "perf [%s] frames=%d  p50=%.1fms p90=%.1fms p99=%.1fms mean=%.1fms  ~%.1f fps  "
            "stages mean: pre=%.1f infer=%.1f post=%.1f",
            backend, n, p50, p90, p99, mean, fps, pre_mean, inf_mean, post_mean,
        )

    def timing_stats(self) -> dict:
        """Snapshot of the rolling timing window. Empty when no frames yet."""
        if not self._times_ms:
            return {"frames": 0}
        sorted_times = sorted(self._times_ms)
        n = len(sorted_times)
        mean = sum(sorted_times) / n
        return {
            "frames": n,
            "p50_ms": round(sorted_times[n // 2], 2),
            "p90_ms": round(sorted_times[min(int(n * 0.90), n - 1)], 2),
            "p99_ms": round(sorted_times[min(int(n * 0.99), n - 1)], 2),
            "mean_ms": round(mean, 2),
            "fps": round(1000.0 / mean, 1) if mean > 0 else 0.0,
            "backend": "engine" if self._model_path.endswith(".engine") else "pt",
            "stage_mean_ms": {
                "preprocess": round(sum(self._pre_ms) / len(self._pre_ms), 2) if self._pre_ms else 0.0,
                "inference": round(sum(self._inf_ms) / len(self._inf_ms), 2) if self._inf_ms else 0.0,
                "postprocess": round(sum(self._post_ms) / len(self._post_ms), 2) if self._post_ms else 0.0,
            },
        }

    def detect(
        self,
        frame: np.ndarray,
        target_class: str | None = None,
        conf: float = 0.5,
        roi_mode: str = "square",
    ) -> dict:
        """Run YOLO tracking, optionally on a centered square ROI.

        - ``roi_mode="square"`` crops a centered square of side = min(h, w).
          Avoids the letterbox padding ultralytics adds for wide inputs and
          gives the model native pixel density on the active region.
        - ``roi_mode="full"`` uses the whole frame (ultralytics will
          letterbox it internally to its imgsz).

        Bboxes and centroids are mapped back to original-frame space
        regardless of mode, so the overlay and counter behave the same.
        """
        h, w = frame.shape[:2]
        if roi_mode == "square":
            sq = min(h, w)
            x_off = (w - sq) // 2
            roi = frame[:, x_off : x_off + sq]
        else:
            x_off = 0
            sq = w
            roi = frame

        t0 = time.perf_counter()
        results = self._model.track(roi, conf=conf, persist=True, verbose=False)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        self._times_ms.append(elapsed_ms)
        # Capture ultralytics' own per-stage breakdown (preprocess/
        # inference/postprocess in ms). Helps identify which stage
        # dominates when total time looks slow.
        speed = getattr(results[0], "speed", None) or {}
        self._pre_ms.append(float(speed.get("preprocess", 0.0)))
        self._inf_ms.append(float(speed.get("inference", 0.0)))
        self._post_ms.append(float(speed.get("postprocess", 0.0)))
        self._frame_count += 1
        if self._frame_count % _TIMING_LOG_EVERY == 0:
            self._log_timing_summary()
        result = results[0]

        detections: list[dict] = []
        tracking_data: list[dict] = []
        count = 0

        for box in result.boxes:
            cls_id = int(box.cls[0])
            cls_name = self._model.names[cls_id]
            box_conf = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            # Translate ROI-space bbox back to full-frame pixels.
            xyxy_full = [xyxy[0] + x_off, xyxy[1], xyxy[2] + x_off, xyxy[3]]

            # Apply class filter: if mapping defined, skip classes not in it.
            if self._class_filter:
                if cls_name not in self._class_filter:
                    continue
                display_name = self._class_filter[cls_name]
            else:
                display_name = cls_name

            track_id = None
            if box.id is not None:
                track_id = int(box.id[0])
                xywh = box.xywh[0].tolist()
                tracking_data.append({
                    "track_id": track_id,
                    "cx": (xywh[0] + x_off) / w,
                    "cy": xywh[1] / h,
                })

            detections.append({
                "class_name": display_name,
                "confidence": round(box_conf, 3),
                "bbox": [round(v, 1) for v in xyxy_full],
                "track_id": track_id,
            })

            if target_class is None or display_name == target_class:
                count += 1

        return {
            "detections": detections,
            "tracking_data": tracking_data,
            "count": count,
            "roi": {"x": x_off, "y": 0, "w": sq, "h": h},
        }
