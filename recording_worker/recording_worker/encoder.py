"""H.264 / MP4 encoder backends for the recording worker.

Backend selection (in priority order):
1. ``nvv4l2h264enc`` (Jetson) — GStreamer pipeline writing MP4 directly to disk.
2. ``h264_nvenc`` (desktop NVIDIA) — PyAV mux to MP4.
3. ``libx264`` (CPU fallback) — PyAV mux to MP4.

GStreamer (``gi``) is only imported lazily when probed/used so that the
module is import-safe on environments without PyGObject installed
(laptop dev, CI). PyAV is a hard dep — laptops without GPU still need
it for the libx264 fallback.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Optional

import numpy as np

logger = logging.getLogger("recording_worker.encoder")


def _gst_has_element(name: str) -> bool:
    try:
        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import Gst

        if not Gst.is_initialized():
            Gst.init(None)
        return Gst.ElementFactory.find(name) is not None
    except Exception:
        return False


def _pyav_can_open(codec: str) -> bool:
    try:
        import av
        import fractions

        ctx = av.CodecContext.create(codec, "w")
        ctx.width = 64
        ctx.height = 64
        ctx.pix_fmt = "yuv420p"
        ctx.framerate = fractions.Fraction(30, 1)
        ctx.time_base = fractions.Fraction(1, 30)
        ctx.bit_rate = 500_000
        ctx.open()
        return True
    except Exception:
        return False


def detect_backend() -> str:
    """Return the best available encoding backend name.

    Order: ``nvv4l2h264enc`` > ``h264_nvenc`` > ``libx264``.
    """
    if _gst_has_element("nvv4l2h264enc"):
        return "nvv4l2h264enc"
    if _pyav_can_open("h264_nvenc"):
        return "h264_nvenc"
    return "libx264"


# ---------------------------------------------------------------------------
# Common interface
# ---------------------------------------------------------------------------


class Encoder(ABC):
    backend: str

    @abstractmethod
    def start(
        self,
        uuid: str,
        output_path: str,
        width: int,
        height: int,
        fps: float,
    ) -> None: ...

    @abstractmethod
    def write_frame(self, frame: np.ndarray) -> None: ...

    @abstractmethod
    def stop(self) -> dict: ...


# ---------------------------------------------------------------------------
# GStreamer Jetson: appsrc ! videoconvert ! nvv4l2h264enc ! h264parse !
#                   mp4mux ! filesink
# ---------------------------------------------------------------------------


class GstMp4Encoder(Encoder):
    backend = "nvv4l2h264enc"

    def __init__(self, bitrate: int = 4_000_000) -> None:
        self._bitrate = bitrate
        self._pipeline = None
        self._appsrc = None
        self._bus = None
        self._width = 0
        self._height = 0
        self._fps = 0.0
        self._frame_count = 0
        self._started_at = 0.0

    def start(
        self,
        uuid: str,
        output_path: str,
        width: int,
        height: int,
        fps: float,
    ) -> None:
        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import Gst

        if not Gst.is_initialized():
            Gst.init(None)

        framerate_n = max(1, int(round(fps)))
        pipeline_str = (
            "appsrc name=src is-live=true format=time do-timestamp=false "
            f"caps=video/x-raw,format=BGR,width={width},height={height},"
            f"framerate={framerate_n}/1 "
            "! videoconvert "
            f"! nvv4l2h264enc bitrate={self._bitrate} "
            "preset-level=1 profile=0 control-rate=1 iframeinterval=60 "
            "! h264parse "
            "! mp4mux "
            f"! filesink location={output_path}"
        )
        logger.info("GStreamer pipeline: %s", pipeline_str)

        self._pipeline = Gst.parse_launch(pipeline_str)
        self._appsrc = self._pipeline.get_by_name("src")
        self._bus = self._pipeline.get_bus()
        self._pipeline.set_state(Gst.State.PLAYING)
        self._width = width
        self._height = height
        self._fps = fps
        self._frame_count = 0
        self._started_at = time.monotonic()

    def write_frame(self, frame: np.ndarray) -> None:
        if self._pipeline is None or self._appsrc is None:
            return
        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import Gst

        raw = frame.tobytes()
        buf = Gst.Buffer.new_allocate(None, len(raw), None)
        buf.fill(0, raw)
        duration = int(Gst.SECOND / max(1.0, self._fps))
        buf.pts = self._frame_count * duration
        buf.duration = duration
        self._frame_count += 1
        ret = self._appsrc.emit("push-buffer", buf)
        if ret != Gst.FlowReturn.OK:
            logger.warning("appsrc push-buffer returned %s", ret)

    def stop(self) -> dict:
        if self._pipeline is None:
            return self._stats()

        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import Gst

        if self._appsrc is not None:
            self._appsrc.emit("end-of-stream")

        if self._bus is not None:
            # Wait up to 5 seconds for EOS so mp4mux finalises the moov atom.
            self._bus.timed_pop_filtered(
                5 * Gst.SECOND, Gst.MessageType.EOS | Gst.MessageType.ERROR
            )

        self._pipeline.set_state(Gst.State.NULL)
        self._pipeline = None
        self._appsrc = None
        self._bus = None

        return self._stats()

    def _stats(self) -> dict:
        duration = max(0.0, time.monotonic() - self._started_at)
        effective_fps = self._frame_count / duration if duration > 0 else self._fps
        return {
            "duration_seconds": round(duration, 2),
            "width": self._width,
            "height": self._height,
            "fps": round(effective_fps, 2),
            "frame_count": self._frame_count,
        }


# ---------------------------------------------------------------------------
# PyAV (h264_nvenc desktop or libx264 CPU)
# ---------------------------------------------------------------------------


class PyAvEncoder(Encoder):
    def __init__(self, codec: str, bitrate: int = 4_000_000) -> None:
        self.backend = codec
        self._codec = codec
        self._bitrate = bitrate
        self._container = None
        self._stream = None
        self._width = 0
        self._height = 0
        self._fps = 0.0
        self._frame_count = 0
        self._started_at = 0.0

    def start(
        self,
        uuid: str,
        output_path: str,
        width: int,
        height: int,
        fps: float,
    ) -> None:
        import av

        framerate = max(1, int(round(fps)))
        self._container = av.open(output_path, mode="w")
        self._stream = self._container.add_stream(self._codec, rate=framerate)
        self._stream.width = width
        self._stream.height = height
        self._stream.pix_fmt = "yuv420p"
        self._stream.bit_rate = self._bitrate
        if self._codec == "libx264":
            self._stream.options = {"preset": "veryfast", "tune": "zerolatency"}
        self._width = width
        self._height = height
        self._fps = fps
        self._frame_count = 0
        self._started_at = time.monotonic()

    def write_frame(self, frame: np.ndarray) -> None:
        if self._container is None or self._stream is None:
            return
        import av

        av_frame = av.VideoFrame.from_ndarray(frame, format="bgr24")
        for packet in self._stream.encode(av_frame):
            self._container.mux(packet)
        self._frame_count += 1

    def stop(self) -> dict:
        if self._container is None or self._stream is None:
            return self._stats()
        for packet in self._stream.encode():
            self._container.mux(packet)
        self._container.close()
        self._container = None
        self._stream = None
        return self._stats()

    def _stats(self) -> dict:
        duration = max(0.0, time.monotonic() - self._started_at)
        effective_fps = self._frame_count / duration if duration > 0 else self._fps
        return {
            "duration_seconds": round(duration, 2),
            "width": self._width,
            "height": self._height,
            "fps": round(effective_fps, 2),
            "frame_count": self._frame_count,
        }


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def make_encoder(backend: Optional[str] = None) -> Encoder:
    name = backend or detect_backend()
    if name == "nvv4l2h264enc":
        return GstMp4Encoder()
    if name == "h264_nvenc":
        return PyAvEncoder("h264_nvenc")
    return PyAvEncoder("libx264")
