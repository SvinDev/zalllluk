from datetime import UTC, date, datetime
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import service
from app.billing.models import Invoice, InvoiceStatus, Tariff, TariffMethod
from app.billing.qr import qr_sum_rubles
from app.housing.models import Apartment
from app.meters.models import MeterKind
from app.users.models import User
from tests.factories import auth, make_apartment, make_meter, make_reading


def ts(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 12, tzinfo=UTC)


async def make_tariff(session: AsyncSession, **fields: object) -> Tariff:
    values: dict[str, object] = {"valid_from": date(2020, 1, 1), **fields}
    tariff = Tariff(**values)
    session.add(tariff)
    await session.flush()
    return tariff


async def standard_tariffs(session: AsyncSession) -> None:
    await make_tariff(
        session, name="Содержание жилья", method=TariffMethod.PER_AREA, rate=Decimal("30.5")
    )
    await make_tariff(
        session, name="Вывоз ТКО", method=TariffMethod.PER_RESIDENT, rate=Decimal("100")
    )
    await make_tariff(session, name="Домофон", method=TariffMethod.FIXED, rate=Decimal("50"))
    await make_tariff(
        session,
        name="Холодная вода",
        method=TariffMethod.METERED,
        meter_kind=MeterKind.COLD_WATER,
        rate=Decimal("45.5"),
        normative=Decimal("4.85"),
    )


def lines_by_name(invoice: dict) -> dict[str, dict]:  # type: ignore[type-arg]
    return {line["service_name"]: line for line in invoice["lines"]}


async def test_full_billing_cycle(
    client: AsyncClient, session: AsyncSession, accountant: User, resident: User
) -> None:
    await standard_tariffs(session)
    apartment = await make_apartment(
        session, area=Decimal("50"), residents_count=2, residents=[resident]
    )
    meter = await make_meter(session, apartment, serial_number="CW-1", initial_value=100)
    await make_reading(session, meter, "110", ts(2026, 8, 10))
    headers = auth(accountant)

    # --- Август: по показаниям ---
    run = await client.post("/api/v1/billing/run", json={"period": "2026-08"}, headers=headers)
    assert run.status_code == 200, run.text
    assert run.json()["created"] == 1
    assert run.json()["total_amount"] == "2230.00"

    # Черновик жителю не виден.
    hidden = await client.get("/api/v1/invoices", headers=auth(resident))
    assert hidden.json()["total"] == 0

    issued = await client.post(
        "/api/v1/billing/issue", json={"period": "2026-08-01"}, headers=headers
    )
    assert issued.json() == {"issued": 1}

    invoices = await client.get("/api/v1/invoices", headers=auth(resident))
    august_id = invoices.json()["items"][0]["id"]
    august = (await client.get(f"/api/v1/invoices/{august_id}", headers=auth(resident))).json()
    assert august["number"] == f"{apartment.account_number}-202608"
    assert august["status"] == "issued"
    assert august["due_date"] == "2026-09-10"
    assert august["total_due"] == "2230.00"
    water = lines_by_name(august)["Холодная вода (сч. № CW-1)"]
    assert (water["reading_from"], water["reading_to"], water["quantity"], water["amount"]) == (
        "100.000",
        "110.000",
        "10.000",
        "455.00",
    )
    assert water["basis"] == "meter"
    assert lines_by_name(august)["Содержание жилья"]["amount"] == "1525.00"
    assert august["payment_qr"].startswith("ST00012|Name=")
    assert qr_sum_rubles(august["payment_qr"]) == Decimal("2230")

    paid = await client.post(
        "/api/v1/payments",
        json={"account_number": apartment.account_number, "amount": "1000", "reference": "PP-1"},
        headers=headers,
    )
    assert paid.status_code == 201, paid.text
    august = (await client.get(f"/api/v1/invoices/{august_id}", headers=headers)).json()
    assert (august["status"], august["paid_amount"]) == ("partially_paid", "1000.00")
    assert august["payment_qr"] is not None

    # --- Сентябрь: показаний нет, истории мало — норматив ---
    await client.post("/api/v1/billing/run", json={"period": "2026-09"}, headers=headers)
    await client.post("/api/v1/billing/issue", json={"period": "2026-09"}, headers=headers)
    september = (
        await client.get("/api/v1/invoices", params={"period": "2026-09"}, headers=headers)
    ).json()["items"][0]
    september = (await client.get(f"/api/v1/invoices/{september['id']}", headers=headers)).json()
    water = lines_by_name(september)["Холодная вода (сч. № CW-1)"]
    assert (water["basis"], water["quantity"], water["amount"]) == ("normative", "9.700", "441.35")
    assert september["opening_balance"] == "1230.00"  # долг за август
    assert september["total_due"] == "3446.35"  # 2216.35 + 1230

    # --- Октябрь: показания переданы — факт и перерасчёт норматива ---
    await make_reading(session, meter, "125", ts(2026, 10, 3))
    await client.post("/api/v1/billing/run", json={"period": "2026-10"}, headers=headers)
    october = (
        await client.get("/api/v1/invoices", params={"period": "2026-10"}, headers=headers)
    ).json()["items"][0]
    october = (await client.get(f"/api/v1/invoices/{october['id']}", headers=headers)).json()
    lines = lines_by_name(october)
    actual = lines["Холодная вода (сч. № CW-1)"]
    assert (actual["reading_from"], actual["reading_to"], actual["quantity"]) == (
        "110.000",
        "125.000",
        "15.000",
    )
    recalc = lines["Перерасчёт: Холодная вода (сч. № CW-1)"]
    assert (recalc["basis"], recalc["quantity"], recalc["amount"]) == (
        "recalculation",
        "-9.700",
        "-441.35",
    )
    assert october["status"] == "draft"
    # Вода по факту: 15 × 45.5 = 682.50, минус 441.35 перерасчёта.
    assert Decimal(october["amount"]) == Decimal("1775.00") + Decimal("682.50") - Decimal("441.35")

    # Крупная оплата закрывает август и сентябрь, остаток — переплата.
    await client.post(
        "/api/v1/payments",
        json={"apartment_id": apartment.id, "amount": "5000", "method": "card"},
        headers=headers,
    )
    statuses = {
        i["period"]: (i["status"], i["paid_amount"])
        for i in (await client.get("/api/v1/invoices", headers=headers)).json()["items"]
    }
    paid_august = (await client.get(f"/api/v1/invoices/{august_id}", headers=headers)).json()
    assert paid_august["payment_qr"] is None  # оплачена — QR не показываем
    assert statuses == {
        "2026-10-01": ("draft", "0.00"),
        "2026-09-01": ("paid", "2216.35"),
        "2026-08-01": ("paid", "2230.00"),
    }
    summary = await client.get(f"/api/v1/billing/accounts/{apartment.id}", headers=auth(resident))
    assert summary.json()["balance"] == "-1553.65"

    # При выставлении октября (2016.15) переплата засчитывается сразу.
    issue = (await client.post(f"/api/v1/invoices/{october['id']}/issue", headers=headers)).json()
    assert issue["opening_balance"] == "-1553.65"
    assert (issue["status"], issue["paid_amount"]) == ("partially_paid", "1553.65")
    assert issue["total_due"] == "462.50"
    assert qr_sum_rubles(issue["payment_qr"]) == Decimal("462.50")


async def test_average_then_normative_then_recalculation(
    session: AsyncSession, accountant: User
) -> None:
    await make_tariff(
        session,
        name="Вода",
        method=TariffMethod.METERED,
        meter_kind=MeterKind.COLD_WATER,
        rate=Decimal("10"),
        normative=Decimal("5"),
    )
    apartment = await make_apartment(session, residents_count=2)
    meter = await make_meter(session, apartment, initial_value=100)
    await make_reading(session, meter, "100", ts(2026, 1, 1))
    await make_reading(session, meter, "190", ts(2026, 4, 1))  # 90 м³ за 90 дней

    async def bill(month: int) -> Invoice:
        await service.run_billing(session, date(2026, month, 1))
        invoice = await session.scalar(
            service.invoices_query(None, period=date(2026, month, 1), apartment_id=apartment.id)
        )
        assert invoice is not None
        await service.issue_invoice(session, invoice)
        return await service.get_invoice_for_user(session, accountant, invoice.id)

    april = await bill(4)
    assert [(line.basis, line.quantity) for line in april.lines] == [("meter", Decimal("90"))]

    bases = []
    for month in (5, 6, 7, 8):
        invoice = await bill(month)
        bases.append((invoice.lines[0].basis.value, invoice.lines[0].quantity))
    # Три периода по среднему (1 м³/сут × дни месяца), затем — норматив 5 × 2 чел.
    assert bases == [
        ("average", Decimal("31.000")),
        ("average", Decimal("30.000")),
        ("average", Decimal("31.000")),
        ("normative", Decimal("10.000")),
    ]

    await make_reading(session, meter, "400", ts(2026, 9, 10))
    september = await bill(9)
    assert [(line.basis.value, line.quantity, line.amount) for line in september.lines] == [
        ("meter", Decimal("210.000"), Decimal("2100.00")),
        ("recalculation", Decimal("-102.000"), Decimal("-1020.00")),
    ]


async def test_rerun_regenerates_drafts_but_keeps_issued(
    client: AsyncClient, session: AsyncSession, accountant: User
) -> None:
    await make_tariff(session, name="Домофон", method=TariffMethod.FIXED, rate=Decimal("50"))
    issued_apartment = await make_apartment(session)
    draft_apartment = await make_apartment(session)
    headers = auth(accountant)
    period = {"period": "2026-09"}

    await client.post("/api/v1/billing/run", json=period, headers=headers)
    to_issue = await session.scalar(
        service.invoices_query(None, period=date(2026, 9, 1), apartment_id=issued_apartment.id)
    )
    assert to_issue is not None
    await client.post(f"/api/v1/invoices/{to_issue.id}/issue", headers=headers)

    rerun = (await client.post("/api/v1/billing/run", json=period, headers=headers)).json()
    assert rerun["skipped_posted"] >= 1
    assert rerun["regenerated"] >= 1
    assert rerun["created"] == 0

    rows = await session.execute(
        select(Invoice.apartment_id, Invoice.status).where(
            Invoice.apartment_id.in_([issued_apartment.id, draft_apartment.id])
        )
    )
    assert {apartment_id: status for apartment_id, status in rows} == {
        issued_apartment.id: InvoiceStatus.ISSUED,
        draft_apartment.id: InvoiceStatus.DRAFT,
    }


async def test_cancel_reallocates_payments_and_renumbers(
    client: AsyncClient, session: AsyncSession, accountant: User
) -> None:
    await make_tariff(session, name="Домофон", method=TariffMethod.FIXED, rate=Decimal("100"))
    apartment = await make_apartment(session)
    headers = auth(accountant)

    await client.post(
        "/api/v1/billing/run",
        json={"period": "2026-09", "building_id": apartment.building_id},
        headers=headers,
    )
    await client.post(
        "/api/v1/billing/issue",
        json={"period": "2026-09", "building_id": apartment.building_id},
        headers=headers,
    )
    await client.post(
        "/api/v1/payments",
        json={"apartment_id": apartment.id, "amount": "100"},
        headers=headers,
    )
    invoice = (
        await client.get("/api/v1/invoices", params={"apartment_id": apartment.id}, headers=headers)
    ).json()["items"][0]
    assert invoice["status"] == "paid"

    cancel = await client.post(f"/api/v1/invoices/{invoice['id']}/cancel", headers=headers)
    assert cancel.status_code == 204
    summary = await client.get(f"/api/v1/billing/accounts/{apartment.id}", headers=headers)
    assert summary.json()["balance"] == "-100.00"  # оплата превратилась в аванс

    rerun = await client.post(
        "/api/v1/billing/run",
        json={"period": "2026-09", "building_id": apartment.building_id},
        headers=headers,
    )
    assert rerun.json()["created"] == 1
    new_invoice = (
        await client.get(
            "/api/v1/invoices",
            params={"apartment_id": apartment.id, "status": "draft"},
            headers=headers,
        )
    ).json()["items"][0]
    assert new_invoice["number"] == f"{apartment.account_number}-202609-2"


async def test_billing_rules_and_permissions(
    client: AsyncClient, session: AsyncSession, accountant: User, manager: User
) -> None:
    future = await client.post(
        "/api/v1/billing/run", json={"period": "2099-01"}, headers=auth(accountant)
    )
    assert future.status_code == 422

    forbidden = await client.post(
        "/api/v1/billing/run", json={"period": "2026-09"}, headers=auth(manager)
    )
    assert forbidden.status_code == 403

    bad_tariff = await client.post(
        "/api/v1/tariffs",
        json={"name": "Вода", "method": "metered", "rate": "10", "valid_from": "2026-01-01"},
        headers=auth(accountant),
    )
    assert bad_tariff.status_code == 422


async def test_tariff_selected_by_first_day_of_period(
    client: AsyncClient, session: AsyncSession, accountant: User
) -> None:
    building_apartment = await make_apartment(session)
    payload = {
        "name": "Содержание",
        "method": "per_area",
        "building_id": building_apartment.building_id,
    }
    old = await client.post(
        "/api/v1/tariffs",
        json={**payload, "rate": "10", "valid_from": "2026-01-01", "valid_to": "2026-06-30"},
        headers=auth(accountant),
    )
    new = await client.post(
        "/api/v1/tariffs",
        json={**payload, "rate": "12", "valid_from": "2026-07-01"},
        headers=auth(accountant),
    )
    assert old.status_code == new.status_code == 201
    assert new.json()["unit"] == "м²"

    await client.post(
        "/api/v1/billing/run",
        json={"period": "2026-07", "building_id": building_apartment.building_id},
        headers=auth(accountant),
    )
    invoice = await session.scalar(
        service.invoices_query(None, period=date(2026, 7, 1), apartment_id=building_apartment.id)
    )
    assert invoice is not None
    assert invoice.amount == Decimal("600.00")  # 50 м² × 12, без двойного начисления


async def test_payment_reference_is_idempotent(
    client: AsyncClient, session: AsyncSession, accountant: User
) -> None:
    apartment: Apartment = await make_apartment(session)
    payload = {"apartment_id": apartment.id, "amount": "10", "reference": "BANK-77"}
    first = await client.post("/api/v1/payments", json=payload, headers=auth(accountant))
    assert first.status_code == 201
    second = await client.post("/api/v1/payments", json=payload, headers=auth(accountant))
    assert second.status_code == 409

    both = await client.post(
        "/api/v1/payments",
        json={"apartment_id": apartment.id, "account_number": "x", "amount": "1"},
        headers=auth(accountant),
    )
    assert both.status_code == 422


async def test_debtors(client: AsyncClient, session: AsyncSession, accountant: User) -> None:
    await make_tariff(session, name="Домофон", method=TariffMethod.FIXED, rate=Decimal("300"))
    debtor = await make_apartment(session, owner_name="Должников Д.")
    payer = await make_apartment(session)
    for apartment in (debtor, payer):
        await client.post(
            "/api/v1/billing/run",
            json={"period": "2026-09", "building_id": apartment.building_id},
            headers=auth(accountant),
        )
        await client.post(
            "/api/v1/billing/issue",
            json={"period": "2026-09", "building_id": apartment.building_id},
            headers=auth(accountant),
        )
    await client.post(
        "/api/v1/payments",
        json={"apartment_id": payer.id, "amount": "300"},
        headers=auth(accountant),
    )

    response = await client.get(
        "/api/v1/billing/debtors", params={"min_debt": "100"}, headers=auth(accountant)
    )
    rows = response.json()["items"]
    assert [(r["apartment"]["id"], r["balance"]) for r in rows] == [(debtor.id, "300.00")]
    assert rows[0]["owner_name"] == "Должников Д."


async def test_resident_cannot_see_foreign_invoice(
    client: AsyncClient, session: AsyncSession, resident: User
) -> None:
    await make_tariff(session, name="Домофон", method=TariffMethod.FIXED, rate=Decimal("1"))
    foreign = await make_apartment(session)
    await service.run_billing(session, date(2026, 9, 1), foreign.building_id)
    invoice = await session.scalar(service.invoices_query(None, apartment_id=foreign.id))
    assert invoice is not None
    invoice.status = InvoiceStatus.ISSUED
    await session.flush()
    response = await client.get(f"/api/v1/invoices/{invoice.id}", headers=auth(resident))
    assert response.status_code == 404
