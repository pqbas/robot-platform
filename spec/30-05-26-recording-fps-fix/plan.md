# Plan: Recording FPS Fix

## Group 1: GstMp4Encoder — PTS explicito por buffer

1. En `recording_worker/recording_worker/encoder.py`, clase `GstMp4Encoder`:

   - En `start()`, remover `do-timestamp=true` de la string del pipeline.
   - En `start()`, cambiar `framerate={framerate_n}/1` en las caps a `framerate=0/1` (variable framerate, indica a downstream que los timestamps vienen del buffer PTS).
   - En `write_frame()`, despues de `buf.fill(0, raw)`, agregar:
     ```python
     from gi.repository import Gst
     pts_ns = int((time.monotonic() - self._started_at) * Gst.SECOND)
     buf.pts = pts_ns
     buf.dts = pts_ns
     buf.duration = Gst.CLOCK_TIME_NONE
     ```
   - Nota: `Gst.SECOND = 1_000_000_000` (nanosegundos). El import de `gi` ya ocurre en `start()`; en `write_frame()` usar el mismo patron de import lazy que ya existe.

---

## Group 2: PyAvEncoder — PTS explicito por frame

2. En `recording_worker/recording_worker/encoder.py`, clase `PyAvEncoder`:

   - En `write_frame()`, obtener la time_base del stream y calcular PTS:
     ```python
     elapsed = time.monotonic() - self._started_at
     av_frame.pts = int(elapsed / float(self._stream.time_base))
     ```
   - Insertar estas dos lineas antes de `for packet in self._stream.encode(av_frame)`.
   - No es necesario cambiar `start()` ni el `rate` del stream: el rate sigue siendo el framerate declarado (afecta negociacion de caps, no PTS).

---

## Group 3: Validacion en dev

3. En `recording_worker/` no hay tests automaticos. Agregar un test de integracion ligero en `recording_worker/tests/test_encoder_pts.py` usando `PyAvEncoder` (no requiere GPU):
   - Crea un encoder con `libx264`.
   - Hace `start(uuid, path, 640, 480, fps=30.0)`.
   - Pushea 10 frames con `time.sleep(0.1)` entre cada uno (simulando ~10fps real con fps declarado=30).
   - Llama `stop()`.
   - Abre el archivo con `av.open` y verifica que `container.streams.video[0].duration * container.streams.video[0].time_base` es >= 0.9s (10 frames a 100ms = 1.0s real; tolerancia del 10%).
