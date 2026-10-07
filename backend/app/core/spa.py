"""Раздача собранного фронтенда самим API — для развёртывания одним контейнером (PaaS).

В docker-compose эту роль выполняет nginx (frontend/nginx.conf); правила здесь те же:
/assets/* с хэшем в имени кэшируются навсегда, остальные пути отдают index.html,
а неизвестные пути под /api остаются JSON-ошибкой 404.
"""

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import Response
from starlette.staticfiles import StaticFiles


class _ImmutableFiles(StaticFiles):
    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def mount_spa(app: FastAPI, directory: Path) -> None:
    """Подключить SPA. Вызывать после регистрации всех маршрутов API."""
    root = directory.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"STATIC_DIR={directory}: не найден index.html собранного фронтенда")

    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.mount("/assets", _ImmutableFiles(directory=root / "assets", check_dir=False), "assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        file = (root / path).resolve()
        if path and file.is_file() and file.is_relative_to(root):
            return FileResponse(file)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
