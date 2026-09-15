"""Per-user favoritering av recept."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import Favorite, Recipe, User
from services.audit import log_audit
from services.auth import get_current_user

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.get("")
def list_my_favorites(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Returnera bara recipe_id:n för inloggad user — frontend matchar mot full recipe-listan."""
    rows = session.exec(
        select(Favorite.recipe_id).where(Favorite.user_id == user.id)
    ).all()
    return {"recipe_ids": list(rows)}


@router.post("/{recipe_id}")
def add_favorite(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")

    existing = session.get(Favorite, (user.id, recipe_id))
    if existing:
        return {"ok": True, "already_favorited": True}

    fav = Favorite(user_id=user.id, recipe_id=recipe_id)
    session.add(fav)
    session.commit()
    log_audit(session, user, "favorite.add", entity_type="recipe", entity_id=recipe_id,
              details={"title": recipe.title})
    return {"ok": True, "added": True}


@router.delete("/{recipe_id}")
def remove_favorite(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    fav = session.get(Favorite, (user.id, recipe_id))
    if not fav:
        return {"ok": True, "was_favorited": False}
    session.delete(fav)
    session.commit()
    log_audit(session, user, "favorite.remove", entity_type="recipe", entity_id=recipe_id)
    return {"ok": True, "removed": True}
