.PHONY: start

start:
	uv run uvicorn back.main:app --host 0.0.0.0 --port 8080 --reload
