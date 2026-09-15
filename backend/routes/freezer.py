"""Freezer / inventory of pre-cooked child portions (toddler backup plan)."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import FreezerPortion, Recipe, User
from services.audit import log_audit
from services.auth import get_current_user
from services.hass import notify_freezer_portion

router = APIRouter(prefix="/freezer", tags=["freezer"])


class FreezerPortionIn(BaseModel):
    recipe_id: Optional[int] = None
    label: Optional[str] = None
    portions: int = 1
    portion_type: str = "child"   # child | adult
    location: str = "Frys 1"
    notes: Optional[str] = None


@router.get("")
def list_portions(
    location: Optional[str] = None,
    recipe_id: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    query = select(FreezerPortion).where(FreezerPortion.household_id == user.household_id).order_by(FreezerPortion.saved_at.desc())
    if location:
        query = query.where(FreezerPortion.location == location)
    if recipe_id is not None:
        query = query.where(FreezerPortion.recipe_id == recipe_id)
    items = session.exec(query).all()
    # Attach recipe title where available
    result = []
    for p in items:
        recipe_title = None
        if p.recipe_id:
            recipe = session.get(Recipe, p.recipe_id)
            recipe_title = recipe.title if recipe else None
        result.append({**p.model_dump(), "recipe_title": recipe_title})
    return result


@router.post("")
async def create_portion(
    data: FreezerPortionIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if data.portions < 1:
        raise HTTPException(status_code=400, detail="portions måste vara minst 1")

    label = (data.label or "").strip()
    if not label and data.recipe_id:
        recipe = session.get(Recipe, data.recipe_id)
        if recipe:
            suffix = "barnportion" if data.portion_type == "child" else "portion"
            label = f"{recipe.title} ({suffix})"
    if not label:
        raise HTTPException(status_code=400, detail="label eller recipe_id krävs")

    portion = FreezerPortion(
        recipe_id=data.recipe_id,
        label=label,
        portions=data.portions,
        portion_type=data.portion_type,
        location=data.location,
        notes=data.notes,
        household_id=user.household_id,
    )
    session.add(portion)
    session.commit()
    session.refresh(portion)

    log_audit(session, user, "freezer.add", entity_type="freezer_portion",
              entity_id=portion.id,
              details={"label": label, "portions": data.portions,
                       "portion_type": data.portion_type, "location": data.location})

    # Fire-and-forget HA notification
    ha_delivered = await notify_freezer_portion({
        "event": "freezer_portion_added",
        "label": label,
        "portions": data.portions,
        "portion_type": data.portion_type,
        "location": data.location,
        "recipe_id": data.recipe_id,
        "saved_at": portion.saved_at.isoformat(),
        "user": user.name,
    })

    return {**portion.model_dump(), "ha_delivered": ha_delivered}


@router.put("/{portion_id}")
def update_portion(
    portion_id: int,
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    portion = session.get(FreezerPortion, portion_id)
    if not portion or portion.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Portion not found")
    changed = []
    for key, value in data.items():
        if hasattr(portion, key) and key not in ("id", "saved_at", "household_id"):
            setattr(portion, key, value)
            changed.append(key)
    session.commit()
    session.refresh(portion)
    log_audit(session, user, "freezer.update", entity_type="freezer_portion",
              entity_id=portion_id, details={"fields": changed})
    return portion


@router.delete("/{portion_id}")
async def consume_portion(
    portion_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Mark a portion as consumed (= remove). Also notifies HA."""
    portion = session.get(FreezerPortion, portion_id)
    if not portion or portion.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Portion not found")

    await notify_freezer_portion({
        "event": "freezer_portion_consumed",
        "label": portion.label,
        "portions": portion.portions,
        "location": portion.location,
        "user": user.name,
    })

    log_audit(session, user, "freezer.consume", entity_type="freezer_portion",
              entity_id=portion_id,
              details={"label": portion.label, "portions": portion.portions,
                       "location": portion.location})

    session.delete(portion)
    session.commit()
    return {"ok": True}
