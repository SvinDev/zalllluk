"""Служебные команды.

python -m app.cli create-admin --email admin@uk.ru --name "Иван Иванов"
python -m app.cli seed-demo
python -m app.cli openapi > ../frontend/openapi.json
"""

import argparse
import asyncio
import getpass
import json
import sys

from sqlalchemy import select

from app.core.database import SessionFactory, engine
from app.core.errors import AppError
from app.housing.models import Building
from app.users.models import UserRole
from app.users.schemas import UserCreate
from app.users.service import create_user


async def _create_admin(email: str, name: str, password: str) -> None:
    async with SessionFactory() as session:
        user = await create_user(
            session,
            None,
            UserCreate(email=email, full_name=name, role=UserRole.ADMIN, password=password),
        )
        await session.commit()
        print(f"Администратор создан: {user.email} (id={user.id})")


async def _seed_demo() -> None:
    from app.demo import seed  # импорт здесь: демо-данные не нужны в рабочем коде

    async with SessionFactory() as session:
        if await session.scalar(select(Building.id).limit(1)) is not None:
            raise AppError("База не пустая — демо-данные загружаются только в чистую БД")
        summary = await seed(session)
        await session.commit()
    print(summary)


async def _run(coro: object) -> None:
    try:
        await coro  # type: ignore[misc]
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    admin = commands.add_parser("create-admin", help="Создать администратора УК")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", default="Администратор")
    admin.add_argument("--password", help="Если не указан — будет запрошен интерактивно")

    commands.add_parser("seed-demo", help="Заполнить пустую БД демонстрационными данными")
    commands.add_parser("openapi", help="Вывести OpenAPI-схему (для генерации клиента фронтенда)")

    args = parser.parse_args(argv)
    try:
        if args.command == "create-admin":
            password = args.password or getpass.getpass("Пароль (мин. 8 символов): ")
            asyncio.run(_run(_create_admin(args.email, args.name, password)))
        elif args.command == "seed-demo":
            asyncio.run(_run(_seed_demo()))
        elif args.command == "openapi":
            from app.main import app

            print(json.dumps(app.openapi(), ensure_ascii=False, indent=2))
    except AppError as exc:
        print(f"Ошибка: {exc.message}", file=sys.stderr)
        return 1
    except ValueError as exc:  # ошибки валидации pydantic
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
