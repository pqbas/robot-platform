#!/usr/bin/env bash
set -euo pipefail

# Standalone installer for JUST the classification worker: builds its venv and
# (optionally) installs + starts the systemd unit. Mirrors the classification
# block of deploy/install.sh so you can add or rebuild this one worker without
# re-running the full installer (which also touches nginx/node/every worker).
#
# Usage: scripts/install-classification-worker.sh [--force] [--no-service]
#   --force       rebuild the venv even if it already exists
#   --no-service  build the venv only; skip the systemd unit (dev/foreground use)
#
# INSTALL_DIR defaults to /opt/robot-platform (the deploy symlink the systemd
# units reference). Override with INSTALL_DIR=... if your deploy lives elsewhere.

INSTALL_DIR="${INSTALL_DIR:-/opt/robot-platform}"
WORKER_DIR="$INSTALL_DIR/src/classification_worker"
UNIT_SRC="$INSTALL_DIR/deploy/classification-worker.service"
DEPLOY_USER="$(whoami)"

FORCE=0
WITH_SERVICE=1
for arg in "$@"; do
    case "$arg" in
        --force|-f)   FORCE=1 ;;
        --no-service) WITH_SERVICE=0 ;;
        *) echo "Unknown arg: $arg" >&2; echo "Usage: $0 [--force] [--no-service]" >&2; exit 1 ;;
    esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*" >&2; exit 1; }

command -v uv >/dev/null || error "uv no está instalado (curl -LsSf https://astral.sh/uv/install.sh | sh)"
[[ -d "$WORKER_DIR" ]] || error "No existe $WORKER_DIR (¿INSTALL_DIR correcto? actual: $INSTALL_DIR)"

# --- venv (same recipe as deploy/install.sh) ---
# The classification worker runs the frozen Encoder on CUDA (the JetPack torch
# CPU conv path produces non-finite output for this backbone) + a numpy linear
# probe. It needs CUDA torch + torchvision + system cv2/PIL via
# --system-site-packages. It does NOT use ultralytics/lap/tensorrt.
cd "$WORKER_DIR"
if [[ "$FORCE" != "1" && -d .venv ]]; then
    info "venv ya existe — usa --force para reconstruir. Saltando build."
elif [[ "$(uname -m)" == "aarch64" ]]; then
    PYVER="$(/usr/bin/python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    info "Jetson (aarch64), Python del sistema ${PYVER} — venv con system-site torch/torchvision"
    uv venv --clear --system-site-packages --python /usr/bin/python3
    if [[ "$PYVER" == "3.8" ]]; then
        # JP5: torch + torchvision come from system site-packages (inherited);
        # only pin numpy (last so it wins) for the system cv2/PIL ABI.
        uv pip install --no-deps hatchling
        uv pip install "numpy==1.24.4"
    else
        # JP6 (Python 3.10): no system torch — CUDA build from the Jetson index,
        # numpy pinned for the system cv2 ABI.
        uv pip install torch==2.8.0 torchvision==0.23.0 \
            --index-url https://pypi.jetson-ai-lab.io/jp6/cu126/+simple
        uv pip install --no-deps hatchling
        uv pip install "numpy==1.26.4"
    fi
    uv pip install -e . --no-deps
else
    info "No-Jetson — uv sync (dev)"
    uv sync
fi

[[ -x "$WORKER_DIR/.venv/bin/classification-worker" ]] \
    || error "el binario classification-worker no quedó instalado en el venv"

# --- smoke test: torch import + CUDA (Jetson only) ---
if [[ "$(uname -m)" == "aarch64" ]]; then
    VIRTUAL_ENV= "$WORKER_DIR/.venv/bin/python" - <<'PY' \
        || warn "torch/cv2 no importó limpio — revisa la salida de arriba"
import torch, cv2, numpy
print(f"    torch {torch.__version__} cuda={torch.cuda.is_available()} "
      f"| cv2 {cv2.__version__} | numpy {numpy.__version__}")
PY
fi

if [[ "$WITH_SERVICE" != "1" ]]; then
    info "venv listo. Corre en foreground con: make run-classification"
    exit 0
fi

# --- systemd unit ---
[[ -f "$UNIT_SRC" ]] || error "no existe la plantilla $UNIT_SRC"
info "Instalando unidad systemd (requiere sudo)..."
# Substitute DEPLOY_USER/DEPLOY_DIR and rewrite the hardcoded /opt path in
# ExecStart to the real WORKER_DIR, so the unit is correct even off /opt.
sed -e "s|DEPLOY_USER|${DEPLOY_USER}|g" \
    -e "s|DEPLOY_DIR|${WORKER_DIR}|g" \
    -e "s|/opt/robot-platform/src/classification_worker|${WORKER_DIR}|g" \
    "$UNIT_SRC" \
    | sudo tee /etc/systemd/system/classification-worker.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now classification-worker
info "classification-worker habilitado y arrancado"
systemctl status classification-worker --no-pager || true
