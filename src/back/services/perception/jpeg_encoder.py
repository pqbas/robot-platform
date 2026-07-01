"""Serializador de frames a JPEG para la inferencia en vivo.

Dos implementaciones con la misma interfaz encode() / close():
- HwJpegEncoder: GStreamer (Jetson/producción). `appsrc(YUY2) ! nvvidconv !
  nvjpegenc ! appsink` → el JPEG sale 100% del hardware (VIC + encoder JPEG del
  Jetson), sin cvtColor/imencode de CPU.
- CpuJpegEncoder: cv2.cvtColor + cv2.imencode (dev/laptop sin nvjpegenc).

make_jpeg_encoder() devuelve la mejor disponible. El JPEG resultante (quality 85)
es idéntico en contrato al que hoy produce `cv2.imencode`: el inference-worker lo
decodifica a BGR sin cambios.

Espeja el patrón de `back/services/h264_encoder.py` (appsrc/appsink persistente,
lazy por resolución, factory make_*).
"""

from __future__ import annotations

import logging
from typing import Optional

import cv2
import numpy as np

from back.services.nvenc_codec import HAS_GSTREAMER

if HAS_GSTREAMER:
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

logger = logging.getLogger("jpeg_encoder")

JPEG_QUALITY = 85


def _has_nvjpegenc() -> bool:
    """True si GStreamer y el elemento nvjpegenc (encoder JPEG HW) existen."""
    return HAS_GSTREAMER and Gst.ElementFactory.find("nvjpegenc") is not None


def _cpu_encode(frame: np.ndarray, quality: int = JPEG_QUALITY) -> bytes:
    """YUYV/BGR → JPEG en CPU (cv2). Es la lógica que vivía en inference_client.

    Frames YUYV (H, W, 2) se convierten a BGR primero; frames ya-BGR (H, W, 3)
    se codifican directo.
    """
    if frame.ndim == 3 and frame.shape[2] == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_YUV2BGR_YUYV)
    _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return jpeg.tobytes()


class HwJpegEncoder:
    """appsrc(YUY2) ! nvvidconv ! nvjpegenc ! appsink — JPEG por hardware.

    Solo procesa frames YUYV (H, W, 2) por HW; frames en BGR delegan en el
    helper CPU (`nvjpegenc`/`nvvidconv` no aceptan BGR en system memory).
    """

    def __init__(self, quality: int = JPEG_QUALITY) -> None:
        if not HAS_GSTREAMER:
            raise RuntimeError(
                "HwJpegEncoder requiere GStreamer (gi/Gst). "
                "En Jetson: `uv sync --extra gstreamer`."
            )
        self._quality = quality
        self._pipeline: Optional["Gst.Pipeline"] = None
        self._src: Optional["Gst.Element"] = None
        self._sink: Optional["Gst.Element"] = None
        self._width = 0
        self._height = 0
        logger.info("HwJpegEncoder (nvjpegenc) ready")

    def _build_pipeline(self, width: int, height: int) -> None:
        if self._pipeline is not None:
            self._pipeline.set_state(Gst.State.NULL)

        # YUY2 (sysmem) → I420 en nvvidconv (HW VIC), sin conversión de color en
        # CPU → nvjpegenc (encoder JPEG HW). nvjpegenc acepta I420/NV12; I420 es
        # el camino directo verificado en prototipo.
        pipeline_str = (
            "appsrc name=src is-live=true format=time do-timestamp=true "
            f"caps=video/x-raw,format=YUY2,width={width},height={height},"
            "framerate=30/1 "
            "! nvvidconv "
            "! video/x-raw,format=I420 "
            f"! nvjpegenc quality={self._quality} "
            "! image/jpeg "
            "! appsink name=sink emit-signals=false sync=false max-buffers=2"
        )

        self._pipeline = Gst.parse_launch(pipeline_str)
        self._src = self._pipeline.get_by_name("src")
        self._sink = self._pipeline.get_by_name("sink")
        ret = self._pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            self._pipeline.set_state(Gst.State.NULL)
            self._pipeline = None
            self._src = None
            self._sink = None
            raise RuntimeError(
                f"HwJpegEncoder pipeline failed to PLAY ({width}x{height})"
            )
        self._width = width
        self._height = height
        logger.info("HwJpegEncoder pipeline ready (%dx%d, q=%d)", width, height, self._quality)

    def encode(self, frame: np.ndarray) -> Optional[bytes]:
        """Frame → bytes JPEG. YUYV va por HW; BGR delega en CPU.

        Devuelve None si el pipeline HW no produjo sample (fallo de encode).
        """
        if not (frame.ndim == 3 and frame.shape[2] == 2):
            # Frame ya-BGR (p. ej. broadcaster MJPEG) → CPU, HW no lo acepta.
            return _cpu_encode(frame, self._quality)

        h, w = frame.shape[:2]
        if self._pipeline is None or w != self._width or h != self._height:
            self._build_pipeline(w, h)

        assert self._src is not None and self._sink is not None

        buf = Gst.Buffer.new_wrapped(frame.tobytes())
        ret = self._src.emit("push-buffer", buf)
        if ret != Gst.FlowReturn.OK:
            logger.warning("HwJpegEncoder appsrc push-buffer returned %s", ret)
            return None

        # Action-signal (no el método try_pull_sample, que exige el typelib de
        # GstApp cargado) → funciona con solo Gst importado.
        sample = self._sink.emit("try-pull-sample", 200 * Gst.MSECOND)
        if sample is None:
            logger.warning("HwJpegEncoder no produjo sample (timeout)")
            return None
        out_buf = sample.get_buffer()
        ok, info = out_buf.map(Gst.MapFlags.READ)
        if not ok:
            return None
        jpeg = bytes(info.data)
        out_buf.unmap(info)
        return jpeg

    def close(self) -> None:
        if self._pipeline is not None:
            self._pipeline.set_state(Gst.State.NULL)
            self._pipeline = None
            self._src = None
            self._sink = None

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


class CpuJpegEncoder:
    """Fallback dev/no-Jetson: cv2.cvtColor + cv2.imencode. Mismo contrato."""

    def __init__(self, quality: int = JPEG_QUALITY) -> None:
        self._quality = quality
        logger.info("CpuJpegEncoder (cv2) ready")

    def encode(self, frame: np.ndarray) -> Optional[bytes]:
        return _cpu_encode(frame, self._quality)

    def close(self) -> None:
        pass


def make_jpeg_encoder() -> "HwJpegEncoder | CpuJpegEncoder":
    """Devuelve HwJpegEncoder si nvjpegenc existe, CpuJpegEncoder si no."""
    if _has_nvjpegenc():
        return HwJpegEncoder()
    logger.info("nvjpegenc no disponible — JPEG por CPU (cv2)")
    return CpuJpegEncoder()
