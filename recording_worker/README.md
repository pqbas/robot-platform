# Recording worker

Encodes camera frames into MP4 (H.264) on demand. Runs as an independent
process; the FastAPI backend orchestrates start/stop via Unix socket.

## Sockets

- **Camera (read)**: `/tmp/camera.sock` (consumer of the camera-worker
  fan-out). The worker only connects after a `start` command — idle uses
  zero CPU and zero NVENC.
- **Control (server)**: `/tmp/recording.sock`. JSON length-prefixed
  request/response.

## Commands

```json
{"cmd": "start", "uuid": "<uuid>", "output_path": "<path>.mp4"}
{"cmd": "stop"}
{"cmd": "status"}
```

## Backends

`detect_backend()` returns the first available, in priority order:

1. `nvv4l2h264enc` — Jetson, GStreamer pipeline
   `appsrc ! videoconvert ! nvv4l2h264enc ! h264parse ! mp4mux ! filesink`.
2. `h264_nvenc` — desktop NVIDIA via PyAV.
3. `libx264` — CPU fallback.

## Install

```bash
# laptop dev (PyAV + libx264)
cd recording_worker && uv sync

# Jetson (PyAV + GStreamer/NVENC)
cd recording_worker && uv sync --extra gstreamer
```

The `nvv4l2h264enc` element ships with `nvidia-l4t-gstreamer` (JetPack);
PyGObject alone is not enough.

## Run

```bash
make run-recording             # = cd recording_worker && uv run recording-worker
```

## Probe the active backend

```bash
cd recording_worker && uv run python -c \
  "from recording_worker.encoder import detect_backend; print(detect_backend())"
```

## Quality

Defaults are tuned for legible 720p footage on each backend. They are
hardcoded for now — a future phase exposes them as env vars.

- **`nvv4l2h264enc` (Jetson, NVENC)**: 8 Mbps CBR, profile=High (4),
  preset-level=Slow (4), keyframe every 60 frames. The HW encoder makes
  Slow basically free, and High profile enables CABAC + B-frames for
  better compression at the same bitrate. ~60 MB/min, ~3.6 GB/h.
  Inspect available presets/profiles with:
  ```bash
  gst-inspect-1.0 nvv4l2h264enc | grep -EA5 'preset-level|profile'
  ```
- **`libx264` (laptop dev fallback)**: 6 Mbps ceiling with `preset=medium
  crf=20`. CRF gates quality; bit_rate caps file size. `tune=zerolatency`
  is intentionally NOT set — it disables B-frames and only matters for
  live streams.

The recording fps is read from the camera-worker handshake (no longer
hardcoded at 30) so playback speed reflects the real capture rate.
