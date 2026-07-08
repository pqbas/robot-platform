"""Offline ripeness classification: read the crossing events emitted by the
counting worker (`{uuid}.crossings.jsonl`), crop each crossed object from the
recorded MP4, and run the frozen Encoder + numpy linear probe to predict its
ripeness class.

Pipeline per crossing (matches training exactly, see ``mlops-classification-
blueberry/src/dataset.py``, test path): crop bbox → BGR→RGB → PIL →
``Resize((imgsz, imgsz))`` (bilinear stretch) → ``ToTensor`` ([0,1], CHW) →
``Encoder.embed`` → standardize → ``W·z + b`` → softmax → argmax.

Two reasons this is offline (mirrors the counting worker):
- The crossing bbox in `{uuid}.crossings.jsonl` was computed against the
  counting pass's *sequential* frame index. The MP4 is variable-frame-rate, so
  ``CAP_PROP_POS_FRAMES`` would seek to a different frame than the counter saw —
  we decode sequentially and match ``frame_idx`` to crop the exact pixels.
- The encoder runs on **CUDA**. JetPack's torch 1.12 CPU conv produces non-finite
  output for this backbone; GPU is correct. Off-Jetson (no CUDA) it falls back to
  CPU, which is fine on a normal torch build (used for tests/dev).

The model is a single self-contained ``classifier.npz``: ``enc__<param>`` arrays
(encoder state_dict as numpy) + the probe (``mean``/``scale``/``coef``/
``intercept``/``classes``) + ``class_names``/``latent_dim``/``imgsz``.
"""

from __future__ import annotations

import json
import logging
import os
from collections import Counter, defaultdict

logger = logging.getLogger("classification_worker.processor")


def _load_model(model_path: str):
    """Load the bundled npz → (encoder, device, probe-dict, meta).

    Imports torch lazily (inside the worker thread) so the control socket stays
    light, mirroring the counting worker.
    """
    import numpy as np
    import torch

    from classification_worker.model.backbone import Encoder

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"model not found: {model_path}")

    d = np.load(model_path, allow_pickle=True)
    latent_dim = int(d["latent_dim"])
    imgsz = int(d["imgsz"])
    class_names = [str(c) for c in d["class_names"]]

    state = {
        k[len("enc__") :]: torch.from_numpy(d[k])
        for k in d.files
        if k.startswith("enc__")
    }
    if not state:
        # A probe-only npz (no folded encoder weights) is the old export format;
        # the worker needs the self-contained bundle. Fail loudly, don't guess.
        raise ValueError(
            f"{os.path.basename(model_path)} has no enc__ encoder weights — "
            "re-export with the bundled predict.py (encoder folded into the npz)"
        )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    encoder = Encoder(latent_dim)
    encoder.load_state_dict(state)  # strict: weights must match the architecture
    encoder.eval()
    encoder.to(device)

    probe = {
        "mean": d["mean"].astype("float32"),
        "scale": d["scale"].astype("float32"),
        "coef": d["coef"].astype("float32"),
        "intercept": d["intercept"].astype("float32"),
        "classes": d["classes"].astype("int64"),
    }
    meta = {"latent_dim": latent_dim, "imgsz": imgsz, "class_names": class_names}
    logger.info(
        "Loaded classifier %s on %s (latent_dim=%d imgsz=%d, %d classes)",
        os.path.basename(model_path),
        device.type,
        latent_dim,
        imgsz,
        len(class_names),
    )
    return encoder, device, probe, meta


def _probe_predict(emb, probe):
    """(N, D) embeddings → (N, n_classes) softmax probabilities (numpy)."""
    import numpy as np

    z = (emb - probe["mean"]) / probe["scale"]
    logits = z @ probe["coef"].T + probe["intercept"]
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def _read_crossings(crossings_path: str) -> list[dict]:
    if not os.path.isfile(crossings_path):
        raise FileNotFoundError(f"crossings not found: {crossings_path}")
    out = []
    with open(crossings_path) as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _clamp_bbox(bbox, w: int, h: int):
    """Pixel bbox → integer (x1, y1, x2, y2) clamped to the frame; None if it
    has no area after clamping (degenerate crop)."""
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(int(round(x1)), w))
    y1 = max(0, min(int(round(y1)), h))
    x2 = max(0, min(int(round(x2)), w))
    y2 = max(0, min(int(round(y2)), h))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def classify_video(payload: dict) -> dict:
    """Classify every crossing in ``crossings_path`` and return
    {ok, total, distribution}. Writes one JSONL line per crossing to
    ``classifications_path`` and one crop JPG per crossing to ``crops_dir``.
    """
    import cv2
    import torch
    from PIL import Image
    from torchvision import transforms

    video_path = payload["video_path"]
    crossings_path = payload["crossings_path"]
    classifications_path = payload["classifications_path"]
    crops_dir = payload["crops_dir"]
    model_path = payload["model_path"]

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"video not found: {video_path}")

    encoder, device, probe, meta = _load_model(model_path)
    imgsz = meta["imgsz"]
    class_names = meta["class_names"]
    transform = transforms.Compose(
        [transforms.Resize((imgsz, imgsz)), transforms.ToTensor()]
    )

    crossings = _read_crossings(crossings_path)
    # Group by frame so one sequential decode pass crops every crossing, and all
    # crops on a frame embed in one batched forward.
    by_frame: dict[int, list[dict]] = defaultdict(list)
    for cr in crossings:
        by_frame[int(cr["frame"])].append(cr)

    os.makedirs(crops_dir, exist_ok=True)
    os.makedirs(os.path.dirname(classifications_path), exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    distribution: Counter = Counter()
    total = 0
    frame_idx = 0
    try:
        with open(classifications_path, "w") as out:
            while by_frame:  # stop once every wanted frame has been consumed
                ok, frame = cap.read()
                if not ok:
                    break
                wanted = by_frame.pop(frame_idx, None)
                if wanted:
                    total += _classify_frame(
                        frame,
                        wanted,
                        encoder,
                        device,
                        probe,
                        class_names,
                        transform,
                        crops_dir,
                        out,
                        distribution,
                        cv2,
                        torch,
                        Image,
                    )
                frame_idx += 1
    finally:
        cap.release()

    missing = sum(len(v) for v in by_frame.values())
    if missing:
        # Crossings referenced frames the decoder never reached (truncated MP4 or
        # an index past EOF). Report rather than silently undercount.
        logger.warning(
            "%s: %d crossing(s) referenced frames not decoded (video too short?)",
            os.path.basename(video_path),
            missing,
        )

    logger.info(
        "Classified %s: total=%d distribution=%s",
        os.path.basename(video_path),
        total,
        dict(distribution),
    )
    return {"ok": True, "total": total, "distribution": dict(distribution)}


def _classify_frame(
    frame,
    crossings: list[dict],
    encoder,
    device,
    probe,
    class_names,
    transform,
    crops_dir,
    out,
    distribution,
    cv2,
    torch,
    Image,
) -> int:
    """Crop, embed (batched), classify and persist every crossing on one frame.
    Returns how many crops were classified (degenerate bboxes are skipped)."""
    h, w = frame.shape[:2]
    tensors = []
    kept: list[tuple[dict, str]] = []  # (crossing, crop_path) aligned with tensors
    for cr in crossings:
        box = _clamp_bbox(cr["bbox"], w, h)
        if box is None:
            continue
        x1, y1, x2, y2 = box
        crop_bgr = frame[y1:y2, x1:x2]
        crop_path = os.path.join(crops_dir, f"{cr['track_id']}_{cr['frame']}.jpg")
        cv2.imwrite(crop_path, crop_bgr)
        rgb = crop_bgr[:, :, ::-1]  # BGR -> RGB (matches PIL.convert('RGB'))
        tensors.append(transform(Image.fromarray(rgb)))
        kept.append((cr, crop_path))

    if not tensors:
        return 0

    batch = torch.stack(tensors).to(device)
    with torch.no_grad():
        emb = encoder.embed(batch).cpu().numpy()
    probs = _probe_predict(emb, probe)

    for (cr, crop_path), row in zip(kept, probs):
        pos = int(row.argmax())
        label_idx = int(probe["classes"][pos])
        label = class_names[label_idx]
        confidence = float(row[pos])
        distribution[label] += 1
        out.write(
            json.dumps(
                {
                    "track_id": cr["track_id"],
                    "frame": cr["frame"],
                    "pts": cr.get("pts"),
                    "bbox": cr.get("bbox"),    # full-frame [x1,y1,x2,y2] (for FruitCrop)
                    "det_cls": cr.get("cls"),  # YOLO detector label (NOT ripeness)
                    "label": label,            # predicted ripeness class
                    "confidence": round(confidence, 4),
                    "probs": {
                        class_names[int(probe["classes"][j])]: round(float(p), 4)
                        for j, p in enumerate(row)
                    },
                    "crop": os.path.basename(crop_path),
                }
            )
            + "\n"
        )
    return len(kept)
