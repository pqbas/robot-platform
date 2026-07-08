# classification-worker

Offline blueberry **ripeness** classification. After the counting worker counts a
recorded MP4 and emits crossing events (`{uuid}.crossings.jsonl`), this worker
crops each crossed object from the video and predicts its ripeness class with a
frozen CNN encoder + a linear probe.

It is the **second stage of a two-stage pipeline** on the same recording:

```
recording  ──►  counting-worker  ──►  classification-worker
   MP4          (where is each          (how ripe is each
                 object?)                cropped object?)
```

## Relationship to counting (what they share, what they don't)

Counting and classification do **not** overlap or overwrite each other — they
chain. Counting runs first and produces exactly what classification needs.

```
   data/robot/recordings/{uuid}.mp4
        │
        ▼
 ┌──────────────── COUNTING (counting-worker) ────────────────┐
 │ decode MP4 + detect + ByteTrack + line-crossing            │
 │ writes:                                                    │
 │   • {uuid}.jsonl            per-frame detections (overlay) │
 │   • {uuid}.crossings.jsonl  ONE line per counted object    │  ◄── the handoff
 │ Recording: count_status='done', count=N                    │
 └───────────────────────────┬────────────────────────────────┘
                             │  reads {uuid}.crossings.jsonl
                             ▼
 ┌────────────── CLASSIFICATION (this worker) ────────────────┐
 │ sequential-decode MP4 → crop each crossing's bbox →        │
 │ Encoder (CUDA) + linear probe → ripeness label             │
 │ writes:                                                    │
 │   • crops/{uuid}/{track_id}_{frame}.jpg                    │
 │   • {uuid}.classifications.jsonl                           │
 │ Recording: classification_status='done'                    │
 └────────────────────────────────────────────────────────────┘
```

Shared surfaces (four points of contact):

| Shared             | What it is                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| the `Recording` row | Two **independent** state machines on one row: `count_status`/`count` and `classification_status`. Different columns → they never step on each other. |
| the MP4             | Both reprocess the same video offline.                                                         |
| `{uuid}.crossings.jsonl` | The real handoff: counting writes it, classification reads it.                            |
| the `Category`      | The hub: counting resolves its **detector + geometry** from it; classification resolves its **classifier** from the same category (different fields). |

**Classification never re-detects.** Counting already computed *which* object and
*where* (the crossings). This worker only assigns a ripeness *label* to a crop it
is handed. One crossing → one crop → one classification.

## Pipeline (per run of `classify_video`)

1. **Load** — open the MP4 with `cv2.VideoCapture` and decode **sequentially**,
   frame by frame. It does **not** load the whole video, and does **not** seek
   (`CAP_PROP_POS_FRAMES`) — see "Why offline / sequential" below.
2. **Locate frames** — read `crossings.jsonl` up front and group crossings **by
   frame** (`by_frame`). The decode advances until `frame_idx` matches a wanted
   frame, then stops early once every wanted frame has been consumed (it does not
   decode the tail of the video).
3. **Crop** — for each crossing on that frame, crop `frame[y1:y2, x1:x2]` (bbox
   clamped to the frame; degenerate boxes skipped), write one JPG per crossing to
   `crops/{uuid}/{track_id}_{frame}.jpg`.
4. **Classify** — BGR→RGB → `Resize((imgsz, imgsz))` (stretch) → `ToTensor`
   ([0,1]) → `Encoder.embed` (batched, one forward per frame, on CUDA) →
   standardize → `W·z + b` → softmax → argmax → ripeness label + confidence.

Returns `{ok, total, distribution}`; writes one line per crossing to
`classifications.jsonl`.

### Why offline / sequential (not a random seek)

The crossing bbox in `{uuid}.crossings.jsonl` was computed against the counting
pass's **sequential** frame index. The MP4 is variable-frame-rate, so
`CAP_PROP_POS_FRAMES` would seek to a *different* frame than the counter saw and
crop the wrong pixels. Decoding in order and matching `frame_idx` reproduces the
exact pixels of the exact frame → crops aligned by construction. (Same rationale
as the counting worker.)

## Sidecars — the handoff, with real shapes

Input, `{uuid}.crossings.jsonl` (produced by counting, one line per counted
object; `bbox` is full-frame `[x1,y1,x2,y2]` in pixels, `cls` is the YOLO
**detector** label, not ripeness):

```json
{"track_id": 7, "frame": 214, "pts": 7.1333, "bbox": [812.0, 440.5, 902.3, 531.7], "cls": "blueberry"}
```

Output, `{uuid}.classifications.jsonl` (one line per crossing, aligned by
`track_id`+`frame`):

```json
{"track_id": 7, "frame": 214, "pts": 7.1333, "bbox": [812.0, 440.5, 902.3, 531.7],
 "det_cls": "blueberry", "label": "ripe", "confidence": 0.9312,
 "probs": {"unripe": 0.02, "semi": 0.05, "ripe": 0.93}, "crop": "7_214.jpg"}
```

`det_cls` is the detector class carried through from the crossing; `label` is the
predicted **ripeness** class.

## DB tables written (via the backend's `classification_poller`)

The worker only writes files. The backend's poller transcribes
`classifications.jsonl` into the DB (idempotent — a reclassify deletes the
recording's old rows first):

- `fruit_crops` — one row per crop: `recording_uuid`, `track_id`, `image_path`,
  `bbox_*`. (These tables predate this feature and were session-scoped;
  migration `022` adds `recording_uuid` and makes `session_uuid` nullable so
  crops hang off the **recording**.)
- `fruit_classifications` — one row per crop: `crop_uuid`, `model_uuid`,
  `class_name`, `confidence`.
- `recordings.classification_status` → `done`, `classifications_uploaded_at` →
  `NULL` (so results re-sync to the server). Crops (`crops_uploaded_at`) upload
  only with the session's upload button.

## Lifecycle — how a job gets here (opt-in per category)

Classification is **opt-in per category**. It runs only when the counted
category has a classifier assigned; otherwise it is a silent no-op and
`classification_status` stays `none`.

- **Trigger.** When a count finishes (`count_status='done'`), the counting
  poller calls `enqueue_classification(rec)`
  (`back/services/perception/classification_trigger.py`).
  `build_classification_config` returns `None` — skipping — when the recording
  has no `count_config`/`target_class`, the `Category` has **no
  `classification_model_uuid`**, or the pinned `ClassificationModel` row is
  missing. So plain counting on a classifier-less category costs nothing.
- **Manual re-run.** `recordings.py::reclassify` re-runs with the pinned model.
- **Pinning.** `classification_config` snapshots the classifier identity
  (`model_uuid`/`version`/`file_hash`/`model_path`) so a reclassify months later
  can't silently use a different model.
- **Errors don't undo the count.** Worker-unavailable / missing model / missing
  `crossings.jsonl` is recorded as `classification_status='error'`; the count
  stays intact.
- **Crash recovery.** On backend startup,
  `reconcile_orphaned_classifications()` re-enqueues any row stuck at
  `classifying` (or marks `error` if the MP4 / `.npz` / crossings are gone), so a
  restart mid-job never hangs.

To actually get classification running you need, in order: migration `022`
applied, the backend restarted (it seeds categories via `reconcile_categories`),
`make run-classification` up, **and a classifier assigned to the category**.

## Why offline / why a separate worker

- The crop must come from a sequential decode matching the counting index (see
  above).
- Backend invariant: FastAPI must not import `torch`/`cv2`. Inference lives here.

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
  -> {"ok": true, "state": "classifying"}          # or {"ok": false, "error": "busy"}

{"cmd": "status"}
  -> {"ok": true, "state": "idle"|"classifying", "current": {...}|null,
      "last_result": {"ok": true, "uuid": "...", "total": 1234,
                      "distribution": {"ripe": 900, "unripe": 334},
                      "finished_at": "..."}|null}
```

The backend's `classification_poller` polls `status` and transcribes
`last_result` into `fruit_crops` / `fruit_classifications` /
`Recording.classification_status`.

## Run

```
make run-classification        # production (Jetson, venv binary)
make run-classification-dev    # laptop/CI (uv run --group dev)
```
