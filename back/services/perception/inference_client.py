"""Synchronous Unix socket client for the inference worker."""

import logging
import socket

import cv2
import numpy as np

from back.services.perception.protocol import recv_response, send_request

logger = logging.getLogger("inference_client")


class InferenceClient:
    def __init__(self, socket_path: str):
        self._socket_path = socket_path
        self._sock: socket.socket | None = None

    def _connect(self) -> None:
        """Connect to the inference worker socket."""
        if self._sock is not None:
            return
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(self._socket_path)
            self._sock = sock
            logger.info("Connected to inference worker at %s", self._socket_path)
        except (ConnectionRefusedError, FileNotFoundError):
            self._sock = None
            raise

    def _disconnect(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    def send_command(self, command: str, **kwargs) -> dict | None:
        """Send a control command to the worker (no JPEG payload)."""
        try:
            self._connect()
        except (ConnectionRefusedError, FileNotFoundError):
            logger.warning("Inference worker not available")
            return None

        header = {"command": command, **kwargs}
        try:
            send_request(self._sock, header, b"")
            return recv_response(self._sock)
        except (ConnectionError, OSError):
            logger.warning("Lost connection to inference worker")
            self._disconnect()
            return None

    def reload_model(self, model_path: str) -> dict | None:
        """Tell the worker to load a different model."""
        return self.send_command("reload_model", model_path=model_path)

    def detect(
        self, frame: np.ndarray, target_class: str | None = None, conf: float = 0.5
    ) -> dict | None:
        """Send frame to worker, return detections dict or None on failure."""
        try:
            self._connect()
        except (ConnectionRefusedError, FileNotFoundError):
            logger.warning("Inference worker not available")
            return None

        _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        header = {"target_class": target_class, "confidence": conf}

        try:
            send_request(self._sock, header, jpeg.tobytes())
            return recv_response(self._sock)
        except (ConnectionError, OSError):
            logger.warning("Lost connection to inference worker, will reconnect")
            self._disconnect()
            return None
