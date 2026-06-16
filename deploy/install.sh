#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="/opt/robot-platform"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

# --- 1. Validate mode ---
if [[ "$MODE" != "robot" && "$MODE" != "server" ]]; then
    echo "Usage: $0 <robot|server>"
    echo "  robot  - Install for Jetson/robot (SQLite, port 8080)"
    echo "  server - Install for server (PostgreSQL, port 9090)"
    exit 1
fi

info "Installing in ${MODE} mode"

# --- 2. System dependencies ---
info "Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq nginx

# Node.js (if not installed)
if ! command -v node &>/dev/null; then
    info "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
else
    info "Node.js already installed: $(node --version)"
fi

# uv (if not installed)
if ! command -v uv &>/dev/null; then
    info "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
else
    info "uv already installed: $(uv --version)"
fi

# --- 3. Symlink to /opt/robot-platform ---
if [[ "$REPO_DIR" != "$INSTALL_DIR" ]]; then
    if [[ -L "$INSTALL_DIR" ]]; then
        sudo rm "$INSTALL_DIR"
    elif [[ -d "$INSTALL_DIR" ]]; then
        error "$INSTALL_DIR already exists and is not a symlink. Remove it first."
    fi
    sudo ln -s "$REPO_DIR" "$INSTALL_DIR"
    info "Symlinked $REPO_DIR -> $INSTALL_DIR"
else
    info "Repo is already at $INSTALL_DIR"
fi

# --- 4. Python dependencies ---
info "Installing Python dependencies (backend)..."
cd "$INSTALL_DIR"
if [[ "$MODE" == "robot" && "$(uname -m)" == "aarch64" ]]; then
    # Jetson: install with the [gstreamer] extra so PyGObject is built
    # against system gobject-introspection. The back process drives the
    # nvv4l2h264enc encoder via aiortc monkey-patch (back/services/nvenc_codec.py)
    # for the WebRTC live path. Same build deps the recording_worker block
    # below already installs (idempotent apt step).
    info "Installing build deps for PyGObject/pycairo (backend)..."
    sudo apt-get install -y -qq \
        libcairo2-dev libgirepository1.0-dev gobject-introspection \
        pkg-config python3-dev
    info "Jetson detected (aarch64): installing backend with --extra gstreamer"
    uv sync --extra gstreamer
else
    uv sync
fi

# opencv-python and opencv-python-headless install to the same cv2/ dir. When a
# venv transitions from one to the other, `uv sync` can uninstall the old one
# and delete the shared cv2/ files, leaving the new package as a phantom
# (dist-info present, cv2/ gone) → backend crashes with "No module named 'cv2'".
# Self-repair: if cv2 doesn't import, force-reinstall the headless package.
if ! uv run python -c "import cv2" >/dev/null 2>&1; then
    warn "cv2 no importa tras uv sync — reinstalando opencv-python-headless"
    uv pip install --reinstall opencv-python-headless
fi

if [[ "$MODE" == "robot" ]]; then
    info "Installing Python dependencies (inference worker)..."
    cd "$INSTALL_DIR/src/inference_worker"
    if [[ "$(uname -m)" == "aarch64" ]]; then
        # JetPack 6 (L4T r36.4) ships NO system PyTorch — unlike JetPack 5,
        # where torch/torchvision came preinstalled in the system Python. Install
        # the CUDA build from the Jetson AI Lab index (cu126 / cp310).
        #
        # CRITICAL: torch must come from the Jetson index ONLY — do NOT add
        # --extra-index-url https://pypi.org/simple here. PyPI also publishes a
        # torch==2.8.0 aarch64 wheel, but it's the CPU-only build (manylinux,
        # no CUDA). With both indexes visible, uv resolves to the PyPI CPU wheel
        # and torch.cuda.is_available() becomes False — inference falls back to
        # CPU and TensorRT engine export breaks ("None devices in
        # CUDA_VISIBLE_DEVICES"). The Jetson index proxies PyPI for torch's
        # pure-Python deps (sympy/networkx/jinja2/filelock/fsspec/...), so a
        # single --index-url resolves the full graph with the real CUDA wheel.
        #
        # numpy is pinned to 1.26.x (installed LAST so it wins): the system
        # tensorrt 10.3 bindings (python3-libnvinfer) and the system cv2 4.5.4
        # inherited via --system-site-packages are compiled against numpy 1.x and
        # would hit the "compiled with NumPy 1.x cannot run in 2.x" ABI error
        # under numpy 2. For the same reason we DON'T install opencv-python here:
        # its current wheel is built against numpy 2; the detector only needs
        # cv2.imdecode, which the system cv2 provides.
        info "Jetson detected (aarch64): installing CUDA PyTorch for JetPack 6 (cu126)"
        uv venv --clear --system-site-packages --python /usr/bin/python3
        uv pip install torch==2.8.0 torchvision==0.23.0 \
            --index-url https://pypi.jetson-ai-lab.io/jp6/cu126/+simple
        uv pip install --no-deps ultralytics lap hatchling
        uv pip install "numpy==1.26.4"
        uv pip install -e . --no-deps
    else
        uv sync
    fi
    cd "$INSTALL_DIR"

    info "Installing Python dependencies (camera worker)..."
    cd "$INSTALL_DIR/src/camera_worker"
    uv sync
    cd "$INSTALL_DIR"

    info "Installing Python dependencies (recording worker)..."
    cd "$INSTALL_DIR/src/recording_worker"
    if [[ "$(uname -m)" == "aarch64" ]]; then
        # Jetson: install with the [gstreamer] extra so PyGObject is built
        # against system gobject-introspection and the worker can drive
        # the nvv4l2h264enc plugin shipped by nvidia-l4t-gstreamer.
        # PyGObject + pycairo compile from source against these headers
        # (the venv uses Python 3.13 so system python3-gi can't be reused).
        info "Installing build deps for PyGObject/pycairo..."
        sudo apt-get install -y -qq \
            libcairo2-dev libgirepository1.0-dev gobject-introspection \
            pkg-config python3-dev
        info "Jetson detected (aarch64): installing recording worker with --extra gstreamer"
        uv sync --extra gstreamer
    else
        uv sync
    fi
    cd "$INSTALL_DIR"

    if [[ "$(uname -m)" == "aarch64" ]]; then
        info "Verifying gstreamer plugins required for hardware-accelerated recording..."
        if command -v gst-inspect-1.0 &>/dev/null; then
            REQUIRED_GST_ELEMENTS="nvv4l2h264enc videoconvert h264parse mp4mux filesink appsrc"
            for elem in $REQUIRED_GST_ELEMENTS; do
                if ! gst-inspect-1.0 "$elem" >/dev/null 2>&1; then
                    error "gstreamer plugin '$elem' not found. Install with:
   sudo apt install gstreamer1.0-plugins-{base,good,bad,ugly} gstreamer1.0-tools
   On Jetson, the 'nvv4l2h264enc' plugin ships with 'nvidia-l4t-gstreamer' (JetPack)."
                fi
            done
            info "All required gstreamer plugins present"
        else
            error "gst-inspect-1.0 not found. Install with: sudo apt install gstreamer1.0-tools"
        fi
    fi

    info "Installing Python dependencies (conversion worker)..."
    cd "$INSTALL_DIR/src/conversion_worker"
    if [[ "$(uname -m)" == "aarch64" ]]; then
        # Jetson: use system Python 3.10 + JetPack's tensorrt bindings
        # via --system-site-packages. The JetPack package
        # 'python3-libnvinfer' provides 'tensorrt' for system python only,
        # which is why we cannot reuse the backend's uv-managed Python 3.13.
        info "Jetson detected (aarch64): installing conversion worker against system Python (TensorRT)"
        sudo apt-get install -y -qq python3-libnvinfer python3-libnvinfer-dev || \
            warn "python3-libnvinfer apt install failed — TensorRT conversions will not work until JetPack provides it"
        uv venv --clear --system-site-packages --python /usr/bin/python3
        # JetPack 6: torch is needed to load the .pt before export, and the
        # ultralytics engine exporter walks .pt -> ONNX -> TensorRT, so the ONNX
        # toolchain (onnx/onnxslim/onnxruntime) must be present — installed WITH
        # deps (protobuf, flatbuffers, ...). Only ultralytics stays --no-deps so
        # it can't drag an x86-only torch from PyPI. numpy<2 pinned last for the
        # system tensorrt 10.3 ABI (see inference worker note above).
        #
        # CRITICAL: torch from the Jetson index ONLY (no --extra-index-url pypi).
        # PyPI's torch==2.8.0 aarch64 wheel is CPU-only; with both indexes uv
        # picks it and the engine export fails with torch.cuda.is_available()
        # == False / "None devices in CUDA_VISIBLE_DEVICES". The Jetson index
        # proxies PyPI for torch's pure-Python deps, so one --index-url is enough.
        uv pip install torch==2.8.0 torchvision==0.23.0 \
            --index-url https://pypi.jetson-ai-lab.io/jp6/cu126/+simple
        uv pip install onnx onnxslim onnxruntime
        uv pip install --no-deps ultralytics hatchling
        uv pip install "numpy==1.26.4"
        uv pip install -e . --no-deps
    else
        uv sync
    fi
    cd "$INSTALL_DIR"

    info "Installing Python dependencies (counting worker)..."
    cd "$INSTALL_DIR/src/counting_worker"
    if [[ "$(uname -m)" == "aarch64" ]]; then
        # Same recipe as the inference worker: the counting worker loads a
        # .engine/.pt and runs YOLO + ByteTrack offline, so it needs CUDA torch
        # from the Jetson index and the system tensorrt/cv2 via
        # --system-site-packages. It does NOT need the ONNX export toolchain
        # (that's conversion-worker only). numpy pinned to 1.26.x last for the
        # system tensorrt 10.3 / cv2 4.5.4 ABI; opencv-python is NOT installed
        # (its wheel is built against numpy 2 — the worker uses system cv2's
        # VideoCapture for MP4 decode, same as the detector uses system cv2).
        info "Jetson detected (aarch64): installing counting worker against system Python (CUDA torch + TensorRT)"
        uv venv --clear --system-site-packages --python /usr/bin/python3
        uv pip install torch==2.8.0 torchvision==0.23.0 \
            --index-url https://pypi.jetson-ai-lab.io/jp6/cu126/+simple
        uv pip install --no-deps ultralytics lap hatchling
        uv pip install "numpy==1.26.4"
        uv pip install -e . --no-deps
    else
        uv sync
    fi
    cd "$INSTALL_DIR"

    info "Creating recordings directory..."
    mkdir -p "$INSTALL_DIR/data/robot/recordings"
fi

# --- 5. Build frontend ---
info "Building frontend..."
cd "$INSTALL_DIR/src/front"
npm ci
npm run build

if [[ ! -f "$INSTALL_DIR/src/front/dist/index.html" ]]; then
    error "Frontend build failed: dist/index.html not found"
fi
info "Frontend built successfully"

# --- 6. Environment file ---
ENV_FILE="$INSTALL_DIR/.env.${MODE}"

if [[ "$MODE" == "robot" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
        info "Creating minimal .env.robot (configure via /setup after first access)"
        cat > "$ENV_FILE" <<'ENVEOF'
ROBOT_MODE=robot
PORT=8080
DATABASE_URL=sqlite+aiosqlite:///data/robot/robot.db
ROBOT_ID=
MODELS_DIR=data/robot/models
SYNC_SERVER_URL=
SYNC_INTERVAL=30
SYNC_API_KEY=
ENVEOF
    else
        info "Using existing $ENV_FILE"
    fi
elif [[ "$MODE" == "server" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
        error ".env.server not found. Create it with your PostgreSQL credentials before installing."
    fi
    info "Using existing $ENV_FILE"
fi

# Symlink .env.active
ln -sf ".env.${MODE}" "$INSTALL_DIR/.env.active"
info "Linked .env.active -> .env.${MODE}"

# Robot: run DB migrations now (SQLite). install.sh never did this for robot,
# so model changes (e.g. recordings.camellon_id) shipped without the column and
# the backend crashed on first query. Server runs migrations in section 9 after
# Postgres is up. alembic env.py self-paths src/, so run from the repo root.
if [[ "$MODE" == "robot" ]]; then
    info "Running database migrations (robot SQLite)..."
    cd "$INSTALL_DIR"
    ENV_FILE=.env.robot uv run alembic -c src/back/alembic.ini upgrade head
fi

# --- 7. Nginx ---
info "Configuring nginx..."

if [[ "$MODE" == "robot" ]]; then
    BACKEND_PORT=8080
else
    BACKEND_PORT=9090
fi

export BACKEND_PORT

# In server mode, derive the server name from Tailscale so nginx and the TLS
# certificate paths match. Falls back to "_" if Tailscale is not available
# (e.g. first run before `tailscale up`).
if [[ "$MODE" == "server" ]]; then
    if command -v tailscale &>/dev/null; then
        TS_HOSTNAME="$(tailscale status --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['Self']['DNSName'].rstrip('.'))" 2>/dev/null || echo "")"
    else
        TS_HOSTNAME=""
    fi

    if [[ -n "$TS_HOSTNAME" ]]; then
        export SERVER_NAME="$TS_HOSTNAME"
        info "Tailscale hostname detectado: $TS_HOSTNAME"
    else
        export SERVER_NAME="_"
        warn "No se pudo obtener el hostname de Tailscale. Usar 'make deploy-server' de nuevo después de 'tailscale up'."
    fi
else
    export SERVER_NAME="_"
fi

if [[ "$MODE" == "robot" ]]; then
    NGINX_TEMPLATE="$INSTALL_DIR/deploy/nginx.robot.conf.template"
else
    NGINX_TEMPLATE="$INSTALL_DIR/deploy/nginx.server.conf.template"
fi

envsubst '${BACKEND_PORT} ${SERVER_NAME}' \
    < "$NGINX_TEMPLATE" \
    | sudo tee /etc/nginx/sites-available/robot-platform > /dev/null

sudo ln -sf /etc/nginx/sites-available/robot-platform /etc/nginx/sites-enabled/robot-platform

# Remove default site if it exists
if [[ -f /etc/nginx/sites-enabled/default ]]; then
    sudo rm /etc/nginx/sites-enabled/default
    info "Removed default nginx site"
fi

# In server mode, enable Tailscale Funnel on port 443 so the app is reachable
# from internet via https://<hostname>.ts.net
if [[ "$MODE" == "server" ]]; then
    if command -v tailscale &>/dev/null; then
        info "Activando Tailscale Funnel en puerto 443..."
        sudo tailscale funnel 443 on || warn "No se pudo activar Tailscale Funnel. Activar manualmente con: sudo tailscale funnel 443 on"
    else
        warn "Tailscale no está instalado. Instalar con: curl -fsSL https://tailscale.com/install.sh | sh"
    fi
fi

sudo nginx -t
sudo systemctl reload nginx
info "Nginx configurado y recargado"

# --- 8. Systemd ---
info "Configuring systemd service..."

DEPLOY_USER="$(whoami)"
DEPLOY_UV_PATH="$(which uv)"

sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
    -e "s|DEPLOY_UV_PATH|${DEPLOY_UV_PATH}|g" \
    "$INSTALL_DIR/deploy/robot-platform.service" \
    | sudo tee /etc/systemd/system/robot-platform.service > /dev/null

if [[ "$MODE" == "robot" ]]; then
    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        "$INSTALL_DIR/deploy/inference-worker.service" \
        | sudo tee /etc/systemd/system/inference-worker.service > /dev/null

    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/src/camera_worker|g" \
        "$INSTALL_DIR/deploy/camera-worker.service" \
        | sudo tee /etc/systemd/system/camera-worker.service > /dev/null

    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/src/recording_worker|g" \
        "$INSTALL_DIR/deploy/recording-worker.service" \
        | sudo tee /etc/systemd/system/recording-worker.service > /dev/null

    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/src/conversion_worker|g" \
        "$INSTALL_DIR/deploy/conversion-worker.service" \
        | sudo tee /etc/systemd/system/conversion-worker.service > /dev/null

    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/src/counting_worker|g" \
        "$INSTALL_DIR/deploy/counting-worker.service" \
        | sudo tee /etc/systemd/system/counting-worker.service > /dev/null
fi

sudo systemctl daemon-reload

if [[ "$MODE" == "robot" ]]; then
    sudo systemctl enable inference-worker
    sudo systemctl restart inference-worker
    info "Inference worker service enabled and started"

    sudo systemctl enable camera-worker
    sudo systemctl restart camera-worker
    info "Camera worker service enabled and started"

    sudo systemctl enable recording-worker
    sudo systemctl restart recording-worker
    info "Recording worker service enabled and started"

    sudo systemctl enable conversion-worker
    sudo systemctl restart conversion-worker
    info "Conversion worker service enabled and started"

    sudo systemctl enable counting-worker
    sudo systemctl restart counting-worker
    info "Counting worker service enabled and started"
fi

sudo systemctl enable robot-platform
sudo systemctl restart robot-platform
info "Systemd service enabled and started"

# --- 9. Server-specific: PostgreSQL + migrations ---
if [[ "$MODE" == "server" ]]; then
    info "Starting PostgreSQL (docker compose)..."
    cd "$INSTALL_DIR"
    docker compose -f docker-compose.server.yml up -d

    info "Running database migrations..."
    ENV_FILE=.env.server uv run alembic -c src/back/alembic.ini upgrade head

    # Create initial admin user interactively (only if users table is empty).
    # Source lives under src/ but imports are `back.*`, so put src/ on the path.
    USERS_COUNT=$(ENV_FILE=.env.server PYTHONPATH=src uv run python -c "
import asyncio, sys
from back.database import AsyncSessionLocal
from sqlalchemy import select, func
from back.models import User

async def count():
    async with AsyncSessionLocal() as s:
        r = await s.execute(select(func.count()).select_from(User))
        return r.scalar()

print(asyncio.run(count()))
" 2>/dev/null || echo "error")

    if [[ "$USERS_COUNT" == "0" ]]; then
        if [[ -t 0 ]]; then
            info "No hay usuarios en la base de datos. Creando admin inicial..."
            ENV_FILE=.env.server PYTHONPATH=src uv run python -m back.scripts.create_admin
        else
            warn "Instalación no-interactiva: no se creó ningún usuario admin."
            warn "Ejecutar 'make create-admin' manualmente para crear el primer admin."
        fi
    else
        info "Ya existen usuarios en la base de datos; omitiendo creación de admin."
    fi
fi

# --- 10. Create data directories ---
mkdir -p "$INSTALL_DIR/data"
info "Data directory ready"

# --- Done ---
echo ""
echo "========================================"
info "Installation complete! (${MODE} mode)"
echo "========================================"
echo ""

if [[ "$MODE" == "robot" ]]; then
    IP=$(hostname -I | awk '{print $1}')
    echo "  Access:  http://${IP}"
    echo "  First time? The UI will guide you through setup at /setup"
else
    echo "  Access:  http://localhost"
fi
echo ""
echo "  Useful commands:"
echo "    make status   - Check service status"
echo "    make logs     - Follow backend logs"
echo "    make restart  - Restart backend"
echo ""
