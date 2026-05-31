"""Restart the camera-worker process without sudo.

The camera-worker runs as its own systemd unit (``camera-worker.service``)
under the same user as the backend, with ``Restart=on-failure``. When the
V4L2 device wedges (a blocked ``cap.read()`` or a USB re-enumeration to a new
``/dev/videoN``), an in-process reload can't recover it — only a fresh process
clears the kernel-side state. Operators today fix this with ``make restart``,
which restarts every service just to unstick the camera.

This module reads the unit's main PID (an unprivileged ``systemctl show``) and
sends it ``SIGKILL``; systemd respawns it ~3s later (``RestartSec=3``). A
``SIGKILL`` exits non-zero so ``Restart=on-failure`` triggers the respawn
(a graceful ``SIGTERM`` would exit 0 and not restart).
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess

logger = logging.getLogger("camera_process")

# systemd unit name; overridable for non-default deployments.
CAMERA_WORKER_UNIT = os.getenv("CAMERA_WORKER_UNIT", "camera-worker")


class CameraRestartError(Exception):
    """The camera-worker process could not be restarted."""


def _read_main_pid(unit: str) -> int:
    """Return the unit's MainPID, or raise if systemd/unit is unavailable.

    ``systemctl show -p MainPID --value`` prints ``0`` when the unit is not
    running (or not managed by systemd, e.g. a dev ``uv run`` session).
    """
    try:
        result = subprocess.run(
            ["systemctl", "show", "-p", "MainPID", "--value", unit],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except FileNotFoundError as exc:
        raise CameraRestartError("systemctl not available") from exc
    except subprocess.TimeoutExpired as exc:
        raise CameraRestartError("systemctl show timed out") from exc

    if result.returncode != 0:
        raise CameraRestartError(
            f"systemctl show failed: {result.stderr.strip() or result.returncode}"
        )

    raw = result.stdout.strip()
    try:
        pid = int(raw)
    except ValueError as exc:
        raise CameraRestartError(f"unexpected MainPID output: {raw!r}") from exc

    if pid <= 0:
        raise CameraRestartError(
            f"{unit} is not running under systemd (MainPID={pid})"
        )
    return pid


def restart_camera_worker(unit: str = CAMERA_WORKER_UNIT) -> int:
    """SIGKILL the camera-worker so systemd respawns it. Returns the killed PID."""
    pid = _read_main_pid(unit)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        # Already gone — systemd is likely respawning it; treat as success.
        logger.info("Camera worker PID %d already exited", pid)
        return pid
    except PermissionError as exc:
        raise CameraRestartError(
            f"not permitted to signal PID {pid} (different user?)"
        ) from exc
    logger.info("Sent SIGKILL to camera worker PID %d — systemd will respawn", pid)
    return pid
