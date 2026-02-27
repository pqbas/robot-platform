"""Monkey-patch aiortc to use hardware H.264 encoder."""

import logging

logger = logging.getLogger(__name__)


def init_nvenc() -> None:
    """Replace aiortc's software H264Encoder with a hardware-accelerated one.

    Detection order:
      1. h264_nvenc via PyAV/FFmpeg  (desktop NVIDIA)
      2. GStreamer nvv4l2h264enc      (Jetson)
      3. GStreamer nvh264enc           (desktop, newer GStreamer)
      4. libx264 — keep original      (no change)
    """
    from back.services.nvenc_codec import detect_backend

    backend = detect_backend()

    if backend == "libx264":
        logger.info("No hardware encoder found, keeping default libx264")
        return

    import aiortc.codecs
    import aiortc.codecs.h264

    if backend == "h264_nvenc":
        from back.services.nvenc_codec import PyAvNvencEncoder

        encoder_cls = PyAvNvencEncoder
    else:
        from back.services.nvenc_codec import GstNvencEncoder

        encoder_cls = GstNvencEncoder

    aiortc.codecs.h264.H264Encoder = encoder_cls  # type: ignore[misc]
    aiortc.codecs.H264Encoder = encoder_cls  # type: ignore[attr-defined]

    # Force H264 by removing VP8 from the negotiation list
    aiortc.codecs.CODECS["video"] = [
        c for c in aiortc.codecs.CODECS["video"] if "VP8" not in c.mimeType
    ]

    logger.info("aiortc H264Encoder patched → %s (%s)", encoder_cls.__name__, backend)
