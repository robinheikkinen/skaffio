import hashlib
import hmac
import os
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlmodel import Session, select
from database import get_session
from models import Household, MealPlanEntry, Recipe, User
from services.audit import log_audit
from services.auth import get_current_user

router = APIRouter(prefix="/mealplan", tags=["mealplan"])

# ─── iCal-feed (publik prenumeration mot Google Calendar etc.) ───────

_CAL_SECRET = (os.getenv("JWT_SECRET", "skaffio-default-cal-secret") + "::calendar").encode()


def _cal_token_for_user(user_id: int) -> str:
    """Deterministisk per-user token för iCal-prenumeration.
    Använder JWT_SECRET som basis — token ändras om secret roteras."""
    return hmac.new(_CAL_SECRET, str(user_id).encode(), hashlib.sha256).hexdigest()[:24]


@router.get("/ical-url")
def get_ical_url(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Returnerar URL till användarens iCal-feed."""
    import secrets as _sec
    if not user.ical_token:
        user.ical_token = _sec.token_urlsafe(16)
        session.commit()
    return {"token": user.ical_token, "path": f"/mealplan/ical/{user.ical_token}.ics"}


@router.get("/ical/{token}.ics")
def ical_feed(
    token: str,
    session: Session = Depends(get_session),
):
    """Publik endpoint — kräver INGEN auth. Direkt DB-uppslag på ical_token."""
    matched = session.exec(select(User).where(User.ical_token == token)).first()
    if not matched:
        raise HTTPException(status_code=404, detail="Ogiltig kalender-token")

    start = date.today() - timedelta(days=30)
    end = date.today() + timedelta(days=90)
    entries = session.exec(
        select(MealPlanEntry)
        .where(MealPlanEntry.household_id == matched.household_id)
        .where(MealPlanEntry.date >= start)
        .where(MealPlanEntry.date <= end)
    ).all()

    # Approx-tider per meal_type
    times = {
        "breakfast": ("08:00", "08:30"),
        "lunch":     ("12:00", "13:00"),
        "dinner":    ("18:00", "19:00"),
        "snack":     ("15:00", "15:30"),
    }
    labels = {
        "breakfast": "🥣 Frukost",
        "lunch":     "🥗 Lunch",
        "dinner":    "🍲 Middag",
        "snack":     "🍎 Mellanmål",
    }

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Skaffio//Meal Plan//SV",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Skaffio måltidsplan",
        "X-WR-TIMEZONE:Europe/Stockholm",
    ]
    for e in entries:
        recipe = session.get(Recipe, e.recipe_id)
        if not recipe:
            continue
        date_str = e.date.strftime("%Y%m%d")
        start_t, end_t = times.get(e.meal_type, ("18:00", "19:00"))
        dtstart = f"{date_str}T{start_t.replace(':', '')}00"
        dtend = f"{date_str}T{end_t.replace(':', '')}00"
        label = labels.get(e.meal_type, "Måltid")
        title = f"{label}: {recipe.title}"
        desc_parts = [f"{e.servings} portioner"]
        if e.notes:
            desc_parts.append(e.notes)
        if recipe.source_url:
            desc_parts.append(f"Recept: {recipe.source_url}")
        # iCal description escape
        desc = "\\n".join(desc_parts).replace(",", "\\,").replace(";", "\\;")
        uid = f"skaffio-{e.id}@skaffio.local"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART;TZID=Europe/Stockholm:{dtstart}",
            f"DTEND;TZID=Europe/Stockholm:{dtend}",
            f"SUMMARY:{title}",
            f"DESCRIPTION:{desc}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")

    return Response(
        content="\r\n".join(lines),
        media_type="text/calendar; charset=utf-8",
        headers={"Cache-Control": "max-age=300"},  # 5 min cache
    )


@router.get("/preschool-menu")
async def preschool_menu(
    days: int = Query(14, ge=1, le=30),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Hämta förskolans matsedel.

    Prioritetsordning:
    1. Hushållets school_menu_url (satt via UI)
    2. SCHOOL_MENU_URL env-var (legacy)
    3. HASS_PRESCHOOL_CALENDAR env-var

    Inget konfigurerat → configured: false + school_url: "" för UI att visa setup-formulär.
    """
    # 1. Hushållets URL (satt via UI) — prioriteras framför .env
    school_url = ""
    display = ""
    if user.household_id:
        household = session.get(Household, user.household_id)
        if household and household.school_menu_url:
            school_url = household.school_menu_url.strip()
            display = (household.school_display_name or "").strip()

    # 2. Fallback till .env
    if not school_url:
        school_url = os.getenv("SCHOOL_MENU_URL", "").strip()

    if school_url:
        from services.skolmaten import fetch_school_menu, _slug_from_url
        weeks = max(1, (days + 6) // 7)
        items = await fetch_school_menu(school_url, weeks_ahead=weeks)
        events = [
            {"start": i["date"], "end": i["date"], "summary": i["summary"], "description": "", "location": ""}
            for i in items[:days]
        ]
        if not display:
            display = os.getenv("SCHOOL_DISPLAY_NAME", "").strip()
        if not display:
            slug = _slug_from_url(school_url) or ""
            for prefix in ("forskolan-", "förskolan-", "skolan-"):
                if slug.lower().startswith(prefix):
                    slug = slug[len(prefix):]
                    break
            display = slug.replace("-", " ").strip().title() or "Förskolan"
        return {
            "configured": True,
            "source": "skolmaten.se",
            "name": display,
            "school_url": school_url,
            "events": events,
        }

    # 3. HA fallback
    from services.hass import fetch_calendar_events
    cal_entity = os.getenv("HASS_PRESCHOOL_CALENDAR", "").strip()
    if cal_entity:
        events = await fetch_calendar_events(cal_entity, days_ahead=days)
        return {"configured": True, "source": "ha", "calendar": cal_entity, "school_url": "", "events": events}

    return {
        "configured": False,
        "events": [],
        "school_url": "",
        "message": "Konfigurera via appen eller sätt SCHOOL_MENU_URL i .env",
    }


@router.get("")
def get_mealplan(
    start: date = Query(...),
    end: date = Query(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entries = session.exec(
        select(MealPlanEntry)
        .where(MealPlanEntry.household_id == user.household_id)
        .where(MealPlanEntry.date >= start)
        .where(MealPlanEntry.date <= end)
    ).all()

    result = []
    for entry in entries:
        recipe = session.get(Recipe, entry.recipe_id)
        result.append({
            **entry.model_dump(),
            "recipe": recipe.model_dump() if recipe else None,
        })
    return result


@router.post("", response_model=MealPlanEntry)
def create_entry(
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, data.get("recipe_id"))
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    raw_date = data.get("date")
    if isinstance(raw_date, str):
        raw_date = date.fromisoformat(raw_date[:10])
    entry = MealPlanEntry(
        recipe_id=data.get("recipe_id"),
        date=raw_date,
        meal_type=data.get("meal_type", "dinner"),
        servings=int(data.get("servings", 4)),
        notes=data.get("notes"),
        household_id=user.household_id,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    log_audit(session, user, "mealplan.add", entity_type="meal_plan_entry",
              entity_id=entry.id,
              details={"recipe_id": entry.recipe_id, "date": entry.date.isoformat(),
                       "meal_type": entry.meal_type})
    return entry


@router.put("/{entry_id}", response_model=MealPlanEntry)
def update_entry(
    entry_id: int,
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entry = session.get(MealPlanEntry, entry_id)
    if not entry or entry.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Entry not found")
    # Validate recipe_id belongs to this household if being changed
    if "recipe_id" in data:
        ref_recipe = session.get(Recipe, data["recipe_id"])
        if not ref_recipe or (ref_recipe.household_id is not None and ref_recipe.household_id != user.household_id and ref_recipe.visibility != "public"):
            raise HTTPException(status_code=403, detail="Receptet tillhör inte ditt hushåll")
    changed = []
    for key, value in data.items():
        if hasattr(entry, key) and key not in ("id", "household_id"):
            setattr(entry, key, value)
            changed.append(key)
    session.commit()
    session.refresh(entry)
    log_audit(session, user, "mealplan.update", entity_type="meal_plan_entry",
              entity_id=entry_id, details={"fields": changed})
    return entry


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entry = session.get(MealPlanEntry, entry_id)
    if not entry or entry.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Entry not found")
    snapshot = {"recipe_id": entry.recipe_id, "date": entry.date.isoformat(),
                "meal_type": entry.meal_type}
    session.delete(entry)
    session.commit()
    log_audit(session, user, "mealplan.delete", entity_type="meal_plan_entry",
              entity_id=entry_id, details=snapshot)
    return {"ok": True}
