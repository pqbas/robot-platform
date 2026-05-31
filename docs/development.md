# Local development

## Robot only

```bash
make run-inference-dev   # terminal 1
make run-robot           # terminal 2 → :8080
make run-front           # terminal 3 → :5173
```

## Robot and server in parallel

```bash
make run-inference-dev   # terminal 1
make run-robot           # terminal 2 → :8080
make run-server          # terminal 3 → :9090
make run-front           # terminal 4 → :5173
make run-front-server    # terminal 5 → :5174
```

First time with the server: run `make db-migrate` before `make run-server`.

## Useful commands

```bash
make status          # service status
make logs            # backend logs
make logs-inference  # inference worker logs
make restart         # restart services
make update          # git pull + rebuild + restart
```
