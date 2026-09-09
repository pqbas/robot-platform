# Benchmark de inferencia — PyTorch (`.pt`) vs TensorRT FP16 (`.engine`)

Registro de la mejora de velocidad al convertir un modelo de detección `.pt` a
un engine TensorRT FP16 sobre el robot. Incluye los comandos exactos para
**reproducir la medición en otros equipos**.

- **Fecha:** 08-09-2026
- **Modelo:** `yolo26n_grape.pt` (subido como modelo local en el robot)
- **Objetivo:** cuantificar cuánto acelera la inferencia el engine TensorRT.

---

## Entorno de medición

| Componente | Valor |
|---|---|
| Equipo | NVIDIA Jetson AGX Orin Developer Kit |
| L4T / JetPack | R36.4.7 (JetPack 6.2) |
| TensorRT | 10.3.0.30 (CUDA 12.5) |
| Resolución de cámara | 720p (1280×720) |
| Worker | `inference-worker` (systemd), socket `/tmp/inference.sock` |

> **Prerrequisito de rendimiento en Jetson:** fijar los relojes al máximo antes
> de medir para resultados estables:
> ```bash
> sudo jetson_clocks
> ```

---

## Cómo funciona la medición

El `inference-worker` mantiene una ventana rodante de los últimos **600 frames**
(`deque(maxlen=600)`, ~20 s a 30 fps) con el tiempo de `detect()` y el desglose
por etapa (preprocess / inference / postprocess) que reporta ultralytics.

Se consulta ese snapshot con el comando de control `timing` sobre el socket
Unix. El protocolo es *length-prefixed* (ver
`src/inference_worker/inference_worker/protocol.py`):

```
Request : [4 bytes header_len BE][4 bytes jpeg_len BE][header JSON][JPEG bytes]
Response: [4 bytes payload_len BE][payload JSON]
```

Un mensaje con la clave `"command"` y **sin** JPEG es un comando de control
(`timing`, `status`, `reload_model`). Un mensaje **con** JPEG y sin `"command"`
ejecuta una detección real (mismo path que producción).

> **Nota:** `make bench-inference` usa `uv run`, que en este equipo intenta
> re-resolver dependencias y falla (conflicto numpy `<2.0` vs `>=2.0`). Por eso
> las mediciones de abajo usan el **python del sistema** con `socket`/`struct`
> (stdlib) — no dependen de `uv` ni del venv del worker.

---

## Reproducción

### 1. Consultar el timing en vivo (sesión real)

Con una sesión de detección activa (frames fluyendo por el worker), este script
imprime el snapshot actual. Sirve para medir **PyTorch** o **TensorRT** según el
modelo que el worker tenga cargado:

```bash
python3 - <<'EOF'
import socket, json, struct
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/inference.sock')
h = json.dumps({'command': 'timing'}).encode()
s.sendall(struct.pack('>II', len(h), 0) + h)
ln = struct.unpack('>I', s.recv(4))[0]
buf = b''
while len(buf) < ln:
    buf += s.recv(ln - len(buf))
print(json.dumps(json.loads(buf.decode()), indent=2))
EOF
```

`frames: 0` significa que el worker cargó el modelo pero aún no procesó ningún
frame — hay que abrir una sesión de detección (o inyectar frames, paso 2).

### 2. Benchmark determinista (inyectando frames)

No requiere abrir una sesión ni cámara: inyecta frames sintéticos 720p
directamente al worker por el socket (mismo `detect()` de producción). Manda
40 frames de warm-up (init de CUDA/TensorRT, expulsados del `deque(600)`) y
luego 600 medidos, de modo que la ventana quede llena solo con estado estable:

```bash
python3 - <<'EOF'
import socket, json, struct, time
import numpy as np, cv2

# Frame representativo 720p con textura (JPEG de tamaño realista).
rng = np.random.default_rng(0)
img = rng.integers(0, 255, (720, 1280, 3), dtype=np.uint8)
ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
jpeg = enc.tobytes()
print(f"JPEG: {len(jpeg)/1024:.0f} KB")

def send(sock, header, payload=b""):
    hb = json.dumps(header).encode()
    sock.sendall(struct.pack(">II", len(hb), len(payload)) + hb + payload)
    ln = struct.unpack(">I", sock.recv(4))[0]
    buf = b""
    while len(buf) < ln:
        buf += sock.recv(ln - len(buf))
    return json.loads(buf.decode())

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect("/tmp/inference.sock")
frame_hdr = {"confidence": 0.5, "roi_mode": "square"}

for _ in range(40):            # warm-up (expulsado del deque de 600)
    send(s, frame_hdr, jpeg)

t0 = time.perf_counter()
for _ in range(600):           # 600 frames medidos -> llena la ventana
    send(s, frame_hdr, jpeg)
wall = time.perf_counter() - t0
print(f"600 frames en {wall:.1f}s (incl. round-trip socket) -> {600/wall:.1f} fps efectivos")

print(json.dumps(send(s, {"command": "timing"}), indent=2))
s.close()
EOF
```

> Requiere `cv2` y `numpy` en el python que ejecutes (aquí: python del sistema,
> `cv2 4.5.4` / `numpy 1.21.5`). Los tiempos del `timing` son de `detect()` puro
> (sin overhead de socket); los "fps efectivos" incluyen el round-trip síncrono.

### 3. Activar TensorRT para un modelo

Desde la UI: **Ajustes → Modelos asignados → botón PyTorch/TensorRT**. La
conversión (`.pt → .onnx → .engine` FP16) corre en el robot (`conversion-worker`)
y tarda unos minutos. Al terminar, el engine queda en:

```
data/robot/models/<nombre>.<hash>.fp16.engine
```

y el worker lo recarga. Repetir el paso 1 o 2 para medir con el engine.

---

## Resultados

Modelo `yolo26n_grape`, 720p, ROI cuadrado central, conf 0.5, ventana de 600 frames.

| Métrica | PyTorch (`.pt`) | TensorRT (`.engine`) | Mejora |
|---|---|---|---|
| Latencia media | 44.57 ms | **20.68 ms** | **2.16×** (−54%) |
| FPS (worker) | 22.4 | **48.3** | **2.16×** |
| p50 | 44.35 ms | 20.52 ms | |
| p90 | 46.86 ms | 21.35 ms | |
| p99 | 51.82 ms | 22.80 ms | |

**Desglose por etapa (media):**

| Etapa | PyTorch | TensorRT | Mejora |
|---|---|---|---|
| Preprocess | 8.21 ms | 7.69 ms | ~igual |
| **Inference** | **33.89 ms** | **10.80 ms** | **3.1×** (−68%) |
| Postprocess | 1.47 ms | 1.36 ms | ~igual |

---

## Lectura

- **La conversión vale la pena:** de **22 → 48 FPS**. Con `.pt` el modelo iba
  por debajo de los 30 FPS de cámara (acumulaba latencia); con el `.engine`
  sobra margen y la inferencia deja de ser el cuello de botella.
- **La ganancia está toda en la inferencia pura** (33.9 → 10.8 ms, 3.1×), que es
  exactamente lo que optimiza TensorRT FP16.
- **Nuevo cuello de botella: preprocess (7.7 ms ≈ 37% del frame).** Es el
  resize/letterbox de ultralytics en CPU, independiente del backend. Ahí está el
  margen si en el futuro se quiere exprimir más (p. ej. resize en GPU).
- **Latencia muy predecible:** p99 a solo ~2.3 ms sobre la mediana, sin picos.

**Caveats de método:**
- Frames sintéticos 720p. Preprocess e inference son independientes del contenido
  (fieles); el postprocess (NMS) con racimos reales podría subir un poco, pero es
  marginal (~1.4 ms).
- Correr `sudo jetson_clocks` antes de medir; sin relojes fijos los números
  varían entre corridas.
