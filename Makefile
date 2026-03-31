.PHONY: start run-robot run-server run-front run-inference db-up db-down db-migrate build-front deploy-robot deploy-server restart logs logs-inference status update

start:
	uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-robot:
	ENV_FILE=.env.robot uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-server:
	docker compose -f docker-compose.server.yml up -d
	ENV_FILE=.env.server uv run uvicorn back.main:app --host 0.0.0.0 --port 9090 --reload

run-inference:
	cd inference && uv run inference-worker --model ../yolo11n.pt

db-up:
	docker compose -f docker-compose.server.yml up -d

db-down:
	docker compose -f docker-compose.server.yml down

db-migrate:
	ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head

run-front:
	cd front && ENV_FILE=$(or $(ENV_FILE),../.env.robot) npm run dev

build-front:
	cd front && npm ci && npm run build

deploy-robot:
	./deploy/install.sh robot

deploy-server:
	./deploy/install.sh server

restart:
	-sudo systemctl restart inference-worker
	sudo systemctl restart robot-platform

logs:
	sudo journalctl -u robot-platform -f

logs-inference:
	sudo journalctl -u inference-worker -f

status:
	@sudo systemctl status robot-platform --no-pager
	@echo "---"
	@-sudo systemctl status inference-worker --no-pager
	@echo "---"
	@sudo systemctl status nginx --no-pager

update:
	git pull
	uv sync
	cd inference && uv sync
	cd front && npm ci && npm run build
	-sudo systemctl restart inference-worker
	sudo systemctl restart robot-platform
