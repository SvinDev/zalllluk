from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.meters.models import MeterKind
from app.users.models import User
from tests.factories import auth, make_apartment, make_meter, make_reading


def ts(day: int, month: int = 9, year: int = 2026) -> datetime:
    return datetime(year, month, day, 12, tzinfo=UTC)


async def test_register_meter(client: AsyncClient, session: AsyncSession, manager: User) -> None:
    apartment = await make_apartment(session)
    payload = {
        "apartment_id": apartment.id,
        "kind": "hot_water",
        "serial_number": "HW-0001",
        "verification_due": "2030-01-01",
        "initial_value": "10.5",
    }
    created = await client.post("/api/v1/meters", json=payload, headers=auth(manager))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["unit"] == "м³"
    assert body["apartment"]["account_number"] == apartment.account_number
    assert body["last_reading"] is None

    duplicate = await client.post("/api/v1/meters", json=payload, headers=auth(manager))
    assert duplicate.status_code == 409


async def test_resident_submits_reading_and_validation(
    client: AsyncClient, session: AsyncSession, resident: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    meter = await make_meter(session, apartment, initial_value=100)
    url = f"/api/v1/meters/{meter.id}/readings"

    below_initial = await client.post(url, json={"value": "99"}, headers=auth(resident))
    assert below_initial.status_code == 422

    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    in_future = await client.post(
        url, json={"value": "120", "taken_at": future}, headers=auth(resident)
    )
    assert in_future.status_code == 422

    ok = await client.post(url, json={"value": "105.250"}, headers=auth(resident))
    assert ok.status_code == 201, ok.text
    assert ok.json()["source"] == "resident"

    decreasing = await client.post(url, json={"value": "105"}, headers=auth(resident))
    assert decreasing.status_code == 422
    assert "меньше предыдущего" in decreasing.json()["detail"]

    meter_view = await client.get(f"/api/v1/meters/{meter.id}", headers=auth(resident))
    assert meter_view.json()["last_reading"]["value"] == "105.250"


async def test_backdated_reading_must_fit_between_neighbours(
    client: AsyncClient, session: AsyncSession, manager: User
) -> None:
    meter = await make_meter(session)
    await make_reading(session, meter, "10", ts(1))
    await make_reading(session, meter, "20", ts(20))
    url = f"/api/v1/meters/{meter.id}/readings"

    too_big = await client.post(
        url, json={"value": "25", "taken_at": ts(10).isoformat()}, headers=auth(manager)
    )
    assert too_big.status_code == 422
    fits = await client.post(
        url, json={"value": "15", "taken_at": ts(10).isoformat()}, headers=auth(manager)
    )
    assert fits.status_code == 201
    assert fits.json()["source"] == "staff"


async def test_inactive_meter_rejects_readings(
    client: AsyncClient, session: AsyncSession, manager: User
) -> None:
    meter = await make_meter(session, is_active=False)
    response = await client.post(
        f"/api/v1/meters/{meter.id}/readings", json={"value": "1"}, headers=auth(manager)
    )
    assert response.status_code == 422


async def test_resident_cannot_touch_foreign_meter(
    client: AsyncClient, session: AsyncSession, resident: User
) -> None:
    foreign = await make_meter(session)
    response = await client.post(
        f"/api/v1/meters/{foreign.id}/readings", json={"value": "1"}, headers=auth(resident)
    )
    assert response.status_code == 404
    listing = await client.get("/api/v1/meters", headers=auth(resident))
    assert listing.json()["items"] == []


async def test_readings_history_has_consumption(
    client: AsyncClient, session: AsyncSession, manager: User
) -> None:
    meter = await make_meter(session, initial_value=5)
    await make_reading(session, meter, "10", ts(1))
    await make_reading(session, meter, "17.5", ts(2))

    history = await client.get(f"/api/v1/meters/{meter.id}/readings", headers=auth(manager))
    items = history.json()["items"]
    assert [(i["value"], i["consumption"]) for i in items] == [
        ("17.500", "7.500"),
        ("10.000", "5.000"),
    ]

    # В журнале с фильтром по дате расход первого показания в окне не теряется.
    journal = await client.get(
        "/api/v1/readings",
        params={"date_from": "2026-09-02", "date_to": "2026-09-02"},
        headers=auth(manager),
    )
    assert [(i["value"], i["consumption"]) for i in journal.json()["items"]] == [
        ("17.500", "7.500")
    ]


async def test_meter_filters(client: AsyncClient, session: AsyncSession, manager: User) -> None:
    apartment = await make_apartment(session)
    stale = await make_meter(session, apartment, MeterKind.COLD_WATER)
    fresh = await make_meter(
        session, apartment, MeterKind.ELECTRICITY, verification_due=date(2026, 12, 1)
    )
    await make_reading(session, stale, "1", ts(1, month=8))
    await make_reading(session, fresh, "1", ts(5))

    no_readings = await client.get(
        "/api/v1/meters",
        params={"apartment_id": apartment.id, "no_reading_since": "2026-09-01"},
        headers=auth(manager),
    )
    assert [m["id"] for m in no_readings.json()["items"]] == [stale.id]

    due = await client.get(
        "/api/v1/meters",
        params={"apartment_id": apartment.id, "verification_due_before": "2027-01-01"},
        headers=auth(manager),
    )
    assert [m["id"] for m in due.json()["items"]] == [fresh.id]


async def test_meter_with_readings_cannot_be_deleted(
    client: AsyncClient, session: AsyncSession, manager: User
) -> None:
    meter = await make_meter(session)
    await make_reading(session, meter, "1", ts(1))
    response = await client.delete(f"/api/v1/meters/{meter.id}", headers=auth(manager))
    assert response.status_code == 409

    empty = await make_meter(session)
    response = await client.delete(f"/api/v1/meters/{empty.id}", headers=auth(manager))
    assert response.status_code == 204
