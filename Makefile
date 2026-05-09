.PHONY: start run-robot run-server run-front run-inference run-conversion logs-conversion db-up db-down db-migrate build-front deploy-robot deploy-server restart logs logs-inference status update create-admin

start:
	uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-robot:
	ENV_FILE=.env.robot uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload

run-server:
	docker compose -f docker-compose.server.yml up -d
	ENV_FILE=.env.server uv run uvicorn back.main:app --host 0.0.0.0 --port 9090 --reload

run-inference:
	cd inference && VIRTUAL_ENV= .venv/bin/inference-worker

run-inference-dev:
	cd inference && uv run inference-worker

run-camera:
	cd camera_worker && uv run camera-worker

logs-camera:
	sudo journalctl -u camera-worker -f

run-recording:
	cd recording_worker && uv run recording-worker

logs-recording:
	sudo journalctl -u recording-worker -f

run-conversion:
	cd conversion_worker && uv run conversion-worker --control-socket /tmp/conversion.sock

logs-conversion:
	sudo journalctl -u conversion-worker -f

create-admin:
	ENV_FILE=.env.server uv run python -m back.scripts.create_admin

db-up:
	docker compose -f docker-compose.server.yml up -d

db-down:
	docker compose -f docker-compose.server.yml down

db-migrate:
	ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head

run-front:
	cd front && ENV_FILE=$(or $(ENV_FILE),.env.robot) npm run dev

run-front-server:
	cd front && ENV_FILE=.env.server npm run dev -- --port 5174

build-front:
	cd front && npm ci && npm run build

deploy-robot:
	./deploy/install.sh robot

deploy-server:
	./deploy/install.sh server

restart:
	-sudo systemctl restart inference-worker
	-sudo systemctl restart camera-worker
	-sudo systemctl restart recording-worker
	-sudo systemctl restart conversion-worker
	sudo systemctl restart robot-platform

logs:
	sudo journalctl -u robot-platform -f

logs-inference:
	sudo journalctl -u inference-worker -f

bench-inference:
	@cd inference && uv run python -c "import socket, json, struct, sys; s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.connect('/tmp/inference.sock'); h=json.dumps({'command':'timing'}).encode(); s.sendall(struct.pack('>II',len(h),0)+h); ln=struct.unpack('>I',s.recv(4))[0]; print(json.dumps(json.loads(s.recv(ln).decode()), indent=2))"

status:
	@sudo systemctl status robot-platform --no-pager
	@echo "---"
	@-sudo systemctl status inference-worker --no-pager
	@echo "---"
	@sudo systemctl status nginx --no-pager

update:
	git pull
	@if [ "$$(uname -m)" = "aarch64" ]; then \
		echo "Jetson detected (aarch64): uv sync --extra gstreamer"; \
		uv sync --extra gstreamer; \
	else \
		uv sync; \
	fi
	cd front && npm ci && npm run build
	-sudo systemctl restart inference-worker
	-sudo systemctl restart camera-worker
	-sudo systemctl restart recording-worker
	-sudo systemctl restart conversion-worker
	sudo systemctl restart robot-platform
