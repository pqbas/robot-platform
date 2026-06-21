# classification-worker

Offline blueberry **ripeness** classification. After the counting worker counts
a recorded MP4 and emits crossing events (`{uuid}.crossings.jsonl`), this worker
crops each crossed object from the video and predicts its ripeness class with a
frozen CNN encoder + a linear probe.

## Why offline / why a separate worker

- Same rationale as the counting worker: the crossing bbox was computed against
  the counting pass's sequential frame index over a variable-frame-rate MP4, so
  the crop must come from a **sequential decode** matching that index (not
  `CAP_PROP_POS_FRAMES`).
- Backend invariant: FastAPI must not import torch/cv2. Inference lives here.

## Model artifact

A single self-contained `classifier.npz`:

- `enc__<param>` — the Encoder state_dict as numpy arrays (frozen CNN backbone).
- `mean`, `scale`, `coef`, `intercept`, `classes` — the linear probe
  (`StandardScaler` + `LogisticRegression`) reduced to numpy.
- `class_names`, `latent_dim`, `imgsz` — metadata.

Inference: `emb = Encoder.embed(crop)` → `z = (emb - mean) / scale` →
`logits = z @ coef.T + intercept` → softmax → argmax. Preprocessing matches
training exactly: BGR→RGB → `Resize((imgsz, imgsz))` (bilinear stretch) →
`ToTensor` ([0,1]), no normalization.

Exported from `mlops-classification-blueberry` (`predict.py` builds the probe and
bundles the encoder weights). No sklearn/joblib at runtime.

## Runtime notes

- The encoder runs on **CUDA** on the Jetson. JetPack's torch 1.12 CPU conv path
  produces non-finite output for this backbone; the GPU path is correct. Off
  Jetson (no CUDA) it falls back to CPU.
- torch/torchvision/numpy come from the Jetson **system site-packages** (the
  `.venv` has `include-system-site-packages = true`), so they are not declared as
  deps. Production runs the venv binary directly (no `uv sync`).
- Idle = no thread, no GPU. One job at a time (second `classify` returns `busy`).

## Protocol

Control socket (default `/tmp/classification.sock`), JSON length-prefixed:

```
{"cmd": "classify", "uuid", "video_path", "crossings_path",
 "classifications_path", "crops_dir", "model_path"}
{"cmd": "status"}
```

## Run

```
make run-classification        # production (Jetson, venv binary)
make run-classification-dev    # laptop/CI (uv run --group dev)
```
