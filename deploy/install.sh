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
info "Installing Python dependencies..."
cd "$INSTALL_DIR"
uv sync

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

sudo systemctl daemon-reload
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
