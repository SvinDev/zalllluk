"""Платёжный QR-код по ГОСТ Р 56042-2014 — распознаётся банковскими приложениями."""

from decimal import Decimal

from app.billing.models import Invoice
from app.core.config import CompanySettings

_HEADER = "ST00012"  # ST + версия 0001 + кодировка 2 (UTF-8)


def _clean(value: str) -> str:
    # «|» — разделитель полей, внутри значений он недопустим.
    return " ".join(value.replace("|", " ").split())


def payment_qr_payload(invoice: Invoice, company: CompanySettings) -> str:
    apartment = invoice.apartment
    kopecks = int((invoice.total_due * 100).to_integral_value())
    period = f"{invoice.period:%m.%Y}"
    fields: list[tuple[str, str]] = [
        ("Name", company.name),
        ("PersonalAcc", company.bank_account),
        ("BankName", company.bank_name),
        ("BIC", company.bik),
        ("CorrespAcc", company.corr_account),
        ("PayeeINN", company.inn),
        ("KPP", company.kpp),
        ("Sum", str(kopecks)),
        ("Purpose", f"Оплата ЖКУ за {period}, л/с {apartment.account_number}"),
        ("PersAcc", apartment.account_number),
        ("PaymPeriod", f"{invoice.period:%m%Y}"),
        ("PayerAddress", f"{apartment.building.address}, кв. {apartment.number}"),
    ]
    return "|".join([_HEADER, *(f"{key}={_clean(value)}" for key, value in fields if value)])


def qr_sum_rubles(payload: str) -> Decimal:
    """Обратное преобразование суммы (нужно тестам и для отладки)."""
    for part in payload.split("|"):
        if part.startswith("Sum="):
            return Decimal(part.removeprefix("Sum=")) / 100
    raise ValueError("В строке нет суммы")
