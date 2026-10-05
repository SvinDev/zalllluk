import json
from datetime import UTC, datetime

import httpx
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.models import MeterDataSource, ProviderKind
from app.integrations.scheduler import sync_all_sources
from app.integrations.service import sync_source
from app.meters.models import MeterReading, ReadingSource
from app.users.models import User
from tests.factories import auth, make_meter


async def _issue_key(client: AsyncClient, admin: User) -> str:
    response = await client.post(
        "/api/v1/integrations/api-keys", json={"name": "АСКУЭ"}, headers=auth(admin)
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["key"].startswith(f"ukapi_{body['prefix']}_")
    return str(body["key"])


async def test_push_ingest_with_api_key(
    client: AsyncClient, session: AsyncSession, admin: User
) -> None:
    meter = await make_meter(session, external_id="dev-42")
    other = await make_meter(session, serial_number="E-777")
    key = await _issue_key(client, admin)
    payload = {
        "readings": [
            # Порядок в пакете не важен — обрабатываем хронологически.
            {"external_id": "dev-42", "value": "12", "taken_at": "2026-09-02T00:00:00Z"},
            {"external_id": "dev-42", "value": "10", "taken_at": "2026-09-01T00:00:00Z"},
            {"serial_number": "E-777", "value": "5", "taken_at": "2026-09-01T00:00:00+03:00"},
            {"serial_number": "unknown", "value": "1", "taken_at": "2026-09-01T00:00:00Z"},
            {"external_id": "dev-42", "value": "1", "taken_at": "2026-09-03T00:00:00Z"},
        ]
    }
    response = await client.post(
        "/api/v1/integrations/readings", json=payload, headers={"X-API-Key": key}
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["received"] == 5
    assert report["accepted"] == 3
    assert report["duplicates"] == 0
    assert [(r["index"], r["error"]) for r in report["rejected"]] == [
        (3, "Счётчик не найден"),
        (4, "Показание 1 меньше предыдущего (12.000)"),
    ]

    # Повтор того же пакета — идемпотентен.
    retry = await client.post(
        "/api/v1/integrations/readings", json=payload, headers={"X-API-Key": key}
    )
    assert retry.json()["accepted"] == 0
    assert retry.json()["duplicates"] == 3

    stored = await session.scalars(
        select(MeterReading.source).where(MeterReading.meter_id.in_([meter.id, other.id]))
    )
    assert set(stored) == {ReadingSource.API}


async def test_ingest_rejects_missing_or_revoked_key(client: AsyncClient, admin: User) -> None:
    payload = {
        "readings": [{"serial_number": "x", "value": "1", "taken_at": "2026-09-01T00:00:00Z"}]
    }
    missing = await client.post("/api/v1/integrations/readings", json=payload)
    assert missing.status_code == 401

    key = await _issue_key(client, admin)
    keys = await client.get("/api/v1/integrations/api-keys", headers=auth(admin))
    key_id = keys.json()[0]["id"]
    assert "key" not in keys.json()[0]
    await client.post(f"/api/v1/integrations/api-keys/{key_id}/revoke", headers=auth(admin))

    revoked = await client.post(
        "/api/v1/integrations/readings", json=payload, headers={"X-API-Key": key}
    )
    assert revoked.status_code == 401


async def test_ingest_validates_payload(client: AsyncClient, admin: User) -> None:
    key = await _issue_key(client, admin)
    no_ref = {"readings": [{"value": "1", "taken_at": "2026-09-01T00:00:00Z"}]}
    response = await client.post(
        "/api/v1/integrations/readings", json=no_ref, headers={"X-API-Key": key}
    )
    assert response.status_code == 422

    naive = {"readings": [{"serial_number": "x", "value": "1", "taken_at": "2026-09-01T00:00:00"}]}
    response = await client.post(
        "/api/v1/integrations/readings", json=naive, headers={"X-API-Key": key}
    )
    assert response.status_code == 422


async def test_integrations_admin_only(client: AsyncClient, manager: User) -> None:
    response = await client.get("/api/v1/integrations/sources", headers=auth(manager))
    assert response.status_code == 403


async def test_pull_sync_moves_cursor(session: AsyncSession) -> None:
    meter = await make_meter(session, serial_number="PULL-1")
    source = MeterDataSource(
        name="IoT", kind=ProviderKind.HTTP_JSON, url="https://iot.example/api", auth_token="t0k"
    )
    session.add(source)
    await session.flush()

    seen_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append(request)
        readings = [
            {"serial_number": "PULL-1", "value": "3.5", "taken_at": "2026-09-01T10:00:00Z"},
            {"serial_number": "PULL-1", "value": "4.0", "taken_at": "2026-09-02T10:00:00Z"},
        ]
        return httpx.Response(200, content=json.dumps({"readings": readings}))

    result = await sync_source(
        session, source, request_timeout=5, transport=httpx.MockTransport(handler)
    )
    assert result.status == "ok"
    assert result.report is not None and result.report.accepted == 2
    assert source.cursor == datetime(2026, 9, 2, 10, tzinfo=UTC)
    assert seen_requests[0].headers["Authorization"] == "Bearer t0k"
    assert "since" not in seen_requests[0].url.params

    # Второй опрос идёт с курсором; повторные записи — дубли, не ошибки.
    again = await sync_source(
        session, source, request_timeout=5, transport=httpx.MockTransport(handler)
    )
    assert seen_requests[1].url.params["since"] == "2026-09-02T10:00:00+00:00"
    assert again.report is not None and again.report.duplicates == 2

    values = await session.scalars(
        select(MeterReading.value).where(MeterReading.meter_id == meter.id)
    )
    assert len(list(values)) == 2


async def test_pull_sync_records_errors(session: AsyncSession) -> None:
    source = MeterDataSource(name="Down", kind=ProviderKind.HTTP_JSON, url="https://down.example")
    session.add(source)
    await session.flush()

    result = await sync_source(
        session,
        source,
        request_timeout=5,
        transport=httpx.MockTransport(lambda _: httpx.Response(503)),
    )
    assert result.status == "error"
    assert source.last_status == "error"
    assert source.last_error == "Источник ответил HTTP 503"

    garbage = await sync_source(
        session,
        source,
        request_timeout=5,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"{}")),
    )
    assert garbage.status == "error"
    assert garbage.error is not None and "Неверный формат" in garbage.error


async def test_source_crud_hides_token(client: AsyncClient, admin: User) -> None:
    created = await client.post(
        "/api/v1/integrations/sources",
        json={"name": "АСКУЭ", "url": "https://askue.example/readings", "auth_token": "secret"},
        headers=auth(admin),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["has_token"] is True
    assert "auth_token" not in body


async def test_scheduler_iteration_runs_under_advisory_lock() -> None:
    # Источники созданы внутри откатываемых транзакций других тестов и здесь не видны,
    # поэтому проверяем сам цикл: взятие/снятие advisory-lock и обход пустого списка.
    await sync_all_sources()
    await sync_all_sources()
