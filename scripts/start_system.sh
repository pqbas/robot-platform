#!/usr/bin/env bash
# Arranca el sistema del robot en el orden correcto:
# workers base -> recording-worker (depende de camera) -> backend (robot-platform).
#
# Uso: ./scripts/start_system.sh
set -u

# Orden de arranque. camera/inference/conversion/counting son base;
# recording-worker depende de camera; robot-platform depende de camera+inference.
SERVICES=(
  camera-worker
  inference-worker
  conversion-worker
  counting-worker
  recording-worker
  robot-platform
)

echo "Arrancando el sistema del robot..."
fail=0
for svc in "${SERVICES[@]}"; do
  echo "-> systemctl start $svc"
  if sudo systemctl start "$svc"; then
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
