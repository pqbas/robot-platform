# Requirements: Recording FPS Fix

## Scope

El MP4 grabado se reproduce a velocidad real: si la sesion duro 30 segundos, el video dura 30 segundos. Actualmente se reproduce ~5x acelerado porque ambos encoders asignan timestamps basados en el framerate declarado del handshake (~30fps) en lugar del tiempo real de llegada de cada frame.

## Contexto del bug

El `camera_worker` declara `fps=30` en el handshake pero entrega frames a ~5-6fps real bajo carga (Jetson con inferencia activa). Ambos encoders usan ese fps declarado para asignar PTS a cada frame, resultando en que N frames reales se comprimen en N/30 segundos de video en lugar de en su duracion real.

Evidencia medida (span real del JSONL `t` vs duracion del MP4):

| t_real (s) | duracion_mp4 (s) | ratio |
|------------|------------------|-------|
| 3.77 | 0.667 | 5.65x |
| 7.0 | 1.3 | 5.38x |
| 6.83 | 1.167 | 5.85x |

## Behavior

- Despues del fix, la duracion del MP4 debe coincidir con el tiempo real de grabacion (+/- 1%).
- La sincronizacion del overlay JSONL en `DetectionReplayDialog` mejora automaticamente porque el campo `t` del JSONL ya es Unix timestamp real y el video tendra la misma escala de tiempo.
- No se corrigen MP4 ya grabados.
- Los stats `duration_seconds`, `fps`, `frame_count` devueltos por `stop()` no cambian (ya son calculados de `time.monotonic()`).

## Decisions

- **PTS explicito por frame (opcion A) vs remux al cerrar (opcion B)**: opcion A es preferida. Remux requiere un paso de post-procesamiento costoso (releer y reescribir todo el archivo), asume framerate constante, y no funciona si el proceso termina abruptamente. PTS por frame es O(1) por frame y correcto aunque el framerate varie a lo largo de la grabacion.
- **GstMp4Encoder: PTS explicito en el buffer Gst, sin `do-timestamp=true`**: con `do-timestamp=true`, GStreamer stampa desde el clock del pipeline, pero `nvv4l2h264enc` puede ignorar PTS externos y usar su propio timer basado en el framerate declarado en las caps. Settear PTS = `time.monotonic() - started_at` en nanosegundos en cada `Gst.Buffer` y remover `do-timestamp=true` es mas determinista.
- **PyAvEncoder: PTS explicito en `av.VideoFrame`**: PyAV sin PTS asigna 0,1,2,... en la time_base del stream (1/fps). Seteando `av_frame.pts = int(elapsed / float(stream.time_base))` se respeta el tiempo real.

## Context

- Encoders: `recording_worker/recording_worker/encoder.py`, clases `GstMp4Encoder` y `PyAvEncoder`.
- El campo `fps` llega en `main.py` linea 90-95 desde el handshake de `camera_worker`.
- Roadmap: Phase 33 (este spec).
