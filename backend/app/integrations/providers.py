"""Коннекторы к внешним системам учёта показаний.

Новый поставщик (конкретная АСКУЭ, IoT-платформа) добавляется классом,
реализующим MeterReadingsProvider, и регистрацией в PROVIDERS.
"""

from datetime import datetime
from typing import Protocol

import httpx
from pydantic import BaseModel, ValidationError

from app.integrations.models import MeterDataSource, ProviderKind
from app.meters.schemas import ExternalReading


class ProviderError(Exception):
    pass


class MeterReadingsProvider(Protocol):
    async def fetch(self, since: datetime | None) -> list[ExternalReading]: ...


class _HttpJsonPayload(BaseModel):
    readings: list[ExternalReading]


class HttpJsonProvider:
    """Универсальный JSON-коннектор.

    Запрос:  GET {url}?since=<ISO-8601>  (since отсутствует при первой выгрузке)
             Authorization: Bearer <token>  (если токен задан)
    Ответ:   {"readings": [{"serial_number": "...", "external_id": "...",
                            "value": "123.456", "taken_at": "2026-01-31T12:00:00+03:00"}]}
    """

    def __init__(
        self,
        url: str,
        token: str | None,
        *,
        timeout: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._url = url
        self._token = token
        self._timeout = timeout
        self._transport = transport

    async def fetch(self, since: datetime | None) -> list[ExternalReading]:
        headers = {"Accept": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        params = {"since": since.isoformat()} if since else {}
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.get(self._url, params=params, headers=headers)
                response.raise_for_status()
                return _HttpJsonPayload.model_validate_json(response.content).readings
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"Источник ответил HTTP {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Ошибка соединения с источником: {exc}") from exc
        except ValidationError as exc:
            raise ProviderError(
                f"Неверный формат ответа источника: {exc.error_count()} ошибок"
            ) from exc


def build_provider(
    source: MeterDataSource,
    *,
    timeout: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> MeterReadingsProvider:
    if source.kind == ProviderKind.HTTP_JSON:
        return HttpJsonProvider(source.url, source.auth_token, timeout=timeout, transport=transport)
    raise ProviderError(f"Неизвестный тип источника: {source.kind}")
