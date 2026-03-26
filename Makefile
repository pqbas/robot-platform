.PHONY: start run-robot run-server db-up db-down db-migrate

start:
	uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-robot:
	ENV_FILE=.env.robot uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-server:
	ENV_FILE=.env.server uv run uvicorn back.main:app --host 0.0.0.0 --port 9090 --reload

db-up:
	docker compose -f docker-compose.server.yml up -d

db-down:
	docker compose -f docker-compose.server.yml down

db-migrate:
	ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head
