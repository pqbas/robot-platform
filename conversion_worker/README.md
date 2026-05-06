# Conversion Worker

Builds TensorRT engines (`.engine`) from YOLO `.pt` checkpoints on demand.
Idle until the backend sends a `convert` command on `/tmp/conversion.sock`,
so it costs ~0% CPU and 0 GPU when not in use.

The `.engine` is **device-specific** (a build for Jetson Xavier won't run
on Orin or a desktop GPU). That is why this worker runs on the robot, not
on the central server.

## Why a separate uv project

The backend uses Python 3.13 (its own `uv` venv). On Jetson, `tensorrt`
ships with JetPack as an apt package (`python3-libnvinfer`) that is bound
to the system Python 3.10 and rebuilt only by NVIDIA. We do not want to
force the backend onto system Python just to expose `tensorrt` to the
exporter, so the conversion-worker is its own project, and its venv is
created with `--system-site-packages` so it inherits the JetPack bindings
without copying them.

## Install (Jetson)

```bash
sudo apt-get install -y python3-libnvinfer python3-libnvinfer-dev
cd conversion_worker
uv venv --clear --system-site-packages --python /usr/bin/python3
uv pip install --no-deps ultralytics numpy hatchling
uv pip install -e . --no-deps
```

`deploy/install.sh` does this automatically when run as `make deploy-robot`
on aarch64.

## Install (dev laptop, no NVIDIA)

```bash
cd conversion_worker
uv sync
```

The worker will start, accept `convert` commands, and fail with a clear
import error when ultralytics tries to load the TensorRT exporter. The
backend reports the failure as `engine_status='error'` and the rest of
the platform keeps working.

## Run

```bash
make run-conversion
# or
cd conversion_worker && uv run conversion-worker --control-socket /tmp/conversion.sock
```

In production it runs as the systemd unit `conversion-worker`.

## Manual conversion (for debugging)

```python
from conversion_worker.converter import convert
convert(
    "data/robot/models/blueberry.pt",
    "data/robot/models/blueberry.deadbeef.fp16.engine",
    precision="fp16",
)
```

`model.export(format="engine", half=True, imgsz=640)` is what does the
build under the hood. Expect 8–15 min on a Jetson Xavier per model.
Record the actual measured time + observed FPS gain here once validated:

| Model | Jetson | Build time | FPS .pt | FPS .engine | Ratio |
|-------|--------|-----------|---------|-------------|-------|
| blueberry.pt | Xavier | TBD | TBD | TBD | TBD |

## Why `.engine` is not portable

TensorRT serializes the optimized graph against the exact GPU compute
capability + TensorRT version used at build time. Moving an `.engine`
between Volta (Xavier), Ampere (Orin), and Turing/Ada (desktop) will
either fail to load or silently produce wrong outputs. We bake the
sha256 of the source `.pt` into the engine filename so re-uploads
(via the AI engineer's flow on the central server) automatically
invalidate the cached engine and trigger a rebuild on the robot.
