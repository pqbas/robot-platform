FROM python:3.13-slim

WORKDIR /app

# Instalar uv (versión pineada)
RUN pip install --no-cache-dir uv==0.7.8

# Copiar archivos de dependencias antes del código fuente para
# aprovechar la caché de capas de Docker
COPY pyproject.toml uv.lock ./

# Sincronizar dependencias (sin devs, sin editable install)
RUN uv sync --frozen --no-dev

# Copiar el código del backend
COPY src/back/ ./back/

EXPOSE 9090

CMD ["uv", "run", "uvicorn", "back.main:app", "--host", "0.0.0.0", "--port", "9090"]
