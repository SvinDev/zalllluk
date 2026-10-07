#!/usr/bin/env bash
# Запуск стека при каждом старте Codespace.
# Данные PostgreSQL лежат в Docker-томе и переживают остановку Codespace;
# пропадают только при удалении Codespace или по `make reset-data`.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Жду Docker..."
for _ in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
docker info >/dev/null 2>&1 || { echo "Docker не запустился" >&2; exit 1; }

docker compose up -d --build

echo "Жду API..."
for _ in $(seq 1 90); do
  curl -fsS http://localhost:8080/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://localhost:8080/api/health >/dev/null || {
  echo "API не ответил — смотрите: docker compose logs api" >&2
  exit 1
}

users="$(docker compose exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM users"')"
if [[ "${users//[[:space:]]/}" == "0" ]]; then
  echo "База пустая — загружаю демо-данные"
  docker compose --profile demo run --rm seed
fi

if [[ -n "${CODESPACE_NAME:-}" ]]; then
  url="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  url="http://localhost:8080"
fi
echo
echo "Готово: ${url}  (API: ${url}/api/docs)"
echo "Демо-доступы: admin@demo.ru / manager@demo.ru / buh@demo.ru / guard@demo.ru / resident@demo.ru, пароль demo12345"
