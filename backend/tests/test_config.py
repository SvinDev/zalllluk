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


def test_unknown_timezone_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(timezone="Mars/Olympus")
