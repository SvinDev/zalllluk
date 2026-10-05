from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.users.models import User, UserRole
from tests.factories import PASSWORD, auth, make_apartment, make_user


async def test_login_and_profile(client: AsyncClient, session: AsyncSession) -> None:
    resident = await make_user(session, UserRole.RESIDENT, email="ivan@example.com")
    apartment = await make_apartment(session, residents=[resident])

    response = await client.post(
        "/api/v1/auth/login", json={"email": "IVAN@example.com ", "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "ivan@example.com"
    assert [a["id"] for a in body["apartments"]] == [apartment.id]


async def test_login_rejects_wrong_password_and_blocked_user(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await make_user(session, email="blocked@example.com")
    wrong = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "nope-nope"}
    )
    assert wrong.status_code == 401

    user.is_active = False
    await session.flush()
    blocked = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert blocked.status_code == 401
    assert blocked.json()["code"] == "unauthorized"


async def test_requests_without_token_are_rejected(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    bad = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


async def test_change_password(client: AsyncClient, resident: User) -> None:
    wrong = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong", "new_password": "new-password-1"},
        headers=auth(resident),
    )
    assert wrong.status_code == 422

    ok = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "new-password-1"},
        headers=auth(resident),
    )
    assert ok.status_code == 204
    login = await client.post(
        "/api/v1/auth/login", json={"email": resident.email, "password": "new-password-1"}
    )
    assert login.status_code == 200


async def test_admin_creates_staff_and_duplicate_email_conflicts(
    client: AsyncClient, admin: User
) -> None:
    payload = {
        "email": "Buh@Example.com",
        "full_name": "Бухгалтер",
        "role": "accountant",
        "password": "secret-password",
    }
    created = await client.post("/api/v1/users", json=payload, headers=auth(admin))
    assert created.status_code == 201, created.text
    assert created.json()["email"] == "buh@example.com"

    duplicate = await client.post("/api/v1/users", json=payload, headers=auth(admin))
    assert duplicate.status_code == 409


async def test_manager_can_manage_only_residents(client: AsyncClient, manager: User) -> None:
    staff = await client.post(
        "/api/v1/users",
        json={"email": "x@example.com", "full_name": "X", "role": "admin", "password": "12345678"},
        headers=auth(manager),
    )
    assert staff.status_code == 403

    resident = await client.post(
        "/api/v1/users",
        json={"email": "r@example.com", "full_name": "R", "password": "12345678"},
        headers=auth(manager),
    )
    assert resident.status_code == 201
    assert resident.json()["role"] == "resident"

    promote = await client.patch(
        f"/api/v1/users/{resident.json()['id']}", json={"role": "admin"}, headers=auth(manager)
    )
    assert promote.status_code == 403


async def test_residents_cannot_list_users(client: AsyncClient, resident: User) -> None:
    response = await client.get("/api/v1/users", headers=auth(resident))
    assert response.status_code == 403


async def test_admin_cannot_demote_or_block_self(client: AsyncClient, admin: User) -> None:
    demote = await client.patch(
        f"/api/v1/users/{admin.id}", json={"role": "manager"}, headers=auth(admin)
    )
    assert demote.status_code == 403
    block = await client.patch(
        f"/api/v1/users/{admin.id}", json={"is_active": False}, headers=auth(admin)
    )
    assert block.status_code == 403


async def test_users_search(client: AsyncClient, session: AsyncSession, admin: User) -> None:
    await make_user(session, full_name="Петров Пётр", phone="+79990001122")
    await make_user(session, full_name="Сидоров Сидор")
    response = await client.get("/api/v1/users", params={"search": "петров"}, headers=auth(admin))
    assert response.status_code == 200
    assert [u["full_name"] for u in response.json()["items"]] == ["Петров Пётр"]
