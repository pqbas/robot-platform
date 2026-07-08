# Hallazgo: el cuello de botella de fps es el tracker (BoT-SORT GMC), no el modelo ni la entrega de frames

Estado: **standby** (2026-06-15). Diagnóstico cerrado, fix pendiente de implementar.

## Resumen

El conteo corre a ~6 fps. La causa **no** es la entrega de frames (cámara/JPEG/socket)
ni el modelo TensorRT. Es el paso del **tracker** dentro de `model.track()`, que
ultralytics **no** contabiliza en su breakdown `.speed`.

## Evidencia (medida en vivo, worker en sesión activa, engine yolo11n fp16)

Comando `timing` del inference worker (`detector.timing_stats()`):

| Métrica | Valor |
|---|---|
| `model.track()` completo (mean) | **159.75 ms** → 6.3 fps |
| preprocess | 11.2 ms |
| inference (TensorRT) | 11.6 ms |
| postprocess | 5.4 ms |
| **suma de etapas del modelo** | **~28 ms** |
| **hueco dentro de `model.track()` sin contabilizar** | **~131 ms** |

`detector._times_ms` mide solo la llamada `self._model.track()` (detector.py:141-143);
JPEG/sockets/cámara quedan FUERA. Por tanto los 131 ms están dentro de `model.track()`,
en el tracker.

## Causa raíz

- `detector.detect()` llama `self._model.track(roi, ...)` **sin `tracker=`**
  → ultralytics usa su default `botsort.yaml` (cfg/default.yaml:134).
- BoT-SORT trae `gmc_method: sparseOptFlow` → Global Motion Compensation con
  optical flow en CPU (goodFeaturesToTrack + calcOpticalFlowPyrLK) **cada frame**
  sobre el ROI 1080×1080.

Verificaciones (sin tocar el worker activo):
- GMC sparseOptFlow aislado sobre frame real: **~42 ms** (mín, sistema cargado).
- `model.track()` BoT-SORT vs ByteTrack (engine real, en paralelo): **272 → 192 ms**
  (~80 ms menos solo por cambiar de tracker; absolutos inflados por compartir GPU).

## Fix propuesto (pendiente)

En `src/inference_worker/inference_worker/detector.py`, pasar a `model.track()` un
tracker sin GMC:

1. `tracker="bytetrack.yaml"` — quita GMC del todo. ~+80 ms recuperados (~12 fps).
   Pierde compensación de movimiento de cámara.
2. Custom `botsort.yaml` con `gmc_method: none` — mantiene asociación BoT-SORT,
   quita solo el optical flow. Casi igual de rápido.
3. Subir `downscale` del GMC — mantiene compensación a media calidad. Menos ganancia.

### Trade-off
GMC ayuda con cámara en movimiento. Pero a 6 fps los frames van a 167 ms de distancia
(optical flow poco fiable); quitándolo subes a ~12 fps con frames más juntos, lo que
probablemente mejora el tracking neto. Validar calidad de conteo en campo al implementar.

### Nota de implementación
El worker es stateless y arranca con `--model`. Cambiar el tracker es solo el arg
`tracker=` en la llamada `track()`; requiere reiniciar el inference worker (systemd,
sudo del usuario). No afecta DB ni el reconciliador.
