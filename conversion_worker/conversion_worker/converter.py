"""Convert a YOLO .pt to a TensorRT .engine using ultralytics' exporter.

Runs synchronously inside a worker thread (see main.py). Does not handle
exceptions itself — the caller turns failures into ``last_result.error``.
"""

from __future__ import annotations

import logging
import os
import shutil
import time

logger = logging.getLogger("conversion_worker.converter")


def convert(pt_path: str, engine_path: str, precision: str = "fp16", imgsz: int = 640) -> None:
    """Build a TensorRT engine from ``pt_path`` and place it at ``engine_path``.

    ultralytics' ``model.export(format="engine", ...)`` writes the engine
    next to the .pt with a fixed name (``<stem>.engine``). We rename that
    file to ``engine_path`` afterwards, and clean up the intermediate .onnx
    that ultralytics drops in the same dir (we only cache the .engine).
    """
    if precision not in ("fp16", "fp32"):
        raise ValueError(f"unsupported precision: {precision}")

    # Imported lazily so the module can be imported on dev hosts without
    # ultralytics/torch (the venv is created at deploy time).
    from ultralytics import YOLO

    pt_path = os.path.abspath(pt_path)
    engine_path = os.path.abspath(engine_path)
    pt_dir = os.path.dirname(pt_path)
    pt_stem = os.path.splitext(os.path.basename(pt_path))[0]

    started = time.monotonic()
    logger.info(
        "Starting conversion %s -> %s (precision=%s imgsz=%d)",
        pt_path, engine_path, precision, imgsz,
    )

    model = YOLO(pt_path)
    model.export(format="engine", half=(precision == "fp16"), imgsz=imgsz)

    default_engine = os.path.join(pt_dir, f"{pt_stem}.engine")
    if not os.path.exists(default_engine):
        raise RuntimeError(
            f"ultralytics did not produce expected engine at {default_engine}"
        )

    os.makedirs(os.path.dirname(engine_path) or ".", exist_ok=True)
    shutil.move(default_engine, engine_path)

    onnx_intermediate = os.path.join(pt_dir, f"{pt_stem}.onnx")
    if os.path.exists(onnx_intermediate):
        try:
            os.remove(onnx_intermediate)
        except OSError:
            logger.warning("could not remove intermediate %s", onnx_intermediate)

    duration = time.monotonic() - started
    logger.info("Conversion done in %.1fs -> %s", duration, engine_path)
