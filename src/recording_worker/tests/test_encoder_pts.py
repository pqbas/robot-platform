"""Integration test: PTS explicito → duracion del MP4 = tiempo real.

Usa PyAvEncoder con libx264 (no requiere GPU). Pushea 10 frames a ~10fps
real con fps declarado=30 y verifica que la duracion del MP4 refleja el
tiempo real (~1s), no el framerate declarado (que daria ~0.33s).
"""

import time

import av
import numpy as np

from recording_worker.encoder import PyAvEncoder


def test_pyav_pts_matches_real_time(tmp_path):
    output = str(tmp_path / "out.mp4")
    enc = PyAvEncoder("libx264")
    enc.start("test-uuid", output, 640, 480, fps=30.0)

    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    for _ in range(10):
        enc.write_frame(frame)
        time.sleep(0.1)
    enc.stop()

    container = av.open(output)
    stream = container.streams.video[0]
    duration_s = float(stream.duration * stream.time_base)
    container.close()

    # 10 frames a 100ms = 1.0s real; tolerancia del 10%.
    assert duration_s >= 0.9, f"duracion {duration_s:.3f}s < 0.9s"
