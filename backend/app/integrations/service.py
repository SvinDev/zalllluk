import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AuthenticationError, NotFoundError
from app.core.security import generate_api_key, hash_api_key
from app.integrations.models import ApiKey, MeterDataSource
from app.integrations.providers import ProviderError, build_provider
from app.integrations.schemas import DataSourceCreate, DataSourceUpdate, SyncResult
from app.meters.models import ReadingSource
from app.meters.service import ingest_external_readings
from app.users.models import User

logger = logging.getLogger(__name__)


# ---------- API-ключи ----------


async def create_api_key(session: AsyncSession, name: str, actor: User) -> tuple[ApiKey, str]:
    raw_key, prefix, key_hash = generate_api_key()
    api_key = ApiKey(name=name, prefix=prefix, key_hash=key_hash, created_by_id=actor.id)
    session.add(api_key)
    await session.flush()
    return api_key, raw_key


async def authenticate_api_key(session: AsyncSession, raw_key: str | None) -> ApiKey:
    if not raw_key:
        raise AuthenticationError("Не передан заголовок X-API-Key")
    api_key = await session.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(raw_key)))
    if api_key is None or not api_key.is_active:
        raise AuthenticationError("Недействительный API-ключ")
    api_key.last_used_at = datetime.now(UTC)
    return api_key


async def get_api_key(session: AsyncSession, key_id: int) -> ApiKey:
    api_key = await session.get(ApiKey, key_id)
    if api_key is None:
        raise NotFoundError("API-ключ не найден")
    return api_key


# ---------- Источники показаний (pull) ----------


async def get_source(session: AsyncSession, source_id: int) -> MeterDataSource:
    source = await session.get(MeterDataSource, source_id)
    if source is None:
        raise NotFoundError("Источник данных не найден")
    return source


async def create_source(session: AsyncSession, data: DataSourceCreate) -> MeterDataSource:
    source = MeterDataSource(**data.model_dump(mode="json"))
    session.add(source)
    await session.flush()
    return source


async def update_source(
    session: AsyncSession, source: MeterDataSource, data: DataSourceUpdate
) -> MeterDataSource:
    for field, value in data.model_dump(mode="json", exclude_unset=True).items():
        setattr(source, field, value)
    await session.flush()
    return source


async def sync_source(
    session: AsyncSession,
    source: MeterDataSource,
    *,
    request_timeout: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SyncResult:
    """Забирает новые показания из источника и сохраняет их.

    Курсор сдвигается на максимальный полученный taken_at, даже если часть записей
    отклонена (например, счётчик ещё не заведён): отклонённое видно в отчёте,
    а повторная выкачка того же окна бесконечно не повторяется.
    """
    source.last_synced_at = datetime.now(UTC)
    provider = build_provider(source, timeout=request_timeout, transport=transport)
    try:
        items = await provider.fetch(source.cursor)
    except ProviderError as exc:
        logger.warning("Meter source %s sync failed: %s", source.id, exc)
        source.last_status = "error"
        source.last_error = str(exc)
        await session.flush()
        return SyncResult(source_id=source.id, status="error", error=str(exc))

    report = await ingest_external_readings(session, items, ReadingSource.PROVIDER)
    if items:
        newest = max(item.taken_at for item in items)
        source.cursor = max(newest, source.cursor) if source.cursor else newest
    status = "partial" if report.rejected else "ok"
    source.last_status = status
    source.last_error = (
        "; ".join(f"#{e.index}: {e.error}" for e in report.rejected[:20])
        if report.rejected
        else None
    )
    await session.flush()
    return SyncResult(source_id=source.id, status=status, report=report)
