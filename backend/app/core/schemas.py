from pydantic import BaseModel, ConfigDict


class Schema(BaseModel):
    """Базовая схема ответа API: строится из ORM-объектов."""

    model_config = ConfigDict(from_attributes=True)


class ErrorResponse(BaseModel):
    detail: str
    code: str
