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

if [[ "$MODE" == "robot" ]]; then
    info "Installing Python dependencies (inference worker)..."
    cd "$INSTALL_DIR/inference"
    if [[ "$(uname -m)" == "aarch64" ]]; then
        # Jetson: use system PyTorch (NVIDIA CUDA) via --system-site-packages
        # Do not install torch/torchvision from PyPI (x86 only)
        info "Jetson detected (aarch64): using system PyTorch"
        uv venv --clear --system-site-packages --python /usr/bin/python3
        uv pip install --no-deps ultralytics opencv-python numpy lap hatchling
        uv pip install -e . --no-deps
    else
        uv sync
    fi
    cd "$INSTALL_DIR"

    info "Installing Python dependencies (camera worker)..."
    cd "$INSTALL_DIR/camera_worker"
    uv sync
    cd "$INSTALL_DIR"

    info "Installing Python dependencies (recording worker)..."
    cd "$INSTALL_DIR/recording_worker"
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
    cd "$INSTALL_DIR/conversion_worker"
    if [[ "$(uname -m)" == "aarch64" ]]; then
        # Jetson: use system Python 3.10 + JetPack's tensorrt bindings
        # via --system-site-packages. The JetPack package
        # 'python3-libnvinfer' provides 'tensorrt' for system python only,
        # which is why we cannot reuse the backend's uv-managed Python 3.13.
        info "Jetson detected (aarch64): installing conversion worker against system Python (TensorRT)"
        sudo apt-get install -y -qq python3-libnvinfer python3-libnvinfer-dev || \
            warn "python3-libnvinfer apt install failed — TensorRT conversions will not work until JetPack provides it"
        uv venv --clear --system-site-packages --python /usr/bin/python3
        uv pip install --no-deps ultralytics numpy hatchling
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
cd "$INSTALL_DIR/front"
npm ci
npm run build

if [[ ! -f "$INSTALL_DIR/front/dist/index.html" ]]; then
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

# --- 7. Nginx ---
info "Configuring nginx..."

if [[ "$MODE" == "robot" ]]; then
    BACKEND_PORT=8080
else
    BACKEND_PORT=9090
fi

export BACKEND_PORT
export SERVER_NAME="_"

envsubst '${BACKEND_PORT} ${SERVER_NAME}' \
    < "$INSTALL_DIR/deploy/nginx.conf.template" \
    | sudo tee /etc/nginx/sites-available/robot-platform > /dev/null

sudo ln -sf /etc/nginx/sites-available/robot-platform /etc/nginx/sites-enabled/robot-platform

# Remove default site if it exists
if [[ -f /etc/nginx/sites-enabled/default ]]; then
    sudo rm /etc/nginx/sites-enabled/default
    info "Removed default nginx site"
fi

sudo nginx -t
sudo systemctl reload nginx
info "Nginx configured and reloaded"

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
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/camera_worker|g" \
        "$INSTALL_DIR/deploy/camera-worker.service" \
        | sudo tee /etc/systemd/system/camera-worker.service > /dev/null

    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/recording_worker|g" \
        "$INSTALL_DIR/deploy/recording-worker.service" \
        | sudo tee /etc/systemd/system/recording-worker.service > /dev/null

    sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
        -e "s|DEPLOY_DIR|${INSTALL_DIR}/conversion_worker|g" \
        "$INSTALL_DIR/deploy/conversion-worker.service" \
        | sudo tee /etc/systemd/system/conversion-worker.service > /dev/null
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
    ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head
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
