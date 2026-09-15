"""Home Assistant inventory bridge.

Cross-references shopping-list ingredients against HA helper entities that
represent items in our 2 freezers and 2 fridges. Fail-soft: any error is
logged and treated as "no inventory available" so the app still works
when HA is offline.
"""

import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger("skaffio.hass")

HASS_URL = os.getenv("HASS_URL", "").rstrip("/")
HASS_TOKEN = os.getenv("HASS_TOKEN", "")
# Optional webhook ID inside HA. Configure an automation with trigger "webhook"
# and ID matching this value to receive freezer-portion events.
HASS_FREEZER_WEBHOOK = os.getenv("HASS_FREEZER_WEBHOOK", "").strip()

# Entities to scan. Each must expose a friendly_name (used as label)
# and a state of "on"/"true"/"in_stock" when the item is available.
# Pattern matching looks at entity_id prefix + friendly_name keywords.
HASS_LOCATION_PREFIXES = {
    "freezer_1": "Frys 1",
    "freezer_2": "Frys 2",
    "fridge_1": "Kyl 1",
    "fridge_2": "Kyl 2",
}

TRUTHY_STATES = {"on", "true", "in_stock", "available", "yes", "1"}


@dataclass
class InventoryEntry:
    name: str           # normalized ingredient name (e.g. "kyckling")
    location: str       # human-readable label, e.g. "Frys 1"
    entity_id: str
    raw_name: str       # original friendly name


def _is_configured() -> bool:
    return bool(HASS_URL and HASS_TOKEN)


def _normalize(text: str) -> str:
    """Lowercase + strip non-word chars for fuzzy ingredient matching."""
    return re.sub(r"[^\w\sÅÄÖåäö]", "", text or "").strip().lower()


async def fetch_inventory() -> list[InventoryEntry]:
    """Return all 'in stock' inventory entries from Home Assistant.

    Returns an empty list on any failure (HA offline, bad token, etc.).
    """
    if not _is_configured():
        logger.info("HASS not configured — skipping inventory lookup")
        return []

    headers = {
        "Authorization": f"Bearer {HASS_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{HASS_URL}/api/states", headers=headers)
            resp.raise_for_status()
            states = resp.json()
    except Exception as e:
        logger.warning("HASS fetch failed (%s) — degrading gracefully", e)
        return []

    inventory: list[InventoryEntry] = []
    for state in states:
        entity_id = state.get("entity_id", "")
        attrs = state.get("attributes", {}) or {}
        value = str(state.get("state", "")).lower()
        friendly = attrs.get("friendly_name") or entity_id

        location = None
        for prefix, label in HASS_LOCATION_PREFIXES.items():
            if prefix in entity_id.lower() or prefix in friendly.lower():
                location = label
                break
        if not location:
            continue

        if value not in TRUTHY_STATES:
            continue

        # Strip the location prefix from the name to get the bare ingredient
        bare = re.sub(
            r"(frys|kyl|freezer|fridge)\s*\d?\s*[:\-]?\s*",
            "",
            friendly,
            flags=re.IGNORECASE,
        ).strip()

        inventory.append(InventoryEntry(
            name=_normalize(bare),
            location=location,
            entity_id=entity_id,
            raw_name=friendly,
        ))

    logger.info("HASS inventory: %d items in stock", len(inventory))
    return inventory


async def notify_freezer_portion(payload: dict) -> bool:
    """Fire-and-forget: ping HA when a batch portion lands in the freezer.

    Uses HA's webhook trigger (no auth required when the webhook ID is known).
    Returns True if delivered, False if HA not configured or unreachable.
    """
    if not (HASS_URL and HASS_FREEZER_WEBHOOK):
        return False
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.post(
                f"{HASS_URL}/api/webhook/{HASS_FREEZER_WEBHOOK}",
                json=payload,
            )
            return 200 <= resp.status_code < 300
    except Exception as e:
        logger.warning("HASS freezer webhook failed: %s", e)
        return False


async def fetch_calendar_events(calendar_entity: str, days_ahead: int = 14) -> list[dict]:
    """Hämta kommande events från en HA calendar entity.
    Returnerar lista av {start, end, summary, description} eller [] vid fel.

    Bra för att läsa förskolans matsedel om den är synkad till HA.
    """
    if not _is_configured() or not calendar_entity:
        return []

    from datetime import datetime, timedelta, timezone
    start = datetime.now(timezone.utc).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()

    headers = {"Authorization": f"Bearer {HASS_TOKEN}"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                f"{HASS_URL}/api/calendars/{calendar_entity}"
                f"?start={start}&end={end}",
                headers=headers,
            )
            resp.raise_for_status()
            events = resp.json()
    except Exception as e:
        logger.warning("HASS calendar fetch failed (%s): %s", calendar_entity, e)
        return []

    return [
        {
            "start": ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date") or "",
            "end":   ev.get("end", {}).get("dateTime")   or ev.get("end", {}).get("date")   or "",
            "summary":     ev.get("summary") or "",
            "description": ev.get("description") or "",
            "location":    ev.get("location") or "",
        }
        for ev in events if isinstance(ev, dict)
    ]


def match_ingredient(ingredient_name: str, inventory: list[InventoryEntry]) -> Optional[InventoryEntry]:
    """Fuzzy-match a shopping-list ingredient against HA inventory.

    Strategy: substring match on the normalized form, either direction
    (so "kyckling" matches "kycklingfilé" and vice versa).
    """
    needle = _normalize(ingredient_name)
    if not needle:
        return None
    for entry in inventory:
        if not entry.name:
            continue
        if needle in entry.name or entry.name in needle:
            return entry
    return None
