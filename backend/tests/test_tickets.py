from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.users.models import User
from tests.factories import auth, make_apartment, make_building


async def _create(client: AsyncClient, user: User, apartment_id: int, **extra: object) -> dict:  # type: ignore[type-arg]
    payload = {
        "apartment_id": apartment_id,
        "category": "plumbing",
        "subject": "Течёт кран на кухне",
        "description": "Капает уже второй день",
        **extra,
    }
    response = await client.post("/api/v1/tickets", json=payload, headers=auth(user))
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


async def test_ticket_lifecycle(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    ticket = await _create(client, resident, apartment.id, priority="emergency")
    assert ticket["status"] == "new"
    assert ticket["author"]["id"] == resident.id
    due = datetime.fromisoformat(ticket["due_at"])
    assert timedelta(hours=1) < due - datetime.now(UTC) <= timedelta(hours=2)
    url = f"/api/v1/tickets/{ticket['id']}"

    # Назначение исполнителя переводит заявку в работу.
    assigned = await client.patch(url, json={"assignee_id": manager.id}, headers=auth(manager))
    assert assigned.json()["status"] == "in_progress"
    assert assigned.json()["assignee"]["id"] == manager.id

    # Внутренний комментарий жителю не виден.
    await client.post(
        f"{url}/comments",
        json={"body": "Нужен сантехник с ключом 32", "is_internal": True},
        headers=auth(manager),
    )
    await client.post(
        f"{url}/status",
        json={"status": "waiting", "comment": "Уточните удобное время"},
        headers=auth(manager),
    )
    resident_view = (await client.get(url, headers=auth(resident))).json()
    assert all(not c["is_internal"] for c in resident_view["comments"])
    staff_view = (await client.get(url, headers=auth(manager))).json()
    assert any(c["is_internal"] for c in staff_view["comments"])

    # Ответ жителя возвращает заявку в работу.
    replied = await client.post(
        f"{url}/comments", json={"body": "Завтра после 18:00"}, headers=auth(resident)
    )
    assert replied.json()["status"] == "in_progress"

    resolved = await client.post(
        f"{url}/status", json={"status": "resolved"}, headers=auth(manager)
    )
    assert resolved.json()["resolved_at"] is not None

    rated = await client.post(
        f"{url}/rate", json={"rating": 5, "comment": "Быстро!"}, headers=auth(resident)
    )
    body = rated.json()
    assert (body["status"], body["rating"]) == ("closed", 5)
    assert body["closed_at"] is not None
    history = [c["body"] for c in body["comments"] if c["is_system"]]
    assert history[:2] == [f"Назначен исполнитель: {manager.full_name}", "Статус: Новая → В работе"]
    assert history[-1] == "Житель подтвердил выполнение"

    closed_comment = await client.post(
        f"{url}/comments", json={"body": "ещё вопрос"}, headers=auth(resident)
    )
    assert closed_comment.status_code == 422


async def test_resident_transitions_are_limited(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    ticket = await _create(client, resident, apartment.id)
    url = f"/api/v1/tickets/{ticket['id']}/status"

    forbidden = await client.post(url, json={"status": "resolved"}, headers=auth(resident))
    assert forbidden.status_code == 403

    reject_without_reason = await client.post(
        url, json={"status": "rejected"}, headers=auth(manager)
    )
    assert reject_without_reason.status_code == 422

    withdrawn = await client.post(url, json={"status": "closed"}, headers=auth(resident))
    assert withdrawn.json()["status"] == "closed"

    reopen = await client.post(url, json={"status": "in_progress"}, headers=auth(manager))
    assert reopen.status_code == 422


async def test_resident_reopens_resolved_ticket(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    ticket = await _create(client, resident, apartment.id)
    url = f"/api/v1/tickets/{ticket['id']}/status"
    await client.post(url, json={"status": "resolved"}, headers=auth(manager))
    reopened = await client.post(
        url, json={"status": "in_progress", "comment": "Опять течёт"}, headers=auth(resident)
    )
    assert reopened.json()["status"] == "in_progress"
    assert reopened.json()["resolved_at"] is None


async def test_ticket_visibility_and_filters(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    own = await make_apartment(session, residents=[resident])
    foreign = await make_apartment(session)
    mine = await _create(client, resident, own.id)
    other = await _create(client, manager, foreign.id, category="elevator", priority="high")

    resident_list = await client.get("/api/v1/tickets", headers=auth(resident))
    assert [t["id"] for t in resident_list.json()["items"]] == [mine["id"]]
    hidden = await client.get(f"/api/v1/tickets/{other['id']}", headers=auth(resident))
    assert hidden.status_code == 404

    foreign_create = await client.post(
        "/api/v1/tickets",
        json={
            "apartment_id": foreign.id,
            "category": "other",
            "subject": "Чужая квартира",
            "description": "...",
        },
        headers=auth(resident),
    )
    assert foreign_create.status_code == 404

    by_apartment = await client.get(
        "/api/v1/tickets", params={"apartment_id": foreign.id}, headers=auth(manager)
    )
    assert [t["id"] for t in by_apartment.json()["items"]] == [other["id"]]

    by_category = await client.get(
        "/api/v1/tickets", params={"category": "elevator"}, headers=auth(manager)
    )
    assert [t["id"] for t in by_category.json()["items"]] == [other["id"]]
    by_status = await client.get(
        "/api/v1/tickets",
        params=[("status", "new"), ("status", "waiting"), ("building_id", own.building_id)],
        headers=auth(manager),
    )
    assert [t["id"] for t in by_status.json()["items"]] == [mine["id"]]


async def test_building_wide_ticket_by_staff(
    client: AsyncClient, session: AsyncSession, manager: User, resident: User
) -> None:
    building = await make_building(session)
    response = await client.post(
        "/api/v1/tickets",
        json={
            "building_id": building.id,
            "category": "territory",
            "subject": "Покос травы во дворе",
            "description": "Плановые работы",
        },
        headers=auth(manager),
    )
    assert response.status_code == 201
    assert response.json()["apartment"] is None

    no_apartment = await client.post(
        "/api/v1/tickets",
        json={"category": "other", "subject": "Без адреса", "description": "..."},
        headers=auth(resident),
    )
    assert no_apartment.status_code == 422


async def test_assignee_must_be_staff(
    client: AsyncClient, session: AsyncSession, resident: User, manager: User
) -> None:
    apartment = await make_apartment(session, residents=[resident])
    ticket = await _create(client, resident, apartment.id)
    response = await client.patch(
        f"/api/v1/tickets/{ticket['id']}",
        json={"assignee_id": resident.id},
        headers=auth(manager),
    )
    assert response.status_code == 422
