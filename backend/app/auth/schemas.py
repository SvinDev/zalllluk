from pydantic import BaseModel, Field

from app.housing.schemas import ApartmentRead
from app.users.schemas import Email, Password, UserRead


class LoginRequest(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead


class Profile(UserRead):
    apartments: list[ApartmentRead] = Field(default_factory=list)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: Password
