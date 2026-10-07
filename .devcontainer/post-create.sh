#!/usr/bin/env bash
# Однократная подготовка Codespace.
set -euo pipefail
cd "$(dirname "$0")/.."

bash .devcontainer/ensure-env.sh

# uv — для тестов и разработки бэкенда (make install / make test); стеку в Docker не нужен,
# поэтому сбой установки не должен ломать создание Codespace.
if ! command -v uv >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/uv" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh \
    || echo "uv не установился — нужен только для make test, стек работает и без него" >&2
fi
