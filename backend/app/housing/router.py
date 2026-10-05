from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.auth.deps import CurrentUser, ManagerUser, SessionDep
from app.core.pagination import Page, PageParams, page_params, paginate, paginate_rows
from app.housing import service
from app.housing.models import Building
from app.housing.schemas import (
    ApartmentCreate,
    ApartmentDetail,
    ApartmentRead,
    ApartmentUpdate,
    BuildingCreate,
    BuildingRead,
    BuildingUpdate,
    ResidentLink,
)
from app.housing.service import resident_apartment_ids

router = APIRouter(tags=["housing"])

Search = Annotated[str | None, Query(max_length=100)]


def _building_read(building: Building, apartments_count: int) -> BuildingRead:
    return BuildingRead.model_validate(building).model_copy(
        update={"apartments_count": apartments_count}
    )


# ---------- Дома ----------


@router.get("/buildings", response_model=Page[BuildingRead], summary="Дома")
async def list_buildings(
    session: SessionDep,
    user: CurrentUser,
    page: Annotated[PageParams, Depends(page_params)],
    search: Search = None,
) -> Page[BuildingRead]:
    ids = await resident_apartment_ids(session, user)
    rows, total = await paginate_rows(session, service.buildings_query(ids, search), page)
    items = [_building_read(building, count) for building, count in rows]
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post(
    "/buildings",
    response_model=BuildingRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить дом",
)
async def create_building(
    session: SessionDep, _: ManagerUser, data: BuildingCreate
) -> BuildingRead:
    building = await service.create_building(session, data)
    await session.commit()
    return BuildingRead.model_validate(building)


@router.get("/buildings/{building_id}", response_model=BuildingRead, summary="Дом")
async def get_building(session: SessionDep, user: CurrentUser, building_id: int) -> BuildingRead:
    return _building_read(*await service.get_building_with_count(session, user, building_id))


@router.patch("/buildings/{building_id}", response_model=BuildingRead, summary="Изменить дом")
async def update_building(
    session: SessionDep, user: ManagerUser, building_id: int, data: BuildingUpdate
) -> BuildingRead:
    building = await service.get_building(session, building_id)
    await service.update_building(session, building, data)
    await session.commit()
    return _building_read(*await service.get_building_with_count(session, user, building_id))


@router.delete(
    "/buildings/{building_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить дом"
)
async def delete_building(session: SessionDep, _: ManagerUser, building_id: int) -> Response:
    building = await service.get_building(session, building_id)
    await service.delete_building(session, building)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Помещения ----------


@router.get("/apartments", response_model=Page[ApartmentRead], summary="Помещения")
async def list_apartments(
    session: SessionDep,
    user: CurrentUser,
    page: Annotated[PageParams, Depends(page_params)],
    building_id: int | None = None,
    search: Search = None,
) -> Page[ApartmentRead]:
    ids = await resident_apartment_ids(session, user)
    stmt = service.apartments_query(ids, building_id=building_id, search=search)
    items, total = await paginate(session, stmt, page)
    return Page(
        items=[ApartmentRead.model_validate(a) for a in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "/apartments",
    response_model=ApartmentDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить помещение",
)
async def create_apartment(
    session: SessionDep, user: ManagerUser, data: ApartmentCreate
) -> ApartmentDetail:
    apartment = await service.create_apartment(session, data)
    await session.commit()
    apartment = await service.get_apartment_for_user(
        session, user, apartment.id, with_residents=True
    )
    return ApartmentDetail.model_validate(apartment)


@router.get("/apartments/{apartment_id}", response_model=ApartmentDetail, summary="Помещение")
async def get_apartment(
    session: SessionDep, user: CurrentUser, apartment_id: int
) -> ApartmentDetail:
    apartment = await service.get_apartment_for_user(
        session, user, apartment_id, with_residents=True
    )
    return ApartmentDetail.model_validate(apartment)


@router.patch(
    "/apartments/{apartment_id}", response_model=ApartmentDetail, summary="Изменить помещение"
)
async def update_apartment(
    session: SessionDep, user: ManagerUser, apartment_id: int, data: ApartmentUpdate
) -> ApartmentDetail:
    apartment = await service.get_apartment_for_user(
        session, user, apartment_id, with_residents=True
    )
    apartment = await service.update_apartment(session, apartment, data)
    await session.commit()
    return ApartmentDetail.model_validate(apartment)


@router.post(
    "/apartments/{apartment_id}/residents",
    response_model=ApartmentDetail,
    summary="Привязать жителя к помещению",
)
async def add_resident(
    session: SessionDep, user: ManagerUser, apartment_id: int, data: ResidentLink
) -> ApartmentDetail:
    apartment = await service.get_apartment_for_user(session, user, apartment_id)
    await service.add_resident(session, apartment, data.user_id)
    await session.commit()
    apartment = await service.get_apartment_for_user(
        session, user, apartment_id, with_residents=True
    )
    return ApartmentDetail.model_validate(apartment)


@router.delete(
    "/apartments/{apartment_id}/residents/{user_id}",
    response_model=ApartmentDetail,
    summary="Отвязать жителя от помещения",
)
async def remove_resident(
    session: SessionDep, user: ManagerUser, apartment_id: int, user_id: int
) -> ApartmentDetail:
    apartment = await service.get_apartment_for_user(session, user, apartment_id)
    await service.remove_resident(session, apartment, user_id)
    await session.commit()
    apartment = await service.get_apartment_for_user(
        session, user, apartment_id, with_residents=True
    )
    return ApartmentDetail.model_validate(apartment)
