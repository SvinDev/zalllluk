from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


@dataclass(frozen=True, slots=True)
class PageParams:
    limit: int
    offset: int


def page_params(
    limit: int = Query(50, ge=1, le=500, description="Размер страницы"),
    offset: int = Query(0, ge=0, description="Смещение"),
) -> PageParams:
    return PageParams(limit=limit, offset=offset)


async def count_rows(session: AsyncSession, stmt: Select[Any]) -> int:
    total = await session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    return total or 0


async def paginate(
    session: AsyncSession, stmt: Select[Any], params: PageParams
) -> tuple[list[Any], int]:
    """Страница ORM-объектов (первая колонка выборки) и общее количество."""
    total = await count_rows(session, stmt)
    rows = await session.scalars(stmt.limit(params.limit).offset(params.offset))
    return list(rows.unique()), total


async def paginate_rows(
    session: AsyncSession, stmt: Select[Any], params: PageParams
) -> tuple[list[Any], int]:
    """Как paginate, но возвращает строки целиком — для выборок с вычисляемыми колонками."""
    total = await count_rows(session, stmt)
    result = await session.execute(stmt.limit(params.limit).offset(params.offset))
    return list(result.all()), total
