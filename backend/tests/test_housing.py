from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.users.models import User
from tests.factories import auth, make_apartment, make_building


async def test_building_and_apartment_crud(client: AsyncClient, manager: User) -> None:
    headers = auth(manager)
    building = await client.post(
        "/api/v1/buildings",
        json={"address": "г. Казань, ул. Баумана, д. 10", "floors": 9, "entrances": 4},
        headers=headers,
    )
    assert building.status_code == 201, building.text
    building_id = building.json()["id"]

    apartment = await client.post(
        "/api/v1/apartments",
        json={
            "building_id": building_id,
            "number": "15",
            "account_number": "1000015",
            "area": "54.30",
            "residents_count": 3,
        },
        headers=headers,
    )
    assert apartment.status_code == 201, apartment.text
    assert apartment.json()["building"]["address"] == "г. Казань, ул. Баумана, д. 10"
    assert apartment.json()["area"] == "54.30"

    detail = await client.get(f"/api/v1/buildings/{building_id}", headers=headers)
    assert detail.json()["apartments_count"] == 1

    updated = await client.patch(
        f"/api/v1/apartments/{apartment.json()['id']}",
        json={"residents_count": 4},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["residents_count"] == 4

    # Дом с помещениями удалить нельзя.
    delete = await client.delete(f"/api/v1/buildings/{building_id}", headers=headers)
    assert delete.status_code == 409


async def test_apartment_uniqueness(
    client: AsyncClient, session: AsyncSession, manager: User
) -> None:
    existing = await make_apartment(session, number="7", account_number="ACC-7")
    same_number = await client.post(
        "/api/v1/apartments",
        json={
            "building_id": existing.building_id,
            "number": "7",
            "account_number": "ACC-8",
            "area": "40",
        },
        headers=auth(manager),
    )
    assert same_number.status_code == 409

    same_account = await client.post(
        "/api/v1/apartments",
        json={
            "building_id": existing.building_id,
            "number": "8",
            "account_number": "ACC-7",
            "area": "40",
        },
        headers=auth(manager),
    )
    assert same_account.status_code == 409


async def test_resident_sees_only_own_apartments(
    client: AsyncClient, session: AsyncSession, resident: User
) -> None:
    own = await make_apartment(session, residents=[resident])
    foreign = await make_apartment(session)

    listing = await client.get("/api/v1/apartments", headers=auth(resident))
    assert [a["id"] for a in listing.json()["items"]] == [own.id]

    buildings = await client.get("/api/v1/buildings", headers=auth(resident))
    assert [b["id"] for b in buildings.json()["items"]] == [own.building_id]

    hidden = await client.get(f"/api/v1/apartments/{foreign.id}", headers=auth(resident))
    assert hidden.status_code == 404

    forbidden = await client.patch(
        f"/api/v1/apartments/{own.id}", json={"area": "1"}, headers=auth(resident)
    )
    assert forbidden.status_code == 403


async def test_link_and_unlink_resident(
    client: AsyncClient, session: AsyncSession, manager: User, resident: User
) -> None:
    building = await make_building(session)
    apartment = await make_apartment(session, building)
    url = f"/api/v1/apartments/{apartment.id}/residents"

    linked = await client.post(url, json={"user_id": resident.id}, headers=auth(manager))
    assert linked.status_code == 200
    assert [r["id"] for r in linked.json()["residents"]] == [resident.id]

    # Повторная привязка идемпотентна.
    again = await client.post(url, json={"user_id": resident.id}, headers=auth(manager))
    assert len(again.json()["residents"]) == 1

    staff = await client.post(url, json={"user_id": manager.id}, headers=auth(manager))
    assert staff.status_code == 422

    unlinked = await client.delete(f"{url}/{resident.id}", headers=auth(manager))
    assert unlinked.json()["residents"] == []


async def test_apartments_search(client: AsyncClient, session: AsyncSession, manager: User) -> None:
    building = await make_building(session, address="г. Тверь, пр. Победы, д. 3")
    await make_apartment(session, building, owner_name="Иванова Анна")
    await make_apartment(session)
    response = await client.get(
        "/api/v1/apartments", params={"search": "Тверь"}, headers=auth(manager)
    )
    assert response.json()["total"] == 1
    by_owner = await client.get(
        "/api/v1/apartments", params={"search": "иванова"}, headers=auth(manager)
    )
    assert by_owner.json()["items"][0]["owner_name"] == "Иванова Анна"
