FROM python:3.13-slim

WORKDIR /app

# Libs de sistema requeridas por opencv-python (cv2 se importa desde
# back/routes/config_routes.py). python:3.13-slim no las trae por defecto.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libxcb1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Instalar uv (versión pineada)
RUN pip install --no-cache-dir uv==0.7.8

# Copiar archivos de dependencias antes del código fuente para
# aprovechar la caché de capas de Docker
COPY pyproject.toml uv.lock ./

# Sincronizar dependencias (sin devs, sin editable install)
RUN uv sync --frozen --no-dev

# Copiar el código del backend
COPY back/ ./back/

EXPOSE 9090

CMD ["uv", "run", "uvicorn", "back.main:app", "--host", "0.0.0.0", "--port", "9090"]
