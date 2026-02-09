import logging

import numpy as np
from ultralytics import YOLO

from back.config import config

logger = logging.getLogger("detector")

model = YOLO(config.perception.model_name)
enabled = True


def get_class_names() -> list[str]:
    return list(model.names.values())


def detect(
    frame: np.ndarray, target_class: str | None = None
) -> tuple[np.ndarray, list[dict], int, list]:
    """Run YOLO tracking on *frame*.

    Returns (annotated_frame, detections, count, results_raw).
    *results_raw* is the raw YOLO result list for ObjectCounter.
    """
    conf = config.counting.confidence_threshold
    results = model.track(frame, conf=conf, persist=True, verbose=False)
    result = results[0]
    annotated = result.plot()

    detections: list[dict] = []
    count = 0

    for box in result.boxes:
        cls_id = int(box.cls[0])
        cls_name = model.names[cls_id]
        box_conf = float(box.conf[0])
        xyxy = box.xyxy[0].tolist()

        track_id = None
        if box.id is not None:
            track_id = int(box.id[0])

        det = {
            "class_name": cls_name,
            "confidence": round(box_conf, 3),
            "bbox": [round(v, 1) for v in xyxy],
            "track_id": track_id,
        }
        detections.append(det)

        if target_class is None or cls_name == target_class:
            count += 1

    return annotated, detections, count, results
