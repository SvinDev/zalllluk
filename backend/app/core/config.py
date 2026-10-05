from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_DEFAULT_SECRET = "insecure-dev-secret-key-change-me-0123456789"


class CompanySettings(BaseSettings):
    """Реквизиты УК — попадают в платёжки и QR-код для оплаты."""

    model_config = SettingsConfigDict(env_prefix="COMPANY_", env_file=".env", extra="ignore")

    name: str = 'ООО "Управляющая компания"'
    inn: str = "0000000000"
    kpp: str = "000000000"
    bank_name: str = 'ПАО "Банк"'
    bik: str = "000000000"
    bank_account: str = "00000000000000000000"
    corr_account: str = "00000000000000000000"
    address: str = ""
    phone: str = ""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "УК Онлайн"
    environment: Literal["local", "test", "production"] = "local"

    database_url: str = "postgresql+asyncpg://uk:uk@localhost:5432/uk"
    database_echo: bool = False

    secret_key: str = _DEFAULT_SECRET
    access_token_ttl_minutes: int = 60 * 12

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    # Фоновый опрос внешних систем учёта (АСКУЭ, IoT-шлюзы).
    meter_sync_enabled: bool = True
    meter_sync_interval_minutes: int = 30
    meter_sync_timeout_seconds: float = 30.0

    company: CompanySettings = Field(default_factory=CompanySettings)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("secret_key")
    @classmethod
    def _secret_key_length(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError("SECRET_KEY должен быть не короче 32 символов")
        return value

    @model_validator(mode="after")
    def _production_guard(self) -> "Settings":
        if self.environment == "production" and self.secret_key == _DEFAULT_SECRET:
            raise ValueError("В production необходимо задать собственный SECRET_KEY")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
