import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_JWT_ALGORITHM = "HS256"
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: int) -> tuple[str, int]:
    """Возвращает токен и время его жизни в секундах."""
    settings = get_settings()
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "iat": now, "exp": now + ttl, "type": "access"}
    token = jwt.encode(payload, settings.secret_key, algorithm=_JWT_ALGORITHM)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[_JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None


API_KEY_PREFIX = "ukapi"


def generate_api_key() -> tuple[str, str, str]:
    """Создаёт ключ интеграции: (полный ключ, публичный префикс, sha256-хэш).

    Ключ высокоэнтропийный, поэтому медленный KDF не нужен — достаточно sha256.
    Полный ключ показывается пользователю один раз и нигде не хранится.
    """
    prefix = secrets.token_hex(4)
    key = f"{API_KEY_PREFIX}_{prefix}_{secrets.token_urlsafe(32)}"
    return key, prefix, hash_api_key(key)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()
