#!/usr/bin/env bash
# Generate a local TLS cert for the robot using mkcert.
#
# Usage: ./deploy/setup-tls.sh [IP]
#   IP defaults to 192.168.0.10 (operator-facing eth1 in the current deploy).
#
# Outputs in data/robot/certs/ (gitignored):
#   rootCA.pem      — install once per operator device
#   rootCA-key.pem  — never leaves the robot
#   robot.crt       — copied to /etc/nginx/certs/ by install.sh
#   robot.key       — copied to /etc/nginx/certs/ by install.sh
#
# Regenerating = rerun this script. The CA is reused if it already exists,
# so operator devices keep trusting the new leaf cert without reinstalling.
# To rotate the CA (e.g. if rootCA-key.pem leaks), delete data/robot/certs/
# entirely and rerun — every operator device will need the new CA installed.

set -euo pipefail

ROBOT_IP="${1:-192.168.0.10}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERTS_DIR="$REPO_DIR/data/robot/certs"
MKCERT_VERSION="v1.4.4"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

if ! command -v mkcert &>/dev/null; then
    info "mkcert no instalado — descargando ${MKCERT_VERSION}..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq libnss3-tools wget
    ARCH="$(uname -m)"
    case "$ARCH" in
        aarch64) MKCERT_BIN="mkcert-${MKCERT_VERSION}-linux-arm64" ;;
        x86_64)  MKCERT_BIN="mkcert-${MKCERT_VERSION}-linux-amd64" ;;
        *) echo "Arquitectura no soportada: $ARCH" >&2; exit 1 ;;
    esac
    wget -qO /tmp/mkcert "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/${MKCERT_BIN}"
    sudo install -m 0755 /tmp/mkcert /usr/local/bin/mkcert
    rm -f /tmp/mkcert
fi

info "Versión de mkcert: $(mkcert -version 2>/dev/null || echo unknown)"

mkdir -p "$CERTS_DIR"
chmod 0750 "$CERTS_DIR"
export CAROOT="$CERTS_DIR"

# mkcert auto-creates the CA in CAROOT on first invocation. We do NOT run
# `mkcert -install` because that would add the CA to the Jetson's own trust
# stores, which we don't need — the robot never consumes its own endpoints.
info "Generando cert para IP ${ROBOT_IP}..."
mkcert \
    -cert-file "$CERTS_DIR/robot.crt" \
    -key-file  "$CERTS_DIR/robot.key" \
    "$ROBOT_IP"

chmod 0600 "$CERTS_DIR/robot.key" "$CERTS_DIR/rootCA-key.pem" 2>/dev/null || true

echo ""
info "Certs generados en $CERTS_DIR:"
echo "  CA root (público):   rootCA.pem"
echo "  CA key  (privado):   rootCA-key.pem"
echo "  Robot cert:          robot.crt"
echo "  Robot key:           robot.key"
echo ""
info "Validez del cert del robot:"
openssl x509 -in "$CERTS_DIR/robot.crt" -noout -dates
echo ""
info "SAN del cert:"
openssl x509 -in "$CERTS_DIR/robot.crt" -noout -text | grep -A1 "Subject Alternative Name" || \
    warn "No se pudo extraer SAN del cert"
echo ""
info "Próximo paso: 'make deploy-robot' para copiar los certs a /etc/nginx/certs/"
