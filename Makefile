.PHONY: help install dev-api dev-web test lint format migrate migration seed openapi up down logs

help:  ## Список команд
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install:  ## Установить зависимости бэкенда и фронтенда
	cd backend && uv sync
	cd frontend && npm ci

dev-api:  ## API с автоперезагрузкой на :8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

dev-web:  ## Фронтенд (Vite) на :5173, /api проксируется на :8000
	cd frontend && npm run dev

test:  ## Все тесты
	cd backend && uv run pytest -q
	cd frontend && npm test

lint:  ## Линтеры и проверка типов
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
	cd frontend && npm run lint && npm run typecheck

format:  ## Автоформатирование бэкенда
	cd backend && uv run ruff check --fix . && uv run ruff format .

migrate:  ## Применить миграции
	cd backend && uv run alembic upgrade head

migration:  ## Создать миграцию: make migration m="описание"
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

seed:  ## Заполнить пустую БД демо-данными
	cd backend && uv run python -m app.cli seed-demo

openapi:  ## Обновить OpenAPI-схему и TS-типы фронтенда
	cd backend && uv run python -m app.cli openapi > ../frontend/openapi.json
	cd frontend && npm run gen:api

up:  ## Поднять всё в Docker (http://localhost:8080)
	docker compose up -d --build

down:  ## Остановить Docker-окружение
	docker compose down

logs:  ## Логи Docker-окружения
	docker compose logs -f api web
