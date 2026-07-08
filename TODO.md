# TODO (trabajo diferido)

## Camera worker — CPU alto por captura YUYV sin comprimir
**Estado:** no es bug, es por diseño. Pendiente de optimizar si compite con la inferencia.

- La cámara (ZED 2i estéreo) abre a **2560×720 YUYV @30fps** y el worker convierte
  **YUYV→BGR por software** en cada frame + fan-out → ~1.4 cores (130-140% CPU).
- Es deliberado: YUYV da "píxeles limpios" al encoder H264 (evita doble compresión).
  Ver `src/camera_worker/camera_worker/main.py:143-146` (`cap.set(FOURCC, "YUYV")`).
- RAM está holgada (no hay fuga); el problema es solo CPU.

**Opciones para bajar CPU (cuando se trabaje):**
1. **Bajar fps 30→15** (`--fps 15` en el unit systemd `camera-worker.service`): mitad
   de conversiones, sin tocar resolución/calidad. Menos invasivo.
2. Permitir **MJPG** en vez de YUYV (cámara comprime → baja USB y CPU mucho), a costa
   de algo de calidad de imagen — va contra la decisión de "píxeles limpios".
3. Solo actuar si la inferencia/conteo pierde FPS por falta de CPU.
