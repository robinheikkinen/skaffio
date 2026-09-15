"""Inkorg (Inbox) — hanterar inkommande recept-URL:er som väntar på granskning.

Flöde:
  POST /api/inbox           → queua en URL för import
  GET  /api/inbox           → lista inkorgen (filter: status)
  GET  /api/inbox/{id}      → hämta enskilt inkorg-recept
  PUT  /api/inbox/{id}      → redigera innan godkännande
  POST /api/inbox/{id}/approve  → godkänn → skapa Recipe i biblioteket
  DELETE /api/inbox/{id}    → avvisa/ta bort
  GET  /api/inbox/count     → antal i status=review (för badge i UI)
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import InboxRecipe, Recipe, User
from services.audit import log_audit
from services.auth import get_current_user
from services.import_queue import enqueue

router = APIRouter(prefix="/inbox", tags=["inbox"])


@router.post("")
async def create_inbox_item(
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    url = (data.get("url") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Ogiltig URL")

    item = InboxRecipe(
        url=url,
        title=data.get("title", "").strip(),
        status="pending",
        household_id=user.household_id,
    )
    session.add(item)
    session.commit()
    session.refresh(item)

    await enqueue(item.id)
    log_audit(session, user, "inbox.queue", details={"url": url, "inbox_id": item.id})
    return {"id": item.id, "status": item.status, "url": item.url}


@router.get("/count")
def inbox_count(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    items = session.exec(
        select(InboxRecipe)
        .where(InboxRecipe.household_id == user.household_id)
        .where(InboxRecipe.status == "review")
    ).all()
    return {"count": len(items)}


@router.get("")
def list_inbox(
    status: str | None = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = select(InboxRecipe).where(InboxRecipe.household_id == user.household_id)
    if status:
        q = q.where(InboxRecipe.status == status)
    items = session.exec(q.order_by(InboxRecipe.created_at.desc())).all()
    return items


@router.get("/{item_id}")
def get_inbox_item(
    item_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = session.get(InboxRecipe, item_id)
    if not item or item.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Ej hittad")
    return item


@router.put("/{item_id}")
def update_inbox_item(
    item_id: int,
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = session.get(InboxRecipe, item_id)
    if not item or item.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Ej hittad")

    allowed = {"title", "description", "ingredients", "instructions",
               "servings", "prep_time", "cook_time", "cover_image"}
    for key, val in data.items():
        if key in allowed:
            setattr(item, key, val)

    session.commit()
    session.refresh(item)
    log_audit(session, user, "inbox.update", entity_id=item_id)
    return item


class ApproveIn(BaseModel):
    visibility: str = "private"


@router.post("/{item_id}/approve")
def approve_inbox_item(
    item_id: int,
    data: ApproveIn = ApproveIn(),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = session.get(InboxRecipe, item_id)
    if not item or item.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Ej hittad")
    if item.status not in ("review", "error"):
        raise HTTPException(status_code=400, detail=f"Kan inte godkänna status={item.status}")

    # Upphovsrättsspärr: inbox-recept är alltid importerade (source_url = item.url)
    # och får därför aldrig bli publika — tvinga private oavsett vad klienten skickar.
    visibility = "private" if item.url else (
        data.visibility if data.visibility in ("public", "private") else "private"
    )
    recipe = Recipe(
        title=item.title or "Namnlöst recept",
        description=item.description or "",
        ingredients=item.ingredients or "[]",
        instructions=item.instructions or "",
        servings=item.servings or 4,
        prep_time=item.prep_time,
        cook_time=item.cook_time,
        cover_image=item.cover_image,
        source_url=item.url,
        source_type="url",
        visibility=visibility,
        household_id=user.household_id,
    )
    session.add(recipe)
    session.flush()

    item.status = "approved"
    item.approved_recipe_id = recipe.id
    item.processed_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(recipe)

    log_audit(session, user, "inbox.approve",
              entity_type="recipe", entity_id=recipe.id,
              details={"inbox_id": item_id, "url": item.url})
    return {"recipe_id": recipe.id, "title": recipe.title}


@router.delete("/{item_id}")
def delete_inbox_item(
    item_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = session.get(InboxRecipe, item_id)
    if not item or item.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Ej hittad")
    session.delete(item)
    session.commit()
    log_audit(session, user, "inbox.delete", entity_id=item_id, details={"url": item.url})
    return {"ok": True}
