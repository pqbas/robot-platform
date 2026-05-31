"""H264 Annex-B encoder para el path WebCodecs sobre WebSocket.

Dos implementaciones con la misma interfaz push_frame() / close():
- H264AnnexBEncoder: GStreamer (Jetson/producción). Requiere gi + Gst.
- H264AnnexBEncoderPyAV: PyAV/libx264 (dev/laptop). Sin dependencias extra.

make_h264_encoder() devuelve la mejor disponible.
"""

from __future__ import annotations

import fractions
import logging
from typing import Iterator, Optional

import av
import numpy as np

from back.services.nvenc_codec import HAS_GSTREAMER, _detect_gst_encoder

if HAS_GSTREAMER:
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

logger = logging.getLogger("h264_encoder")

BITRATE_BPS = 2_000_000
IFRAME_INTERVAL = 15  # keyframe cada ~0.5s a 30 fps — recovery más rápida tras drop de P-frames


class H264AnnexBEncoder:
    """GStreamer-backed encoder con fallback a x264enc si no hay NVENC."""

    def __init__(self) -> None:
        if not HAS_GSTREAMER:
            raise RuntimeError(
                "H264AnnexBEncoder requiere GStreamer (gi/Gst). "
                "En Jetson: `uv sync --extra gstreamer`."
            )
        self._encoder_element = _detect_gst_encoder() or "x264enc"
        self._pipeline: Optional["Gst.Pipeline"] = None
        self._src: Optional["Gst.Element"] = None
        self._sink: Optional["Gst.Element"] = None
        self._width = 0
        self._height = 0
        self._frame_count = 0
        logger.info("H264AnnexBEncoder element: %s", self._encoder_element)

    def _build_pipeline(self, width: int, height: int) -> None:
        if self._pipeline is not None:
            self._pipeline.set_state(Gst.State.NULL)

        appsrc_caps = (
            "appsrc name=src is-live=true format=time do-timestamp=false "
            f"caps=video/x-raw,format=BGR,width={width},height={height},"
            "framerate=30/1"
        )

        if self._encoder_element == "nvv4l2h264enc":
            # BGR → BGRx (videoconvert, system mem) → NV12 NVMM (nvvidconv on
            # the HW VIC) → nvv4l2h264enc. h264parse re-emite SPS+PPS antes
            # de cada IDR para clientes que reconectan mid-stream.
            pipeline_str = (
                f"{appsrc_caps} "
                "! queue "
                "! videoconvert "
                "! video/x-raw,format=BGRx "
                "! nvvidconv "
                "! video/x-raw(memory:NVMM),format=NV12 "
                f"! nvv4l2h264enc name=enc bitrate={BITRATE_BPS} "
                # profile=0 = Baseline. Matches el codec string del cliente
                # (avc1.42E01E) y evita B-frames → menor latencia.
                # nvv4l2h264enc profiles: 0=Baseline, 2=Main, 4=High.
                "preset-level=4 profile=0 control-rate=1 "
                f"iframeinterval={IFRAME_INTERVAL} maxperf-enable=true "
                "insert-sps-pps=true "
                "! h264parse config-interval=1 "
                "! video/x-h264,stream-format=byte-stream,alignment=au "
                "! appsink name=sink emit-signals=false sync=false"
            )
        elif self._encoder_element == "nvh264enc":
            kbps = BITRATE_BPS // 1000
            pipeline_str = (
                f"{appsrc_caps} "
                "! videoconvert "
                f"! nvh264enc name=enc bitrate={kbps} "
                "preset=low-latency-hq rc-mode=cbr zerolatency=true "
                "! h264parse config-interval=1 "
                "! video/x-h264,stream-format=byte-stream,alignment=au "
                "! appsink name=sink emit-signals=false sync=false"
            )
        else:
            kbps = BITRATE_BPS // 1000
            pipeline_str = (
                f"{appsrc_caps} "
                "! videoconvert "
                f"! x264enc name=enc bitrate={kbps} "
                "tune=zerolatency speed-preset=ultrafast "
                f"key-int-max={IFRAME_INTERVAL} "
                "! h264parse config-interval=1 "
                "! video/x-h264,stream-format=byte-stream,alignment=au "
                "! appsink name=sink emit-signals=false sync=false"
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
                f"H264AnnexBEncoder pipeline failed to PLAY "
                f"(encoder={self._encoder_element}, {width}x{height})"
            )
        self._width = width
        self._height = height
        self._frame_count = 0
        logger.info(
            "H264AnnexBEncoder pipeline ready: %s (%dx%d @ %d kbps, gop=%d)",
            self._encoder_element,
            width,
            height,
            BITRATE_BPS // 1000,
            IFRAME_INTERVAL,
        )

    def push_frame(self, bgr: np.ndarray) -> Iterator[tuple[bool, bytes]]:
        """Empuja un frame BGR; yieldea 0 o 1 tuples (is_keyframe, nal_bytes).

        1-frame pipelining (igual que `nvenc_codec.py`): push del frame N,
        pull del frame N-1. Después de yieldear NO intentamos pullear otra
        vez — esa segunda pull bloquearía 50ms esperando un AU que recién
        sale en el próximo push, capando el throughput a ~20fps. La primera
        call típicamente yieldea 0 (warmup); las siguientes yieldean 1.
        """
        h, w = bgr.shape[:2]
        if self._pipeline is None or w != self._width or h != self._height:
            self._build_pipeline(w, h)

        assert self._src is not None and self._sink is not None

        raw = bgr.tobytes()
        buf = Gst.Buffer.new_wrapped(raw)
        duration = Gst.SECOND // 30
        buf.pts = self._frame_count * duration
        buf.duration = duration
        self._frame_count += 1

        ret = self._src.emit("push-buffer", buf)
        if ret != Gst.FlowReturn.OK:
            logger.warning("H264AnnexBEncoder appsrc push-buffer returned %s", ret)
            return

        sample = self._sink.try_pull_sample(50 * Gst.MSECOND)
        if sample is None:
            return
        out_buf = sample.get_buffer()
        is_keyframe = (out_buf.get_flags() & Gst.BufferFlags.DELTA_UNIT) == 0
        ok, info = out_buf.map(Gst.MapFlags.READ)
        if not ok:
            return
        encoded = bytes(info.data)
        out_buf.unmap(info)
        yield is_keyframe, encoded

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


# ---------------------------------------------------------------------------
# PyAV fallback encoder (dev/laptop — no GStreamer required)
# ---------------------------------------------------------------------------

_PYAV_FRAMERATE = 30
_PYAV_KEYFRAME_INTERVAL = 15  # IDR cada ~0.5s, igual que GStreamer


class H264AnnexBEncoderPyAV:
    """libx264 via PyAV — mismo contrato de interfaz que H264AnnexBEncoder."""

    def __init__(self, bitrate_bps: int = 2_000_000) -> None:
        self._bitrate_bps = bitrate_bps
        self._codec: Optional[av.CodecContext] = None
        self._frame_count = 0
        self._width = 0
        self._height = 0
        logger.info("H264AnnexBEncoderPyAV (libx264) ready")

    def _open_codec(self, width: int, height: int) -> None:
        if self._codec is not None:
            self._codec.close()
        ctx = av.CodecContext.create("libx264", "w")
        ctx.width = width
        ctx.height = height
        ctx.pix_fmt = "yuv420p"
        ctx.bit_rate = self._bitrate_bps
        ctx.framerate = fractions.Fraction(_PYAV_FRAMERATE, 1)
        ctx.time_base = fractions.Fraction(1, _PYAV_FRAMERATE)
        ctx.options = {
            "tune": "zerolatency",
            "preset": "ultrafast",
            "profile": "baseline",
            "x264-params": f"keyint={_PYAV_KEYFRAME_INTERVAL}:min-keyint={_PYAV_KEYFRAME_INTERVAL}",
        }
        ctx.open()
        self._codec = ctx
        self._width = width
        self._height = height
        self._frame_count = 0
        logger.info("libx264 codec opened (%dx%d @ %d kbps)", width, height, self._bitrate_bps // 1000)

    def push_frame(self, bgr: np.ndarray) -> Iterator[tuple[bool, bytes]]:
        h, w = bgr.shape[:2]
        if self._codec is None or w != self._width or h != self._height:
            self._open_codec(w, h)
        assert self._codec is not None

        force_keyframe = (self._frame_count % _PYAV_KEYFRAME_INTERVAL) == 0

        rgb = bgr[:, :, ::-1]
        frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
        frame = frame.reformat(format="yuv420p")
        frame.pts = self._frame_count
        frame.time_base = fractions.Fraction(1, _PYAV_FRAMERATE)
        if force_keyframe:
            frame.pict_type = av.video.frame.PictureType.I
        self._frame_count += 1

        # Produce Annex-B packets; each packet is already a complete AU.
        for packet in self._codec.encode(frame):
            data = bytes(packet)
            if not data:
                continue
            # A packet is a keyframe if it doesn't have the DISPOSABLE flag
            # (PyAV marks non-key packets with is_keyframe=False).
            is_key = bool(getattr(packet, "is_keyframe", force_keyframe))
            # Ensure SPS+PPS prefix on keyframes — libx264 in baseline/zerolatency
            # already includes them, but we verify by checking for start codes.
            yield is_key, data

    def close(self) -> None:
        if self._codec is not None:
            try:
                self._codec.close()
            except Exception:
                pass
            self._codec = None

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def make_h264_encoder() -> "H264AnnexBEncoder | H264AnnexBEncoderPyAV":
    """Devuelve el mejor encoder disponible: GStreamer si existe, PyAV si no."""
    if HAS_GSTREAMER:
        return H264AnnexBEncoder()
    logger.info("GStreamer no disponible — usando H264AnnexBEncoderPyAV (libx264)")
    return H264AnnexBEncoderPyAV()
