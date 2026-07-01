"""Synchronous Unix socket client for the inference worker.

La serialización del frame a JPEG es por hardware (`nvjpegenc` vía
`jpeg_encoder.make_jpeg_encoder`) en Jetson, con fallback a `cv2` en dev/no-Jetson.
El inference-worker recibe el mismo JPEG (contrato del socket sin cambios).
"""

import logging
import socket

import numpy as np

from back.services.perception.jpeg_encoder import make_jpeg_encoder
from back.services.perception.protocol import recv_response, send_request

logger = logging.getLogger("inference_client")


class InferenceClient:
    def __init__(self, socket_path: str):
        self._socket_path = socket_path
        self._sock: socket.socket | None = None
        # Lazy: no construir el pipeline HW hasta el primer detect() (en reposo,
        # sin sesión de conteo, no se reserva hardware).
        self._jpeg = None

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

    def close(self) -> None:
        """Cierra el socket y libera el encoder JPEG HW (pipeline GStreamer)."""
        self._disconnect()
        if self._jpeg is not None:
            self._jpeg.close()
            self._jpeg = None

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

    def reload_model(self, model_path: str, class_mapping: list | None = None) -> dict | None:
        """Tell the worker to load a different model."""
        return self.send_command("reload_model", model_path=model_path, class_mapping=class_mapping or [])

    def detect(
        self,
        frame: np.ndarray,
        target_class: str | None = None,
        conf: float = 0.5,
        roi_mode: str = "square",
    ) -> dict | None:
        """Send frame to worker, return detections dict or None on failure."""
        try:
            self._connect()
        except (ConnectionRefusedError, FileNotFoundError):
            logger.warning("Inference worker not available")
            return None

        # El camera worker sirve YUYV crudo (H, W, 2); el inference worker espera
        # un JPEG BGR. La serialización (YUYV→I420→JPEG) corre en hardware
        # (nvjpegenc) en Jetson y en cv2 como fallback dev. Frames ya-BGR
        # (3 canales) los maneja el encoder por CPU. Solo con sesión activa.
        if self._jpeg is None:
            self._jpeg = make_jpeg_encoder()
        jpeg_bytes = self._jpeg.encode(frame)
        if jpeg_bytes is None:
            logger.warning("Fallo al serializar el frame a JPEG (encoder HW)")
            return None

        header = {
            "target_class": target_class,
            "confidence": conf,
            "roi_mode": roi_mode,
        }

        try:
            send_request(self._sock, header, jpeg_bytes)
            return recv_response(self._sock)
        except (ConnectionError, OSError):
            logger.warning("Lost connection to inference worker, will reconnect")
            self._disconnect()
            return None
