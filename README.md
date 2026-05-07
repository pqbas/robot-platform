# Robot Platform

Plataforma de software para un robot móvil agrícola que detecta, cuenta y clasifica frutos en tiempo real. Se ejecuta sobre una NVIDIA Jetson Xavier embarcada en el robot y se opera desde cualquier dispositivo conectado a su red WiFi.

## Arquitectura

El sistema se compone de un backend FastAPI que coordina cuatro workers independientes que se comunican por sockets Unix:

- **camera-worker:** captura V4L2 sobre cámara ZED 2i, fan-out a múltiples consumidores.
- **inference-worker:** detección YOLO con seguimiento BoT-SORT, soporta TensorRT FP16.
- **recording-worker:** codificación H.264 con NVENC sobre Jetson.
- **conversion-worker:** construcción de engines TensorRT FP16 a partir de modelos `.pt`.

El frontend (React + TypeScript + Vite) se sirve estático por nginx y se entrega al operador a través de un celular o tablet.

El sistema opera en dos modos seleccionables por la variable `ROBOT_MODE`:

- **`robot`:** corre en la Jetson embarcada, ejecuta captura, inferencia, grabación y sincronización.
- **`server`:** corre en una computadora del laboratorio, administra usuarios, modelos y dispositivos, y recibe la sincronización de los robots.

## Hardware

- **Robot:** NVIDIA Jetson Xavier (JetPack 5.1), cámara estéreo ZED 2i.
- **Servidor:** PC con Linux, PostgreSQL 16.

## Desarrollo local

### Solo modo robot

```bash
# terminal 1: inference worker
make run-inference-dev

# terminal 2: backend → localhost:8080
make run-robot

# terminal 3: frontend → localhost:5173
make run-front
```

### Robot y servidor en paralelo

```bash
make run-inference-dev   # terminal 1
make run-robot           # terminal 2 → :8080
make run-server          # terminal 3 → :9090 (levanta PostgreSQL)
make run-front           # terminal 4 → :5173
make run-front-server    # terminal 5 → :5174
```

> Primera vez con el servidor: ejecutar `make db-migrate` antes de `make run-server`.

## Despliegue en producción

```bash
make deploy-robot    # nginx + systemd, SQLite, puerto 8080
make deploy-server   # nginx + systemd + PostgreSQL, puerto 9090
```

Operación:

```bash
make status          # estado de los servicios
make logs            # logs del backend
make logs-inference  # logs del inference-worker
make restart         # reiniciar servicios
make update          # git pull + rebuild + restart
```

## Agradecimientos

Este trabajo es financiado por el Programa Nacional de Investigación Científica y Estudios Avanzados (**PROCIENCIA**) en el marco del proyecto **PE5010-86701-2024-PROCIENCIA**: *"Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú"*.

Se agradece al fundo Danper por la provisión del dataset de entrenamiento y a la Universidad Privada Antenor Orrego (UPAO) por el respaldo institucional al proyecto.
