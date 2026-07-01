#!/usr/bin/env bash
# Detiene el sistema del robot en el orden inverso al arranque:
# backend (robot-platform) -> recording-worker -> workers base.
#
# Uso: ./scripts/stop_system.sh
set -u

# Inverso de start_system.sh.
SERVICES=(
  robot-platform
  recording-worker
  counting-worker
  conversion-worker
  inference-worker
  camera-worker
)

echo "Deteniendo el sistema del robot..."
fail=0
for svc in "${SERVICES[@]}"; do
  echo "-> systemctl stop $svc"
  if sudo systemctl stop "$svc"; then
    echo "   ok $svc"
  else
    echo "   ERROR $svc" >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "Listo."
else
  echo "Terminado con errores (ver arriba)." >&2
fi
exit "$fail"
