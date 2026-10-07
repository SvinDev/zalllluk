import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_requires_real_secret() -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(environment="production", secret_key="change-me-to-a-long-random-string-at-least")
    settings = Settings(environment="production", secret_key="x" * 48)
    assert settings.environment == "production"


def test_cors_origins_from_comma_separated_string() -> None:
    settings = Settings(cors_origins="https://a.example, https://b.example")  # type: ignore[arg-type]
    assert settings.cors_origins == ["https://a.example", "https://b.example"]


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        # Формат PaaS (Railway, Render, Heroku) — подставляется драйвер asyncpg.
        (
            "postgresql://postgres:secret@postgres.railway.internal:5432/railway",
            "postgresql+asyncpg://postgres:secret@postgres.railway.internal:5432/railway",
        ),
        ("postgres://u:p@db/uk", "postgresql+asyncpg://u:p@db/uk"),
        # asyncpg не знает sslmode — переводим в ssl.
        ("postgres://u:p@db/uk?sslmode=require", "postgresql+asyncpg://u:p@db/uk?ssl=require"),
        # Пароль со спецсимволами не портится при пересборке URL.
        ("postgresql://u:p%40ss%2Fw@db/uk", "postgresql+asyncpg://u:p%40ss%2Fw@db/uk"),
        # Уже правильный URL и другие драйверы не трогаем.
        ("postgresql+asyncpg://uk:uk@db:5432/uk", "postgresql+asyncpg://uk:uk@db:5432/uk"),
        ("sqlite+aiosqlite:///x.db", "sqlite+aiosqlite:///x.db"),
    ],
)
def test_database_url_is_normalized_for_asyncpg(given: str, expected: str) -> None:
    assert Settings(database_url=given).database_url == expected


def test_unknown_timezone_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(timezone="Mars/Olympus")
