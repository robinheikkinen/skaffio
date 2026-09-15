from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import CalorieLog, Recipe
from services.auth import get_current_user as current_user

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


class LogCreate(BaseModel):
    recipe_id: int
    servings: float = 1.0
    log_date: Optional[date] = None   # default: today


class LogOut(BaseModel):
    id: int
    recipe_id: Optional[int]
    recipe_title: str
    servings: float
    calories: Optional[int]
    protein: Optional[float]
    carbs: Optional[float]
    fat: Optional[float]
    log_date: date
    logged_at: datetime


@router.post("/log", response_model=LogOut)
def log_meal(
    body: LogCreate,
    user=Depends(current_user),
    session: Session = Depends(get_session),
):
    recipe = session.get(Recipe, body.recipe_id)
    if not recipe:
        raise HTTPException(404, "Recept hittades inte")
    if recipe.household_id != user.household_id and recipe.visibility != "public":
        raise HTTPException(403, "Åtkomst nekad")

    s = body.servings
    entry = CalorieLog(
        user_id=user.id,
        household_id=user.household_id,
        recipe_id=recipe.id,
        recipe_title=recipe.title,
        servings=s,
        calories=round(recipe.calories * s) if recipe.calories else None,
        protein=round(recipe.protein * s, 1) if recipe.protein else None,
        carbs=round(recipe.carbs * s, 1) if recipe.carbs else None,
        fat=round(recipe.fat * s, 1) if recipe.fat else None,
        log_date=body.log_date or date.today(),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _to_out(entry)


@router.get("/log")
def get_log(
    log_date: Optional[date] = None,
    user=Depends(current_user),
    session: Session = Depends(get_session),
):
    target = log_date or date.today()
    rows = session.exec(
        select(CalorieLog)
        .where(CalorieLog.household_id == user.household_id)
        .where(CalorieLog.log_date == target)
        .order_by(CalorieLog.logged_at)
    ).all()

    entries = [_to_out(r) for r in rows]
    total_kcal = sum(e["calories"] for e in entries if e["calories"])
    total_protein = round(sum(e["protein"] for e in entries if e["protein"]), 1)
    total_carbs = round(sum(e["carbs"] for e in entries if e["carbs"]), 1)
    total_fat = round(sum(e["fat"] for e in entries if e["fat"]), 1)

    return {
        "date": target.isoformat(),
        "entries": entries,
        "total_calories": total_kcal,
        "total_protein": total_protein,
        "total_carbs": total_carbs,
        "total_fat": total_fat,
    }


@router.delete("/log/{entry_id}", status_code=204)
def delete_log(
    entry_id: int,
    user=Depends(current_user),
    session: Session = Depends(get_session),
):
    entry = session.get(CalorieLog, entry_id)
    if not entry:
        raise HTTPException(404, "Post hittades inte")
    if entry.household_id != user.household_id:
        raise HTTPException(403, "Åtkomst nekad")
    session.delete(entry)
    session.commit()


def _to_out(e: CalorieLog) -> dict:
    return {
        "id": e.id,
        "recipe_id": e.recipe_id,
        "recipe_title": e.recipe_title,
        "servings": e.servings,
        "calories": e.calories,
        "protein": e.protein,
        "carbs": e.carbs,
        "fat": e.fat,
        "log_date": e.log_date.isoformat(),
        "logged_at": e.logged_at.isoformat(),
    }
