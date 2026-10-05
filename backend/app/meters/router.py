from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import HouseholdUser, ManagerUser, SessionDep, StaffUser
from app.core.pagination import Page, PageParams, page_params, paginate, paginate_rows
from app.housing.service import resident_apartment_ids
from app.meters import service
from app.meters.models import Meter, MeterKind, ReadingSource
from app.meters.schemas import (
    LastReading,
    MeterCreate,
    MeterRead,
    MeterUpdate,
    ReadingCreate,
    ReadingJournalItem,
    ReadingRead,
)

router = APIRouter(tags=["meters"])


async def _meters_with_last_reading(session: AsyncSession, meters: list[Meter]) -> list[MeterRead]:
    last = await service.last_readings(session, [m.id for m in meters])
    return [
        MeterRead.model_validate(m).model_copy(
            update={
                "last_reading": LastReading.model_validate(last[m.id]) if m.id in last else None
            }
        )
        for m in meters
    ]


@router.get("/meters", response_model=Page[MeterRead], summary="Счётчики")
async def list_meters(
    session: SessionDep,
    user: HouseholdUser,
    page: Annotated[PageParams, Depends(page_params)],
    apartment_id: int | None = None,
    building_id: int | None = None,
    kind: MeterKind | None = None,
    is_active: bool | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    verification_due_before: Annotated[
        date | None, Query(description="Срок поверки наступает не позже даты")
    ] = None,
    no_reading_since: Annotated[
        date | None, Query(description="Нет показаний начиная с даты (должники по показаниям)")
    ] = None,
) -> Page[MeterRead]:
    ids = await resident_apartment_ids(session, user)
    stmt = service.meters_query(
        ids,
        apartment_id=apartment_id,
        building_id=building_id,
        kind=kind,
        is_active=is_active,
        search=search,
        verification_due_before=verification_due_before,
        no_reading_since=no_reading_since,
    )
    meters, total = await paginate(session, stmt, page)
    items = await _meters_with_last_reading(session, meters)
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post(
    "/meters",
    response_model=MeterRead,
    status_code=status.HTTP_201_CREATED,
    summary="Зарегистрировать счётчик",
)
async def create_meter(session: SessionDep, user: ManagerUser, data: MeterCreate) -> MeterRead:
    meter = await service.create_meter(session, data)
    await session.commit()
    meter = await service.get_meter_for_user(session, user, meter.id)
    return MeterRead.model_validate(meter)


@router.get("/meters/{meter_id}", response_model=MeterRead, summary="Счётчик")
async def get_meter(session: SessionDep, user: HouseholdUser, meter_id: int) -> MeterRead:
    meter = await service.get_meter_for_user(session, user, meter_id)
    return (await _meters_with_last_reading(session, [meter]))[0]


@router.patch("/meters/{meter_id}", response_model=MeterRead, summary="Изменить счётчик")
async def update_meter(
    session: SessionDep, user: ManagerUser, meter_id: int, data: MeterUpdate
) -> MeterRead:
    meter = await service.get_meter_for_user(session, user, meter_id)
    await service.update_meter(session, meter, data)
    await session.commit()
    return (await _meters_with_last_reading(session, [meter]))[0]


@router.delete(
    "/meters/{meter_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить счётчик"
)
async def delete_meter(session: SessionDep, user: ManagerUser, meter_id: int) -> Response:
    meter = await service.get_meter_for_user(session, user, meter_id)
    await service.delete_meter(session, meter)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/meters/{meter_id}/readings", response_model=Page[ReadingRead], summary="История показаний"
)
async def list_meter_readings(
    session: SessionDep,
    user: HouseholdUser,
    meter_id: int,
    page: Annotated[PageParams, Depends(page_params)],
) -> Page[ReadingRead]:
    await service.get_meter_for_user(session, user, meter_id)
    rows, total = await paginate_rows(session, service.readings_query(meter_id), page)
    items = [
        ReadingRead.model_validate(reading).model_copy(update={"consumption": consumption})
        for reading, consumption in rows
    ]
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post(
    "/meters/{meter_id}/readings",
    response_model=ReadingRead,
    status_code=status.HTTP_201_CREATED,
    summary="Передать показания",
)
async def submit_reading(
    session: SessionDep, user: HouseholdUser, meter_id: int, data: ReadingCreate
) -> ReadingRead:
    meter = await service.get_meter_for_user(session, user, meter_id)
    reading = await service.add_reading(
        session,
        meter,
        value=data.value,
        # Житель передаёт показания «на сейчас»: задним числом можно было бы
        # перекинуть расход между уже начисленными периодами.
        taken_at=data.taken_at if user.is_staff else None,
        source=ReadingSource.STAFF if user.is_staff else ReadingSource.RESIDENT,
        submitted_by=user,
    )
    await session.commit()
    return ReadingRead.model_validate(reading)


@router.get(
    "/readings", response_model=Page[ReadingJournalItem], summary="Журнал показаний (для УК)"
)
async def readings_journal(
    session: SessionDep,
    _: StaffUser,
    page: Annotated[PageParams, Depends(page_params)],
    building_id: int | None = None,
    kind: MeterKind | None = None,
    source: ReadingSource | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Page[ReadingJournalItem]:
    stmt = service.journal_query(
        building_id=building_id, kind=kind, source=source, date_from=date_from, date_to=date_to
    )
    rows, total = await paginate_rows(session, stmt, page)
    items = [
        ReadingJournalItem.model_validate(reading).model_copy(update={"consumption": consumption})
        for reading, consumption in rows
    ]
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.delete(
    "/readings/{reading_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить ошибочное показание",
)
async def delete_reading(session: SessionDep, _: ManagerUser, reading_id: int) -> Response:
    reading = await service.get_reading(session, reading_id)
    await session.delete(reading)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
