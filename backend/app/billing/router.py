from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.auth.deps import AccountantUser, HouseholdUser, SessionDep, StaffUser
from app.billing import service
from app.billing.models import Invoice, InvoiceStatus, Payment
from app.billing.periods import Period
from app.billing.qr import payment_qr_payload
from app.billing.schemas import (
    AccountSummary,
    BillingRunReport,
    BillingRunRequest,
    DebtorRow,
    InvoiceDetail,
    InvoiceRead,
    IssueReport,
    IssueRequest,
    PaymentCreate,
    PaymentRead,
    TariffCreate,
    TariffRead,
    TariffUpdate,
)
from app.core.config import get_settings
from app.core.pagination import Page, PageParams, page_params, paginate, paginate_rows
from app.housing.schemas import ApartmentBrief
from app.housing.service import get_apartment_for_user, resident_apartment_ids

router = APIRouter(tags=["billing"])


# ---------- Тарифы ----------


@router.get("/tariffs", response_model=list[TariffRead], summary="Тарифы")
async def list_tariffs(
    session: SessionDep,
    _: StaffUser,
    active_on: Annotated[date | None, Query(description="Действующие на дату")] = None,
    building_id: int | None = None,
) -> list[TariffRead]:
    tariffs = await session.scalars(
        service.tariffs_query(active_on=active_on, building_id=building_id)
    )
    return [TariffRead.model_validate(t) for t in tariffs]


@router.post(
    "/tariffs",
    response_model=TariffRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить тариф",
)
async def create_tariff(session: SessionDep, _: AccountantUser, data: TariffCreate) -> TariffRead:
    tariff = await service.create_tariff(session, data)
    await session.commit()
    return TariffRead.model_validate(tariff)


@router.patch("/tariffs/{tariff_id}", response_model=TariffRead, summary="Изменить тариф")
async def update_tariff(
    session: SessionDep, _: AccountantUser, tariff_id: int, data: TariffUpdate
) -> TariffRead:
    tariff = await service.get_tariff(session, tariff_id)
    await service.update_tariff(session, tariff, data)
    await session.commit()
    return TariffRead.model_validate(tariff)


@router.delete(
    "/tariffs/{tariff_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить тариф"
)
async def delete_tariff(session: SessionDep, _: AccountantUser, tariff_id: int) -> Response:
    tariff = await service.get_tariff(session, tariff_id)
    await session.delete(tariff)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Начисления ----------


@router.post(
    "/billing/run",
    response_model=BillingRunReport,
    summary="Сформировать черновики квитанций за период",
)
async def run_billing(
    session: SessionDep, _: AccountantUser, data: BillingRunRequest
) -> BillingRunReport:
    report = await service.run_billing(session, data.period, data.building_id)
    await session.commit()
    return report


@router.post(
    "/billing/issue", response_model=IssueReport, summary="Выставить все черновики за период"
)
async def issue_period(session: SessionDep, _: AccountantUser, data: IssueRequest) -> IssueReport:
    issued = await service.issue_period(session, data.period, data.building_id)
    await session.commit()
    return IssueReport(issued=issued)


@router.get(
    "/billing/accounts/{apartment_id}",
    response_model=AccountSummary,
    summary="Состояние лицевого счёта",
)
async def account_summary(
    session: SessionDep, user: HouseholdUser, apartment_id: int
) -> AccountSummary:
    await get_apartment_for_user(session, user, apartment_id)
    return await service.account_summary(session, apartment_id)


@router.get("/billing/debtors", response_model=Page[DebtorRow], summary="Должники")
async def debtors(
    session: SessionDep,
    _: StaffUser,
    page: Annotated[PageParams, Depends(page_params)],
    building_id: int | None = None,
    min_debt: Annotated[Decimal, Query(ge=0)] = Decimal(0),
) -> Page[DebtorRow]:
    rows, total = await paginate_rows(
        session, service.debtors_query(building_id=building_id, min_debt=min_debt), page
    )
    items = [
        DebtorRow(
            apartment=ApartmentBrief.model_validate(apartment),
            owner_name=apartment.owner_name,
            balance=balance,
            last_payment_at=last_payment_at,
        )
        for apartment, balance, last_payment_at in rows
    ]
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


# ---------- Квитанции ----------


@router.get("/invoices", response_model=Page[InvoiceRead], summary="Квитанции")
async def list_invoices(
    session: SessionDep,
    user: HouseholdUser,
    page: Annotated[PageParams, Depends(page_params)],
    period: Annotated[Period | None, Query(description="YYYY-MM")] = None,
    invoice_status: Annotated[InvoiceStatus | None, Query(alias="status")] = None,
    building_id: int | None = None,
    apartment_id: int | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[InvoiceRead]:
    ids = await resident_apartment_ids(session, user)
    stmt = service.invoices_query(
        ids,
        period=period,
        status=invoice_status,
        building_id=building_id,
        apartment_id=apartment_id,
        search=search,
    )
    invoices, total = await paginate(session, stmt, page)
    return Page(
        items=[InvoiceRead.model_validate(i) for i in invoices],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


def _invoice_detail(invoice: Invoice) -> InvoiceDetail:
    company = get_settings().company
    detail = InvoiceDetail.model_validate(invoice)
    return detail.model_copy(
        update={
            # QR только для неоплаченных выставленных квитанций — защита от двойной оплаты.
            "payment_qr": (
                payment_qr_payload(invoice, company)
                if invoice.status in (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID)
                and invoice.total_due > 0
                else None
            ),
        }
    )


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail, summary="Квитанция")
async def get_invoice(session: SessionDep, user: HouseholdUser, invoice_id: int) -> InvoiceDetail:
    invoice = await service.get_invoice_for_user(session, user, invoice_id)
    return _invoice_detail(invoice)


@router.post(
    "/invoices/{invoice_id}/issue", response_model=InvoiceDetail, summary="Выставить квитанцию"
)
async def issue_invoice(
    session: SessionDep, user: AccountantUser, invoice_id: int
) -> InvoiceDetail:
    invoice = await service.get_invoice_for_user(session, user, invoice_id)
    await service.issue_invoice(session, invoice)
    await session.commit()
    return _invoice_detail(await service.get_invoice_for_user(session, user, invoice_id))


@router.post(
    "/invoices/{invoice_id}/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Аннулировать квитанцию (черновик — удалить)",
)
async def cancel_invoice(session: SessionDep, user: AccountantUser, invoice_id: int) -> Response:
    invoice = await service.get_invoice_for_user(session, user, invoice_id)
    await service.cancel_invoice(session, invoice)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Оплаты ----------


@router.get("/payments", response_model=Page[PaymentRead], summary="Оплаты")
async def list_payments(
    session: SessionDep,
    user: HouseholdUser,
    page: Annotated[PageParams, Depends(page_params)],
    apartment_id: int | None = None,
    building_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Page[PaymentRead]:
    ids = await resident_apartment_ids(session, user)
    stmt = service.payments_query(
        ids,
        apartment_id=apartment_id,
        building_id=building_id,
        date_from=date_from,
        date_to=date_to,
    )
    payments, total = await paginate(session, stmt, page)
    return Page(
        items=[PaymentRead.model_validate(p) for p in payments],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "/payments",
    response_model=PaymentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Зарегистрировать оплату",
)
async def register_payment(
    session: SessionDep, user: AccountantUser, data: PaymentCreate
) -> PaymentRead:
    payment = await service.register_payment(session, data, user)
    await session.commit()
    stmt = service.payments_query(None).where(Payment.id == payment.id)
    return PaymentRead.model_validate(await session.scalar(stmt))
