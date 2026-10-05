from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.passes.plates import normalize_plate
from app.users.models import User
from tests.factories import auth, make_apartment


def iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def test_plate_normalization() -> None:
    # Латиница, кириллица и пробелы дают один и тот же номер.
    assert normalize_plate("a 123 bc 77") == normalize_plate("А123ВС77") == "А123ВС77"
    assert normalize_plate("x-001-xx-199") == "Х001ХХ199"


async def test_guest_pass_is_auto_approved_and_used_once(
    client: AsyncClient, session: AsyncSession, resident: User, guard: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    created = await client.post(
        "/api/v1/passes",
        json={"apartment_id": apartment.id, "visitor_name": "Иван Петров"},
        headers=auth(resident),
    )
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["status"] == "active"
    assert len(item["code"]) == 6

    check = await client.get(
        "/api/v1/passes/check", params={"code": item["code"].lower()}, headers=auth(guard)
    )
    assert check.status_code == 200
    assert [(r["id"], r["valid_now"]) for r in check.json()] == [(item["id"], True)]

    visit = await client.post(
        f"/api/v1/passes/{item['id']}/visits", json={"note": "Проход"}, headers=auth(guard)
    )
    assert visit.status_code == 201
    assert visit.json()["status"] == "used"
    assert visit.json()["visits"][0]["checked_by"]["id"] == guard.id

    again = await client.post(f"/api/v1/passes/{item['id']}/visits", json={}, headers=auth(guard))
    assert again.status_code == 422
    assert again.json()["detail"] == "Разовый пропуск уже использован"


async def test_long_vehicle_pass_needs_approval(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User, guard: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    created = await client.post(
        "/api/v1/passes",
        json={
            "apartment_id": apartment.id,
            "kind": "vehicle",
            "vehicle_plate": "a777aa 77",
            "valid_until": iso(timedelta(days=30)),
            "is_one_time": False,
        },
        headers=auth(resident),
    )
    item = created.json()
    assert (item["status"], item["vehicle_plate"]) == ("pending", "А777АА77")

    by_plate = await client.get(
        "/api/v1/passes/check", params={"plate": "А 777 АА 77"}, headers=auth(guard)
    )
    result = by_plate.json()[0]
    assert (result["valid_now"], result["reason"]) == (False, "Пропуск ещё не согласован УК")

    approved = await client.post(f"/api/v1/passes/{item['id']}/approve", headers=auth(manager))
    assert approved.json()["status"] == "active"

    # Многоразовый пропуск остаётся активным после въездов.
    for _ in range(2):
        visit = await client.post(
            f"/api/v1/passes/{item['id']}/visits", json={}, headers=auth(guard)
        )
        assert visit.json()["status"] == "active"
    assert len(visit.json()["visits"]) == 2


async def test_pass_validation(client: AsyncClient, session: AsyncSession, resident: User) -> None:
    apartment = await make_apartment(session, residents=[resident])
    no_plate = await client.post(
        "/api/v1/passes",
        json={"apartment_id": apartment.id, "kind": "vehicle"},
        headers=auth(resident),
    )
    assert no_plate.status_code == 422

    past = await client.post(
        "/api/v1/passes",
        json={
            "apartment_id": apartment.id,
            "valid_from": iso(-timedelta(days=2)),
            "valid_until": iso(-timedelta(days=1)),
        },
        headers=auth(resident),
    )
    assert past.status_code == 422

    too_long = await client.post(
        "/api/v1/passes",
        json={"apartment_id": apartment.id, "valid_until": iso(timedelta(days=400))},
        headers=auth(resident),
    )
    assert too_long.status_code == 422

    foreign = await make_apartment(session)
    other = await client.post(
        "/api/v1/passes", json={"apartment_id": foreign.id}, headers=auth(resident)
    )
    assert other.status_code == 404


async def test_future_pass_is_not_valid_yet(
    client: AsyncClient, session: AsyncSession, resident: User, guard: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    item = (
        await client.post(
            "/api/v1/passes",
            json={
                "apartment_id": apartment.id,
                "valid_from": iso(timedelta(hours=5)),
                "valid_until": iso(timedelta(hours=8)),
            },
            headers=auth(resident),
        )
    ).json()
    assert item["status"] == "active"
    visit = await client.post(f"/api/v1/passes/{item['id']}/visits", json={}, headers=auth(guard))
    assert visit.status_code == 422
    assert visit.json()["detail"].startswith("Пропуск действует с")


async def test_cancel_and_reject(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    guest = (
        await client.post(
            "/api/v1/passes", json={"apartment_id": apartment.id}, headers=auth(resident)
        )
    ).json()
    cancelled = await client.post(f"/api/v1/passes/{guest['id']}/cancel", headers=auth(resident))
    assert cancelled.json()["status"] == "cancelled"

    by_staff = (
        await client.post(
            "/api/v1/passes",
            json={"apartment_id": apartment.id, "valid_until": iso(timedelta(days=60))},
            headers=auth(manager),
        )
    ).json()
    assert by_staff["status"] == "active"
    not_own = await client.post(f"/api/v1/passes/{by_staff['id']}/cancel", headers=auth(resident))
    assert not_own.status_code == 403

    pending = (
        await client.post(
            "/api/v1/passes",
            json={"apartment_id": apartment.id, "valid_until": iso(timedelta(days=3))},
            headers=auth(resident),
        )
    ).json()
    rejected = await client.post(
        f"/api/v1/passes/{pending['id']}/reject",
        json={"reason": "Нет мест на парковке"},
        headers=auth(manager),
    )
    assert (rejected.json()["status"], rejected.json()["reject_reason"]) == (
        "rejected",
        "Нет мест на парковке",
    )


async def test_resident_cannot_use_guard_endpoints(client: AsyncClient, resident: User) -> None:
    response = await client.get(
        "/api/v1/passes/check", params={"code": "ABC123"}, headers=auth(resident)
    )
    assert response.status_code == 403


async def test_passes_list_scoping(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    own = await make_apartment(session, residents=[resident])
    foreign = await make_apartment(session)
    await client.post("/api/v1/passes", json={"apartment_id": own.id}, headers=auth(resident))
    await client.post("/api/v1/passes", json={"apartment_id": foreign.id}, headers=auth(manager))

    mine = await client.get("/api/v1/passes", headers=auth(resident))
    assert {p["apartment"]["id"] for p in mine.json()["items"]} == {own.id}
    active = await client.get("/api/v1/passes", params={"active_now": True}, headers=auth(manager))
    assert active.json()["total"] >= 2
