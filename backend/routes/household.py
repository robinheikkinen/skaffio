"""Household management — get info, join by invite code, rename."""

import secrets as _secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import Household, User
from services.audit import log_audit
from services.auth import get_current_user, require_admin

router = APIRouter(prefix="/household", tags=["household"])


@router.get("")
def get_household(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Returnerar info om användarens hushåll + inbjudningskod."""
    if not user.household_id:
        raise HTTPException(status_code=404, detail="Du tillhör inget hushåll")
    household = session.get(Household, user.household_id)
    if not household:
        raise HTTPException(status_code=404, detail="Hushållet finns inte")

    members = session.exec(
        select(User).where(User.household_id == household.id, User.is_active == True)
    ).all()

    return {
        "id": household.id,
        "name": household.name,
        "invite_code": household.invite_code,
        "members": [{"id": m.id, "name": m.name, "email": m.email, "role": m.role} for m in members],
    }


@router.post("/regenerate-invite")
def regenerate_invite(
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
):
    """Generera ny inbjudningskod (ogiltigförklarar den gamla). Admin-only."""
    if not user.household_id:
        raise HTTPException(status_code=404, detail="Du tillhör inget hushåll")
    household = session.get(Household, user.household_id)
    if not household:
        raise HTTPException(status_code=404, detail="Hushållet finns inte")
    household.invite_code = _secrets.token_urlsafe(8)
    session.commit()
    log_audit(session, user, "household.regenerate_invite", entity_type="household",
              entity_id=household.id)
    return {"invite_code": household.invite_code}


class JoinIn(BaseModel):
    invite_code: str


@router.post("/join")
def join_household(
    data: JoinIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Gå med i ett hushåll med inbjudningskod."""
    code = (data.invite_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Inbjudningskod saknas")

    household = session.exec(
        select(Household).where(Household.invite_code == code)
    ).first()
    if not household:
        raise HTTPException(status_code=404, detail="Ogiltig inbjudningskod")

    if user.household_id == household.id:
        return {"ok": True, "message": "Du är redan med i det här hushållet"}

    old_household_id = user.household_id
    user.household_id = household.id
    session.commit()

    log_audit(session, user, "household.join", entity_type="household",
              entity_id=household.id,
              details={"from_household": old_household_id})

    return {"ok": True, "household_id": household.id, "household_name": household.name}


class SchoolMenuIn(BaseModel):
    url: str
    display_name: str = ""


@router.put("/school-menu")
def set_school_menu(
    data: SchoolMenuIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Spara/uppdatera förskole-URL på hushållet. Alla hushållsmedlemmar kan ändra."""
    url = (data.url or "").strip()
    if url and not url.startswith("https://skolmaten.se/"):
        raise HTTPException(status_code=400, detail="URL måste börja med https://skolmaten.se/")
    if not user.household_id:
        raise HTTPException(status_code=404, detail="Du tillhör inget hushåll")
    household = session.get(Household, user.household_id)
    if not household:
        raise HTTPException(status_code=404, detail="Hushållet finns inte")
    household.school_menu_url = url or None
    household.school_display_name = (data.display_name or "").strip() or None
    session.commit()
    log_audit(session, user, "household.set_school_menu", entity_type="household",
              entity_id=household.id, details={"url": url})
    return {"ok": True, "school_menu_url": household.school_menu_url}


class RenameIn(BaseModel):
    name: str


@router.put("/rename")
def rename_household(
    data: RenameIn,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
):
    """Byt namn på hushållet. Admin-only."""
    name = (data.name or "").strip()
    if not name or len(name) > 50:
        raise HTTPException(status_code=400, detail="Namn måste vara 1-50 tecken")
    if not user.household_id:
        raise HTTPException(status_code=404, detail="Du tillhör inget hushåll")
    household = session.get(Household, user.household_id)
    if not household:
        raise HTTPException(status_code=404, detail="Hushållet finns inte")
    household.name = name
    session.commit()
    log_audit(session, user, "household.rename", entity_type="household",
              entity_id=household.id, details={"name": name})
    return {"ok": True, "name": household.name}
