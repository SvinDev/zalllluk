from datetime import UTC, datetime, timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.users.models import User
from tests.factories import auth, make_apartment, make_building, make_meter, make_reading


async def test_announcements_visibility(
    client: AsyncClient, session: AsyncSession, manager: User, resident: User
) -> None:
    own = await make_apartment(session, residents=[resident])
    other_building = await make_building(session)

    async def publish(**payload: object) -> dict:  # type: ignore[type-arg]
        response = await client.post(
            "/api/v1/announcements",
            json={"title": "Объявление", "body": "Текст", **payload},
            headers=auth(manager),
        )
        assert response.status_code == 201, response.text
        return response.json()  # type: ignore[no-any-return]

    everyone = await publish(title="Для всех")
    mine = await publish(title="Отключение воды", building_id=own.building_id, is_pinned=True)
    await publish(title="Чужой дом", building_id=other_building.id)
    await publish(
        title="Запланировано", published_at=(datetime.now(UTC) + timedelta(days=1)).isoformat()
    )

    resident_view = await client.get("/api/v1/announcements", headers=auth(resident))
    titles = [a["title"] for a in resident_view.json()["items"]]
    assert titles == [mine["title"], everyone["title"]]  # закреплённое — первым

    staff_view = await client.get("/api/v1/announcements", headers=auth(manager))
    assert staff_view.json()["total"] >= 4

    forbidden = await client.post(
        "/api/v1/announcements", json={"title": "x", "body": "y"}, headers=auth(resident)
    )
    assert forbidden.status_code == 403

    updated = await client.patch(
        f"/api/v1/announcements/{everyone['id']}",
        json={"is_pinned": True},
        headers=auth(manager),
    )
    assert updated.json()["is_pinned"] is True
    deleted = await client.delete(f"/api/v1/announcements/{everyone['id']}", headers=auth(manager))
    assert deleted.status_code == 204


async def test_dashboard(
    client: AsyncClient, session: AsyncSession, manager: User, resident: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    meter = await make_meter(session, apartment)
    await make_reading(session, meter, "5", datetime.now(UTC) - timedelta(minutes=1))
    await client.post(
        "/api/v1/tickets",
        json={
            "apartment_id": apartment.id,
            "category": "elevator",
            "priority": "emergency",
            "subject": "Застрял лифт",
            "description": "Второй подъезд",
        },
        headers=auth(resident),
    )

    response = await client.get("/api/v1/dashboard", headers=auth(manager))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["apartments"] >= 1
    assert data["tickets"]["emergency"] >= 1
    assert data["tickets"]["by_category"]["elevator"] >= 1
    assert data["readings"]["meters_with_readings"] >= 1
    assert len(data["billing"]["history"]) == 6
    assert Decimal(data["billing"]["total_debt"]) >= 0

    forbidden = await client.get("/api/v1/dashboard", headers=auth(resident))
    assert forbidden.status_code == 403
