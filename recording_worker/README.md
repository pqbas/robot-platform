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
