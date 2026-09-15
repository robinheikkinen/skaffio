"""Direkt integration mot skolmaten.se publika API.

Inget HA behövs — Robin sätter SCHOOL_MENU_URL i .env till sin förskolas
sida på skolmaten.se (t.ex. https://skolmaten.se/forskolan-xyz) så hämtar
vi de kommande veckornas matsedel direkt.

Baserat på reverse engineering av Kaptensanders/skolmat HA-integration.
"""

import logging
from datetime import date, datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("skaffio.skolmaten")

# Magiska headers som skolmaten.se kräver för API:t
_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Referer": "https://skolmaten.se/",
    "client-token": "web-eaa12e50-c84c-4b4a-9cfe-4e3fcbcd9165",
}


def _slug_from_url(url: str) -> Optional[str]:
    """Extraherar school-slug från en URL som
    https://skolmaten.se/forskolan-xyz → 'forskolan-xyz'."""
    if not url:
        return None
    parsed = urlparse(url.strip().rstrip("/"))
    slug = parsed.path.lstrip("/")
    return slug or None


def _iso_week(d: date) -> tuple[int, int]:
    """Returnerar (year, week) enligt ISO."""
    iso = d.isocalendar()
    return (iso[0], iso[1])


async def fetch_school_menu(school_url: str, weeks_ahead: int = 2) -> list[dict]:
    """Hämtar lunch-meny för aktuell + N veckor framåt.

    Returnerar lista av:
        {"date": "YYYY-MM-DD", "summary": "Rätt 1 / Rätt 2", "raw": [...]}

    Vid fel: tom lista (fail-soft, så MealPlan-sidan bara döljer förskole-raden).
    """
    slug = _slug_from_url(school_url)
    if not slug:
        return []

    base = f"https://skolmaten.se/api/4/menu/school/{slug}"

    # Beräkna vilka veckor vi vill ha (idag + N framåt)
    today = date.today()
    weeks = []
    for n in range(weeks_ahead + 1):
        weeks.append(_iso_week(today + timedelta(weeks=n)))

    all_days = []
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            for year, week in weeks:
                url = f"{base}?year={year}&week={week}"
                try:
                    resp = await client.get(url, headers=_HEADERS)
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as e:
                    logger.warning("Skolmaten fetch failed for %s w%d/%d: %s", slug, week, year, e)
                    continue
                week_state = data.get("WeekState") if isinstance(data, dict) else None
                if not isinstance(week_state, dict):
                    continue
                days = week_state.get("Days") or []
                for d in days:
                    if not isinstance(d, dict):
                        continue
                    raw_date = d.get("date") or ""
                    try:
                        # ISO date parse — datetime accepterar både rena och med tidszon
                        parsed_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
                    except (ValueError, TypeError):
                        continue
                    meals = d.get("Meals") or []
                    meal_names = [
                        m.get("name", "").strip()
                        for m in meals
                        if isinstance(m, dict) and m.get("name")
                    ]
                    if not meal_names:
                        continue
                    all_days.append({
                        "date": parsed_date.isoformat(),
                        "summary": " / ".join(meal_names),
                        "raw": meal_names,
                    })
    except Exception as e:
        logger.warning("Skolmaten general failure for %s: %s", slug, e)
        return []

    # Bara dagar från idag och framåt, sorterat
    all_days = [d for d in all_days if d["date"] >= today.isoformat()]
    all_days.sort(key=lambda x: x["date"])
    return all_days
