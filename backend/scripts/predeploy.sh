#!/bin/sh
# Шаг перед запуском новой версии на PaaS (Railway preDeployCommand и аналоги):
# миграции, а при SEED_DEMO=true — демо-данные, если база ещё пустая.
set -eu

alembic upgrade head

if [ "${SEED_DEMO:-false}" = "true" ]; then
  python -m app.cli seed-demo --if-empty
fi
