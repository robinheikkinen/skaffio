"""Collections (folders) routes for organizing recipes."""

from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select, or_

from database import get_session
from models import Collection, RecipeCollection, Recipe, User
from services.auth import get_current_user

router = APIRouter(prefix="/collections", tags=["collections"])


# ─── Schemas ───────────────────────────────────────────────

class CollectionIn(BaseModel):
    name: str
    description: Optional[str] = None
    icon: str = "📁"


class CollectionOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    icon: str
    created_at: datetime


class RecipeBrief(BaseModel):
    id: int
    title: str
    cover_image: Optional[str]
    source_type: str


def _serialize_collection(c: Collection) -> CollectionOut:
    return CollectionOut(
        id=c.id, name=c.name, description=c.description,
        icon=c.icon, created_at=c.created_at,
    )


# ─── Helpers ───────────────────────────────────────────────

def _ensure_owner(collection: Collection, user: User) -> None:
    """All collections are user-scoped (simplified: single-user app)."""
    pass


# ─── Routes ────────────────────────────────────────────────

@router.post("", response_model=CollectionOut)
def create_collection(
    data: CollectionIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Check duplicate name within this household
    existing = session.exec(
        select(Collection)
        .where(Collection.name == data.name)
        .where(Collection.household_id == user.household_id)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Samlingen finns redan")

    coll = Collection(name=data.name, description=data.description, icon=data.icon,
                      household_id=user.household_id)
    session.add(coll)
    session.commit()
    session.refresh(coll)
    return _serialize_collection(coll)


@router.get("", response_model=list[CollectionOut])
def list_collections(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    collections = session.exec(
        select(Collection)
        .where(Collection.household_id == user.household_id)
        .order_by(Collection.created_at.desc())
    ).all()
    return [_serialize_collection(c) for c in collections]


@router.get("/{collection_id}", response_model=CollectionOut)
def get_collection(
    collection_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    collection = session.get(Collection, collection_id)
    if not collection or collection.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Samlingen hittades inte")
    return _serialize_collection(collection)


@router.get("/{collection_id}/recipes", response_model=list[RecipeBrief])
def get_collection_recipes(
    collection_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    collection = session.get(Collection, collection_id)
    if not collection or collection.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Samlingen hittades inte")

    junctions = session.exec(
        select(RecipeCollection).where(RecipeCollection.collection_id == collection_id)
    ).all()

    recipe_ids = [jc.recipe_id for jc in junctions]
    if not recipe_ids:
        return []

    recipes = session.exec(
        select(Recipe).where(
            Recipe.id.in_(recipe_ids),
            (Recipe.household_id == user.household_id) | (Recipe.visibility == "public"),
        )
    ).all()
    return [
        RecipeBrief(
            id=r.id, title=r.title,
            cover_image=r.cover_image, source_type=r.source_type,
        )
        for r in recipes
    ]


@router.post("/{collection_id}/recipes/{recipe_id}", response_model=RecipeBrief)
def add_recipe_to_collection(
    collection_id: int,
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    collection = session.get(Collection, collection_id)
    if not collection or collection.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Samlingen hittades inte")

    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet hittades inte")
    if recipe.household_id != user.household_id and recipe.visibility != "public":
        raise HTTPException(status_code=403, detail="Receptet tillhör inte ditt hushåll")

    # Check if already exists
    existing = session.exec(
        select(RecipeCollection).where(
            RecipeCollection.collection_id == collection_id,
            RecipeCollection.recipe_id == recipe_id,
        )
    ).first()
    if existing:
        return RecipeBrief(
            id=recipe.id, title=recipe.title,
            cover_image=recipe.cover_image, source_type=recipe.source_type,
        )

    jc = RecipeCollection(collection_id=collection_id, recipe_id=recipe_id)
    session.add(jc)
    session.commit()

    return RecipeBrief(
        id=recipe.id, title=recipe.title,
        cover_image=recipe.cover_image, source_type=recipe.source_type,
    )


@router.delete("/{collection_id}/recipes/{recipe_id}")
def remove_recipe_from_collection(
    collection_id: int,
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    collection = session.get(Collection, collection_id)
    if not collection or collection.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Samlingen hittades inte")
    jc = session.exec(
        select(RecipeCollection).where(
            RecipeCollection.collection_id == collection_id,
            RecipeCollection.recipe_id == recipe_id,
        )
    ).first()
    if jc:
        session.delete(jc)
        session.commit()
    return {"ok": True}


@router.delete("/{collection_id}")
def delete_collection(
    collection_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    collection = session.get(Collection, collection_id)
    if not collection or collection.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Samlingen hittades inte")

    # Remove junctions
    junctions = session.exec(
        select(RecipeCollection).where(RecipeCollection.collection_id == collection_id)
    ).all()
    for jc in junctions:
        session.delete(jc)

    session.delete(collection)
    session.commit()
    return {"ok": True}