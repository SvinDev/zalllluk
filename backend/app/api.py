from fastapi import APIRouter

from app.auth.router import router as auth_router
from app.billing.router import router as billing_router
from app.housing.router import router as housing_router
from app.integrations.router import router as integrations_router
from app.meters.router import router as meters_router
from app.passes.router import router as passes_router
from app.tickets.router import router as tickets_router
from app.users.router import router as users_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(housing_router)
api_router.include_router(meters_router)
api_router.include_router(billing_router)
api_router.include_router(tickets_router)
api_router.include_router(passes_router)
api_router.include_router(integrations_router)
