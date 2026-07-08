.PHONY: start run-robot run-server run-front run-inference run-conversion logs-conversion run-counting run-counting-dev logs-counting run-classification run-classification-dev logs-classification db-up db-down db-migrate build-front deploy-robot deploy-server restart logs logs-inference status update create-admin compose-build compose-up compose-down compose-logs compose-migrate compose-create-admin

start:
	PYTHONPATH=src uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-robot:
	ENV_FILE=.env.robot PYTHONPATH=src uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-server:
	docker compose -f docker-compose.server.yml up -d
	ENV_FILE=.env.server PYTHONPATH=src uv run uvicorn back.main:app --host 0.0.0.0 --port 9090 --reload

run-inference:
	cd src/inference_worker && VIRTUAL_ENV= .venv/bin/inference-worker

run-inference-dev:
	cd src/inference_worker && uv run --group dev inference-worker

run-camera:
	cd src/camera_worker && uv run camera-worker

logs-camera:
	sudo journalctl -u camera-worker -f

run-recording:
	cd src/recording_worker && uv run recording-worker

logs-recording:
	sudo journalctl -u recording-worker -f

run-conversion:
	cd src/conversion_worker && uv run conversion-worker --control-socket /tmp/conversion.sock

logs-conversion:
	sudo journalctl -u conversion-worker -f

run-counting:
	cd src/counting_worker && VIRTUAL_ENV= .venv/bin/counting-worker --control-socket /tmp/counting.sock

run-counting-dev:
	cd src/counting_worker && uv run --group dev counting-worker --control-socket /tmp/counting.sock

logs-counting:
	sudo journalctl -u counting-worker -f

run-classification:
	cd src/classification_worker && VIRTUAL_ENV= .venv/bin/classification-worker --control-socket /tmp/classification.sock

run-classification-dev:
	cd src/classification_worker && uv run --group dev classification-worker --control-socket /tmp/classification.sock

logs-classification:
	sudo journalctl -u classification-worker -f

create-admin:
	ENV_FILE=.env.server PYTHONPATH=src uv run python -m back.scripts.create_admin

db-up:
	docker compose -f docker-compose.server.yml up -d

db-down:
	docker compose -f docker-compose.server.yml down

db-migrate:
	ENV_FILE=.env.server uv run alembic -c src/back/alembic.ini upgrade head

run-front:
	cd src/front && ENV_FILE=$(or $(ENV_FILE),.env.robot) npm run dev

run-front-server:
	cd src/front && ENV_FILE=.env.server npm run dev -- --port 5174

build-front:
	cd src/front && npm ci && npm run build

deploy-robot:
	./deploy/install.sh robot $(if $(FORCE),--force,)

deploy-server:
	./deploy/install.sh server $(if $(FORCE),--force,)

restart:
	-sudo systemctl restart inference-worker
	-sudo systemctl restart camera-worker
	-sudo systemctl restart recording-worker
	-sudo systemctl restart conversion-worker
	-sudo systemctl restart counting-worker
	-sudo systemctl restart classification-worker
	sudo systemctl restart robot-platform

logs:
	sudo journalctl -u robot-platform -f

logs-inference:
	sudo journalctl -u inference-worker -f

bench-inference:
	@cd src/inference_worker && uv run python -c "import socket, json, struct, sys; s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.connect('/tmp/inference.sock'); h=json.dumps({'command':'timing'}).encode(); s.sendall(struct.pack('>II',len(h),0)+h); ln=struct.unpack('>I',s.recv(4))[0]; print(json.dumps(json.loads(s.recv(ln).decode()), indent=2))"

status:
	@sudo systemctl status robot-platform --no-pager
	@echo "---"
	@-sudo systemctl status inference-worker --no-pager
	@echo "---"
	@sudo systemctl status nginx --no-pager

compose-build:
	docker compose --env-file .env.server -f docker-compose.server.yml build

compose-up:
	docker compose --env-file .env.server -f docker-compose.server.yml up -d

compose-down:
	docker compose --env-file .env.server -f docker-compose.server.yml down

compose-logs:
	docker compose --env-file .env.server -f docker-compose.server.yml logs -f

compose-migrate:
	docker compose --env-file .env.server -f docker-compose.server.yml run --rm back uv run alembic -c back/alembic.ini upgrade head

compose-create-admin:
	docker compose --env-file .env.server -f docker-compose.server.yml run --rm back uv run python -m back.scripts.create_admin

update:
	git pull
	@if [ "$$(uname -m)" = "aarch64" ]; then \
		echo "Jetson detected (aarch64): uv sync --extra gstreamer"; \
		uv sync --extra gstreamer; \
	else \
		uv sync; \
	fi
	cd src/front && npm ci && npm run build
	-sudo systemctl restart inference-worker
	-sudo systemctl restart camera-worker
	-sudo systemctl restart recording-worker
	-sudo systemctl restart conversion-worker
	-sudo systemctl restart counting-worker
	-sudo systemctl restart classification-worker
	sudo systemctl restart robot-platform
