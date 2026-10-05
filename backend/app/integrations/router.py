from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from fastapi.security import APIKeyHeader
from sqlalchemy import select

from app.auth.deps import AdminUser, SessionDep
from app.core.config import get_settings
from app.integrations import service
from app.integrations.models import ApiKey, MeterDataSource
from app.integrations.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyRead,
    DataSourceCreate,
    DataSourceRead,
    DataSourceUpdate,
    IngestRequest,
    SyncResult,
)
from app.meters.models import ReadingSource
from app.meters.schemas import IngestReport
from app.meters.service import ingest_external_readings

router = APIRouter(prefix="/integrations", tags=["integrations"])

_api_key_header = APIKeyHeader(
    name="X-API-Key", auto_error=False, description="Ключ из раздела «Интеграции»"
)


@router.post(
    "/readings",
    response_model=IngestReport,
    summary="Приём показаний от внешней системы (push)",
    description=(
        "Пакетная загрузка показаний до 1000 записей. Прибор определяется по `external_id` "
        "или `serial_number`. Повторная отправка того же показания учитывается как дубль, "
        "а не ошибка, поэтому запрос безопасно ретраить."
    ),
)
async def ingest_readings(
    session: SessionDep,
    data: IngestRequest,
    raw_key: Annotated[str | None, Depends(_api_key_header)],
) -> IngestReport:
    await service.authenticate_api_key(session, raw_key)
    report = await ingest_external_readings(session, data.readings, ReadingSource.API)
    await session.commit()
    return report


# ---------- API-ключи ----------


@router.get("/api-keys", response_model=list[ApiKeyRead], summary="API-ключи")
async def list_api_keys(session: SessionDep, _: AdminUser) -> list[ApiKeyRead]:
    keys = await session.scalars(select(ApiKey).order_by(ApiKey.created_at.desc()))
    return [ApiKeyRead.model_validate(k) for k in keys]


@router.post(
    "/api-keys",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Выпустить API-ключ",
)
async def create_api_key(
    session: SessionDep, actor: AdminUser, data: ApiKeyCreate
) -> ApiKeyCreated:
    api_key, raw_key = await service.create_api_key(session, data.name, actor)
    await session.commit()
    return ApiKeyCreated(**ApiKeyRead.model_validate(api_key).model_dump(), key=raw_key)


@router.post("/api-keys/{key_id}/revoke", response_model=ApiKeyRead, summary="Отозвать API-ключ")
async def revoke_api_key(session: SessionDep, _: AdminUser, key_id: int) -> ApiKeyRead:
    api_key = await service.get_api_key(session, key_id)
    api_key.is_active = False
    await session.commit()
    return ApiKeyRead.model_validate(api_key)


# ---------- Источники (pull) ----------


@router.get("/sources", response_model=list[DataSourceRead], summary="Источники показаний")
async def list_sources(session: SessionDep, _: AdminUser) -> list[DataSourceRead]:
    sources = await session.scalars(select(MeterDataSource).order_by(MeterDataSource.name))
    return [DataSourceRead.model_validate(s) for s in sources]


@router.post(
    "/sources",
    response_model=DataSourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Подключить источник показаний",
)
async def create_source(
    session: SessionDep, _: AdminUser, data: DataSourceCreate
) -> DataSourceRead:
    source = await service.create_source(session, data)
    await session.commit()
    return DataSourceRead.model_validate(source)


@router.patch("/sources/{source_id}", response_model=DataSourceRead, summary="Изменить источник")
async def update_source(
    session: SessionDep, _: AdminUser, source_id: int, data: DataSourceUpdate
) -> DataSourceRead:
    source = await service.get_source(session, source_id)
    await service.update_source(session, source, data)
    await session.commit()
    return DataSourceRead.model_validate(source)


@router.delete(
    "/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить источник"
)
async def delete_source(session: SessionDep, _: AdminUser, source_id: int) -> Response:
    source = await service.get_source(session, source_id)
    await session.delete(source)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sources/{source_id}/sync", response_model=SyncResult, summary="Опросить источник сейчас"
)
async def sync_source(session: SessionDep, _: AdminUser, source_id: int) -> SyncResult:
    source = await service.get_source(session, source_id)
    result = await service.sync_source(
        session, source, request_timeout=get_settings().meter_sync_timeout_seconds
    )
    await session.commit()
    return result
