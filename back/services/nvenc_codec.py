"""Hardware-accelerated H.264 encoder via PyAV (desktop) or GStreamer (Jetson)."""

import fractions
import logging
from typing import Iterator, Optional

import av
from av.video.codeccontext import VideoCodecContext

from aiortc.codecs.h264 import H264Encoder, MAX_FRAME_RATE

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Detect available backends
# ---------------------------------------------------------------------------

HAS_PYAV_NVENC = False
try:
    _ctx = av.CodecContext.create("h264_nvenc", "w")
    _ctx.width = 64
    _ctx.height = 64
    _ctx.pix_fmt = "yuv420p"
    _ctx.framerate = fractions.Fraction(30, 1)
    _ctx.time_base = fractions.Fraction(1, 30)
    _ctx.bit_rate = 500_000
    _ctx.open()
    del _ctx
    HAS_PYAV_NVENC = True
except Exception:
    pass

HAS_GSTREAMER = False
try:
    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GstApp", "1.0")
    from gi.repository import Gst, GstApp  # noqa: F401

    Gst.init(None)
    HAS_GSTREAMER = True
except (ImportError, ValueError):
    pass


def _detect_gst_encoder() -> Optional[str]:
    if not HAS_GSTREAMER:
        return None
    for name in ("nvv4l2h264enc", "nvh264enc"):
        if Gst.ElementFactory.find(name):
            return name
    return None


def detect_backend() -> str:
    """Return the best available encoding backend name."""
    if HAS_PYAV_NVENC:
        return "h264_nvenc"
    gst = _detect_gst_encoder()
    if gst:
        return gst
    return "libx264"


# ---------------------------------------------------------------------------
# PyAV NVENC encoder (desktop NVIDIA)
# ---------------------------------------------------------------------------


class PyAvNvencEncoder(H264Encoder):
    """H264Encoder using FFmpeg h264_nvenc via PyAV. Works on desktop NVIDIA GPUs."""

    def __init__(self) -> None:
        super().__init__()
        self.codec: Optional[VideoCodecContext] = None
        self._first_log = False

    def _encode_frame(
        self, frame: av.VideoFrame, force_keyframe: bool
    ) -> Iterator[bytes]:
        if not self._first_log:
            logger.info(
                "WebRTC H264 encoder live: h264_nvenc @ %dx%d %d kbps",
                frame.width,
                frame.height,
                self.target_bitrate // 1000,
            )
            self._first_log = True

        if self.codec and (
            frame.width != self.codec.width
            or frame.height != self.codec.height
            or abs(self.target_bitrate - self.codec.bit_rate) / self.codec.bit_rate
            > 0.1
        ):
            self.codec = None

        if force_keyframe:
            frame.pict_type = av.video.frame.PictureType.I
        else:
            frame.pict_type = av.video.frame.PictureType.NONE

        if self.codec is None:
            self.codec = av.CodecContext.create("h264_nvenc", "w")
            self.codec.width = frame.width
            self.codec.height = frame.height
            self.codec.bit_rate = self.target_bitrate
            self.codec.pix_fmt = "yuv420p"
            self.codec.framerate = fractions.Fraction(MAX_FRAME_RATE, 1)
            self.codec.time_base = fractions.Fraction(1, MAX_FRAME_RATE)
            self.codec.options = {
                "preset": "p1",
                "tune": "ull",
                "zerolatency": "1",
                "rc": "cbr",
                "profile": "baseline",
            }
            logger.info(
                "h264_nvenc codec ready (%dx%d @ %d kbps)",
                frame.width,
                frame.height,
                self.target_bitrate // 1000,
            )

        data_to_send = b""
        for packet in self.codec.encode(frame):
            data_to_send += bytes(packet)

        if data_to_send:
            yield from self._split_bitstream(data_to_send)


# ---------------------------------------------------------------------------
# GStreamer NVENC encoder (Jetson)
# ---------------------------------------------------------------------------

if HAS_GSTREAMER:

    class GstNvencEncoder(H264Encoder):
        """H264Encoder using GStreamer hardware encoding. Works on Jetson (nvv4l2h264enc)."""

        def __init__(self) -> None:
            super().__init__()
            self._pipeline: Optional["Gst.Pipeline"] = None
            self._src: Optional["Gst.Element"] = None
            self._sink: Optional["Gst.Element"] = None
            self._width = 0
            self._height = 0
            self._frame_count = 0
            self._applied_bitrate = 0
            self._encoder_element = _detect_gst_encoder()
            self._first_log = False
            logger.info("GStreamer H.264 encoder element: %s", self._encoder_element)

        def _build_pipeline(self, width: int, height: int) -> None:
            if self._pipeline is not None:
                self._pipeline.set_state(Gst.State.NULL)

            bitrate_kbps = self.target_bitrate // 1000
            self._applied_bitrate = self.target_bitrate

            appsrc_caps = (
                "appsrc name=src is-live=true format=time do-timestamp=false "
                f"caps=video/x-raw,format=BGR,width={width},height={height},"
                "framerate=30/1"
            )

            if self._encoder_element == "nvv4l2h264enc":
                # Mirrors recording_worker/.../encoder.py post-PR #40.
                # nvv4l2h264enc only accepts NVMM-tagged buffers; the bridge
                # converts NV12 system-memory → NV12 NVMM. Without it the
                # encoder silently drops frames and the live stalls.
                # do-timestamp stays false because aiortc sets pts/time_base
                # on the av.VideoFrame upstream (CameraStreamTrack.recv);
                # letting GStreamer overwrite them breaks RTP sync.
                pipeline_str = (
                    f"{appsrc_caps} "
                    "! queue "
                    "! videoconvert "
                    "! video/x-raw,format=NV12 "
                    "! nvvidconv "
                    "! video/x-raw(memory:NVMM),format=NV12 "
                    f"! nvv4l2h264enc bitrate={self.target_bitrate} "
                    "preset-level=4 profile=4 control-rate=1 "
                    "iframeinterval=60 "
                    "! video/x-h264,stream-format=byte-stream,alignment=au "
                    "! appsink name=sink emit-signals=false sync=false"
                )
            elif self._encoder_element == "nvh264enc":
                pipeline_str = (
                    f"{appsrc_caps} "
                    "! videoconvert "
                    f"! nvh264enc bitrate={bitrate_kbps} "
                    "preset=low-latency-hq rc-mode=cbr "
                    "zerolatency=true "
                    "! video/x-h264,stream-format=byte-stream,alignment=au "
                    "! appsink name=sink emit-signals=false sync=false"
                )
            else:
                pipeline_str = (
                    f"{appsrc_caps} "
                    "! videoconvert "
                    f"! x264enc bitrate={bitrate_kbps} "
                    "tune=zerolatency speed-preset=ultrafast "
                    "key-int-max=60 "
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
                logger.error(
                    "GStreamer pipeline failed to enter PLAYING state "
                    "(encoder=%s, %dx%d)",
                    self._encoder_element,
                    width,
                    height,
                )
                raise RuntimeError(
                    "GStreamer pipeline failed to enter PLAYING state"
                )
            self._width = width
            self._height = height
            self._frame_count = 0
            logger.info(
                "GStreamer pipeline ready: %s (%dx%d @ %d kbps)",
                self._encoder_element,
                width,
                height,
                bitrate_kbps,
            )

        def _encode_frame(
            self, frame: av.VideoFrame, force_keyframe: bool
        ) -> Iterator[bytes]:
            needs_rebuild = (
                self._pipeline is None
                or frame.width != self._width
                or frame.height != self._height
                or (
                    self._applied_bitrate > 0
                    and abs(self.target_bitrate - self._applied_bitrate)
                    / self._applied_bitrate
                    > 0.1
                )
            )
            if needs_rebuild:
                self._build_pipeline(frame.width, frame.height)

            if not self._first_log:
                logger.info(
                    "WebRTC H264 encoder live: %s @ %dx%d %d kbps",
                    self._encoder_element,
                    frame.width,
                    frame.height,
                    self.target_bitrate // 1000,
                )
                self._first_log = True

            if force_keyframe:
                event = Gst.Event.new_custom(
                    Gst.EventType.CUSTOM_DOWNSTREAM,
                    Gst.Structure.new_empty("GstForceKeyUnit"),
                )
                self._src.send_event(event)

            bgr = frame.reformat(format="bgr24")
            raw = bgr.to_ndarray().tobytes()

            buf = Gst.Buffer.new_allocate(None, len(raw), None)
            buf.fill(0, raw)
            duration = Gst.SECOND // 30
            buf.pts = self._frame_count * duration
            buf.duration = duration
            self._frame_count += 1

            ret = self._src.emit("push-buffer", buf)
            if ret != Gst.FlowReturn.OK:
                logger.warning("appsrc push-buffer returned %s", ret)
                return

            sample = self._sink.try_pull_sample(Gst.SECOND)
            if sample is None:
                return

            out_buf = sample.get_buffer()
            ok, info = out_buf.map(Gst.MapFlags.READ)
            if not ok:
                return
            encoded = bytes(info.data)
            out_buf.unmap(info)

            yield from self._split_bitstream(encoded)

        def __del__(self) -> None:
            if self._pipeline is not None:
                self._pipeline.set_state(Gst.State.NULL)
                self._pipeline = None
