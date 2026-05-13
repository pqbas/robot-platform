"""H264 Annex-B encoder para el path WebCodecs sobre WebSocket.

Misma estructura de pipeline que `nvenc_codec.py` pero sin envolver `H264Encoder`
de aiortc: salida cruda Annex-B (`stream-format=byte-stream, alignment=au`),
SPS+PPS inline antes de cada IDR vía `h264parse config-interval=1`. Cada call
a `push_frame()` empuja un BGR ndarray y drena lo que el pipeline tenga listo.

Lifecycle: la primera `push_frame()` construye la pipeline. `close()` la
destruye (NULL state). Reuso entre frames sin rebuild.
"""

from __future__ import annotations

import logging
from typing import Iterator, Optional

import numpy as np

from back.services.nvenc_codec import HAS_GSTREAMER, _detect_gst_encoder

if HAS_GSTREAMER:
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

logger = logging.getLogger("h264_encoder")

BITRATE_BPS = 2_000_000
IFRAME_INTERVAL = 30  # keyframe cada ~1s a 30 fps


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
                "preset-level=4 profile=4 control-rate=1 "
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
        """Empuja un frame BGR; yieldea tuples (is_keyframe, nal_bytes).

        En estado estable yieldea 0 o 1 chunks por call: el pipeline absorbe
        el frame, h264parse lo emite como un access unit cuando está listo. La
        primera call típicamente yieldea 0 (warmup); las siguientes yieldean 1.
        Durante warmup x264enc puede acumular varios pushes antes de emitir
        el primer keyframe, así que drenamos en loop por seguridad.
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

        while True:
            sample = self._sink.try_pull_sample(50 * Gst.MSECOND)
            if sample is None:
                return
            out_buf = sample.get_buffer()
            is_keyframe = (out_buf.get_flags() & Gst.BufferFlags.DELTA_UNIT) == 0
            ok, info = out_buf.map(Gst.MapFlags.READ)
            if not ok:
                continue
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
