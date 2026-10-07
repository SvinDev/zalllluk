from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.spa import mount_spa

INDEX = "<!doctype html><title>УК Онлайн</title>"


@pytest.fixture
async def spa_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    (tmp_path / "index.html").write_text(INDEX, encoding="utf-8")
    (tmp_path / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path.parent / "secret.txt").write_text("nope", encoding="utf-8")

    app = FastAPI()

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_spa(app, tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http


async def test_api_routes_take_precedence(spa_client: AsyncClient) -> None:
    response = await spa_client.get("/api/health")
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/", "/login", "/tickets/42"])
async def test_client_routes_get_index(spa_client: AsyncClient, path: str) -> None:
    response = await spa_client.get(path)
    assert response.status_code == 200
    assert response.text == INDEX
    assert response.headers["cache-control"] == "no-cache"


async def test_unknown_api_path_stays_404(spa_client: AsyncClient) -> None:
    for path in ("/api/v1/nope", "/api"):
        response = await spa_client.get(path)
        assert response.status_code == 404
        assert response.headers["content-type"] == "application/json"


async def test_static_files(spa_client: AsyncClient) -> None:
    asset = await spa_client.get("/assets/app-abc123.js")
    assert asset.status_code == 200
    assert "immutable" in asset.headers["cache-control"]
    assert (await spa_client.get("/favicon.svg")).text == "<svg/>"
    assert (await spa_client.get("/assets/missing.js")).status_code == 404


async def test_no_path_traversal(spa_client: AsyncClient) -> None:
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"):
        response = await spa_client.get(path)
        assert "nope" not in response.text


def test_missing_build_is_reported(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match=r"index\.html"):
        mount_spa(FastAPI(), tmp_path)
