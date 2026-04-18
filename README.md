# Robot Platform

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

### Robot + servidor simultáneamente

```bash
# terminal 1: inference worker
make run-inference-dev

# terminal 2: backend robot → localhost:8080
make run-robot

# terminal 3: backend servidor → localhost:9090 (levanta PostgreSQL)
make run-server

# terminal 4: frontend robot → localhost:5173
make run-front

# terminal 5: frontend servidor → localhost:5174
make run-front-server
```

> Primera vez con el servidor: ejecutar `make db-migrate` antes de `make run-server`.

---

## Deploy producción

```bash
make deploy-robot   # instala robot (nginx + systemd, SQLite, puerto 8080)
make deploy-server  # instala servidor (nginx + systemd + PostgreSQL, puerto 9090)
```

```bash
make status          # estado de servicios
make logs            # logs del backend
make logs-inference  # logs del inference worker
make restart         # reiniciar servicios
make update          # git pull + rebuild + restart
```
