"""Фоновый опрос внешних систем учёта.

При нескольких репликах API опрос выполняет только одна: остальные не получат
advisory-lock в PostgreSQL и пропустят итерацию. Дубли при этом всё равно
невозможны — их отсекает уникальный индекс (meter_id, taken_at).
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import SessionFactory, engine
from app.integrations.models import MeterDataSource
from app.integrations.service import sync_source

logger = logging.getLogger(__name__)

_LOCK_KEY = 0x554B_4D53  # "UKMS"


async def sync_all_sources() -> None:
    settings = get_settings()
    async with engine.connect() as lock_conn:
        acquired = await lock_conn.scalar(select(func.pg_try_advisory_lock(_LOCK_KEY)))
        if not acquired:
            logger.debug("Meter sync is running in another worker, skipping")
            return
        try:
            async with SessionFactory() as session:
                source_ids = list(
                    await session.scalars(
                        select(MeterDataSource.id).where(MeterDataSource.is_active.is_(True))
                    )
                )
            for source_id in source_ids:
                async with SessionFactory() as session:
                    source = await session.get(MeterDataSource, source_id)
                    if source is None:
                        continue
                    result = await sync_source(
                        session, source, request_timeout=settings.meter_sync_timeout_seconds
                    )
                    await session.commit()
                    logger.info("Meter source %s synced: %s", source_id, result.status)
        finally:
            await lock_conn.scalar(select(func.pg_advisory_unlock(_LOCK_KEY)))
            await lock_conn.commit()


async def _loop(interval_seconds: float) -> None:
    while True:
        try:
            await sync_all_sources()
        except Exception:
            logger.exception("Meter sync iteration failed")
        await asyncio.sleep(interval_seconds)


@contextlib.asynccontextmanager
async def meter_sync_worker() -> AsyncIterator[None]:
    settings = get_settings()
    if not settings.meter_sync_enabled:
        yield
        return
    task = asyncio.create_task(_loop(settings.meter_sync_interval_minutes * 60))
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
