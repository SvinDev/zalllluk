#!/usr/bin/env bash
# Однократная подготовка Codespace.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${secret}|" .env
  echo "Создан .env с собственным SECRET_KEY"
fi

# uv — для тестов и разработки бэкенда (make install / make test); стеку в Docker не нужен.
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
