from __future__ import annotations

import logging

import numpy as np
from ultralytics import YOLO

logger = logging.getLogger("inference_worker.detector")


class Detector:
    def __init__(self, model_path: str):
        self._model = YOLO(model_path)
        self._model_path = model_path
        logger.info("Model loaded: %s", model_path)

    def reload_model(self, model_path: str) -> None:
        self._model = YOLO(model_path)
        self._model_path = model_path
        logger.info("Model reloaded: %s", model_path)

    @property
    def model_path(self) -> str:
        return self._model_path

    def get_class_names(self) -> list[str]:
        return list(self._model.names.values())

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

        results = self._model.track(roi, conf=conf, persist=True, verbose=False)
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
                "class_name": cls_name,
                "confidence": round(box_conf, 3),
                "bbox": [round(v, 1) for v in xyxy_full],
                "track_id": track_id,
            })

            if target_class is None or cls_name == target_class:
                count += 1

        return {
            "detections": detections,
            "tracking_data": tracking_data,
            "count": count,
            "roi": {"x": x_off, "y": 0, "w": sq, "h": h},
        }
