"""Tests for camera_client.wait_for_socket and CameraClient.read_frame retry."""

import json
import socket
import struct
import threading
import time
from pathlib import Path

import numpy as np
import pytest

from back.services.camera_client import CameraClient, wait_for_socket


# ---------------------------------------------------------------------------
# wait_for_socket
# ---------------------------------------------------------------------------


def test_wait_for_socket_missing_path(tmp_path):
    """Raises TimeoutError immediately when path never exists."""
    missing = str(tmp_path / "no.sock")
    with pytest.raises(TimeoutError):
        wait_for_socket(missing, timeout=0.4)


def test_wait_for_socket_no_listener(tmp_path):
    """Raises TimeoutError when the socket file exists but nobody is listening."""
    sock_path = str(tmp_path / "ghost.sock")
    # Create the socket file without binding/listening
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.bind(sock_path)
    # Do NOT call s.listen() — so connects will be refused
    try:
        with pytest.raises(TimeoutError):
            wait_for_socket(sock_path, timeout=0.5)
    finally:
        s.close()


def test_wait_for_socket_ready_immediately(tmp_path):
    """Returns without error when the socket is already accepting."""
    sock_path = str(tmp_path / "ready.sock")
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(sock_path)
    srv.listen(1)

    def _accept():
        try:
            conn, _ = srv.accept()
            conn.close()
        except OSError:
            pass

    t = threading.Thread(target=_accept, daemon=True)
    t.start()
    try:
        wait_for_socket(sock_path, timeout=2.0)  # must not raise
    finally:
        srv.close()
        t.join(timeout=1)


def test_wait_for_socket_becomes_ready(tmp_path):
    """Returns once the socket becomes available within the timeout window."""
    sock_path = str(tmp_path / "late.sock")

    def _serve_after_delay():
        time.sleep(0.3)
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(sock_path)
        srv.listen(1)
        try:
            conn, _ = srv.accept()
            conn.close()
        except OSError:
            pass
        finally:
            srv.close()

    t = threading.Thread(target=_serve_after_delay, daemon=True)
    t.start()
    try:
        wait_for_socket(sock_path, timeout=2.0)  # must not raise
    finally:
        t.join(timeout=1)


# ---------------------------------------------------------------------------
# CameraClient.read_frame retry
# ---------------------------------------------------------------------------


def _make_handshake(width: int, height: int, channels: int) -> bytes:
    payload = json.dumps({"width": width, "height": height, "channels": channels}).encode()
    return struct.pack(">I", len(payload)) + payload


def _make_frame(arr: np.ndarray) -> bytes:
    raw = arr.tobytes()
    return struct.pack(">I", len(raw)) + raw


def _run_camera_server(sock_path: str, frames_to_serve: int, drop_first: bool = False):
    """Minimal camera-worker stub: serves handshake + N frames."""
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(sock_path)
    srv.listen(1)
    srv.settimeout(3.0)

    def _handler():
        try:
            conn, _ = srv.accept()
            if drop_first:
                # Close immediately to simulate camera-worker crash mid-session
                conn.close()
                # Re-accept for the retry
                conn2, _ = srv.accept()
                conn2.send(_make_handshake(4, 4, 3))
                for _ in range(frames_to_serve):
                    frame = np.zeros((4, 4, 3), dtype=np.uint8)
                    conn2.send(_make_frame(frame))
                conn2.close()
            else:
                conn.send(_make_handshake(4, 4, 3))
                for _ in range(frames_to_serve):
                    frame = np.zeros((4, 4, 3), dtype=np.uint8)
                    conn.send(_make_frame(frame))
                conn.close()
        except OSError:
            pass
        finally:
            srv.close()

    t = threading.Thread(target=_handler, daemon=True)
    t.start()
    return srv, t


def test_read_frame_success(tmp_path):
    """Normal path: read a single frame from the stub server."""
    sock_path = str(tmp_path / "cam.sock")
    srv, t = _run_camera_server(sock_path, frames_to_serve=1)
    time.sleep(0.05)

    client = CameraClient(sock_path)
    try:
        frame = client.read_frame()
        assert frame.shape == (4, 4, 3)
    finally:
        client.close()
        t.join(timeout=2)


def test_read_frame_retry_on_disconnect(tmp_path):
    """read_frame retries when the server drops the first connection."""
    sock_path = str(tmp_path / "cam_retry.sock")
    srv, t = _run_camera_server(sock_path, frames_to_serve=1, drop_first=True)
    time.sleep(0.05)

    client = CameraClient(sock_path)
    try:
        # Should succeed on the second attempt without raising
        frame = client.read_frame()
        assert frame.shape == (4, 4, 3)
    finally:
        client.close()
        t.join(timeout=3)


def test_read_frame_exhausts_budget(tmp_path):
    """read_frame raises ConnectionError when socket is gone and budget runs out."""
    sock_path = str(tmp_path / "gone.sock")
    # No server started — socket path does not exist
    client = CameraClient(sock_path)
    import back.services.camera_client as cc_module
    original = cc_module.STREAM_READ_TIMEOUT_S
    cc_module.STREAM_READ_TIMEOUT_S = 0.5  # short budget for the test
    try:
        with pytest.raises((ConnectionError, OSError)):
            client.read_frame()
    finally:
        cc_module.STREAM_READ_TIMEOUT_S = original
        client.close()
