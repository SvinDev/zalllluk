# Образ «всё в одном» для PaaS (Railway и аналоги): API сам отдаёт собранный фронтенд,
# снаружи нужны только PostgreSQL (DATABASE_URL) и SECRET_KEY.
# Для своего сервера удобнее docker-compose.yml: отдельные nginx, API и PostgreSQL.
# Python-часть повторяет backend/Dockerfile — меняйте их вместе. Без cache-mount'ов:
# Railway принимает их только с id своего сервиса.

FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_CACHE=1

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /bin/uv

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY backend/scripts/predeploy.sh ./predeploy.sh
RUN uv sync --frozen --no-dev

COPY --from=web /web/dist ./static

RUN useradd --system --uid 10001 --no-create-home app
USER app

ENV PATH="/app/.venv/bin:$PATH" \
    ENVIRONMENT=production \
    STATIC_DIR=/app/static \
    PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=3)"

# PORT задаёт платформа. Shell-форма нужна для подстановки, exec — чтобы uvicorn
# получал сигналы остановки напрямую.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\" --proxy-headers --forwarded-allow-ips '*'"]
