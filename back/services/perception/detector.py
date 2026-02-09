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
) -> tuple[np.ndarray, list[dict], int]:
    """Run YOLO on *frame* and return (annotated_frame, detections, count).

    If *target_class* is given, *count* only reflects objects of that class.
    *detections* always contains every detected object.
    """
    results = model(frame, verbose=False)
    result = results[0]
    annotated = result.plot()

    detections: list[dict] = []
    count = 0

    for box in result.boxes:
        cls_id = int(box.cls[0])
        cls_name = model.names[cls_id]
        conf = float(box.conf[0])
        xyxy = box.xyxy[0].tolist()

        det = {
            "class_name": cls_name,
            "confidence": round(conf, 3),
            "bbox": [round(v, 1) for v in xyxy],
            "track_id": None,
        }
        detections.append(det)

        if target_class is None or cls_name == target_class:
            count += 1

    return annotated, detections, count
