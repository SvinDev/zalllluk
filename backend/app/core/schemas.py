from pydantic import BaseModel, ConfigDict


class Schema(BaseModel):
    """Базовая схема ответа API: строится из ORM-объектов.

    Поля со значением по умолчанию в ответе присутствуют всегда — помечаем их
    обязательными в OpenAPI, чтобы сгенерированный TS-клиент не делал их optional.
    """

    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )


class ErrorResponse(BaseModel):
    detail: str
    code: str
