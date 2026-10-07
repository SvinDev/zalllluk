#!/usr/bin/env bash
# Создаёт .env из .env.example с собственным SECRET_KEY или чинит .env,
# в котором остался ключ-заглушка (с ним API в production не стартует).
# Идемпотентен: существующий рабочий .env не трогает.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]] && ! grep -q '^SECRET_KEY=change-me' .env; then
  exit 0
fi

[[ -f .env ]] || cp .env.example .env
# Без python: в базовом образе Codespace его нет.
secret="$(head -c 48 /dev/urandom | base64 -w0 | tr '+/' '-_' | tr -d '=')"
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${secret}|" .env
echo "В .env записан собственный SECRET_KEY"
