from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.models import Invoice, InvoiceStatus
from app.demo import DEMO_PASSWORD, seed


async def test_demo_seed_builds_consistent_dataset(
    client: AsyncClient, session: AsyncSession
) -> None:
    summary = await seed(session)
    assert "ukapi_" in summary

    issued = await session.scalar(
        select(func.count(Invoice.id)).where(Invoice.status != InvoiceStatus.DRAFT)
    )
    assert issued == 20 * 5  # 20 квартир × 5 закрытых месяцев

    login = await client.post(
        "/api/v1/auth/login", json={"email": "resident@demo.ru", "password": DEMO_PASSWORD}
    )
    token = login.json()["access_token"]
    invoices = await client.get("/api/v1/invoices", headers={"Authorization": f"Bearer {token}"})
    assert invoices.json()["total"] == 5
