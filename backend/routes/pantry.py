"""Pantry — vad finns hemma + utgångsdatum.

Plus AI-fridge-scan: foto av kylskåp/skafferi → vision-AI identifierar
varor → lägger till i pantry. Bygger på samma vision_chat() som
recept-bildigenkänning.
"""

import base64
import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import PantryItem, User
from services.audit import log_audit
from services.ai import vision_chat, safe_parse_json, AIUnavailable
from services.auth import get_current_user

router = APIRouter(prefix="/pantry", tags=["pantry"])


class PantryItemIn(BaseModel):
    name: str
    amount: Optional[float] = None
    unit: Optional[str] = None
    location: str = "Skafferi"
    expiry_date: Optional[date] = None
    notes: Optional[str] = None


@router.get("")
def list_pantry(
    location: Optional[str] = None,
    expiring_within_days: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    query = select(PantryItem).where(PantryItem.household_id == user.household_id).order_by(PantryItem.expiry_date.asc().nullslast())
    if location:
        query = query.where(PantryItem.location == location)
    items = session.exec(query).all()
    if expiring_within_days is not None:
        cutoff = date.today() + timedelta(days=expiring_within_days)
        items = [i for i in items if i.expiry_date and i.expiry_date <= cutoff]
    today = date.today()
    return [
        {
            **i.model_dump(),
            "days_until_expiry": (i.expiry_date - today).days if i.expiry_date else None,
            "is_expired": i.expiry_date < today if i.expiry_date else False,
        }
        for i in items
    ]


@router.post("")
def add_pantry_item(
    data: PantryItemIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = PantryItem(**data.model_dump(), added_by_user_id=user.id, household_id=user.household_id)
    session.add(item)
    session.commit()
    session.refresh(item)
    log_audit(session, user, "pantry.add", entity_type="pantry_item",
              entity_id=item.id, details={"name": item.name, "location": item.location})
    return item


@router.put("/{item_id}")
def update_pantry_item(
    item_id: int,
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = session.get(PantryItem, item_id)
    if not item or item.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Hittades inte")
    for key, value in data.items():
        if hasattr(item, key) and key not in ("id", "added_at", "added_by_user_id", "household_id"):
            if key == "expiry_date" and value:
                value = date.fromisoformat(value) if isinstance(value, str) else value
            setattr(item, key, value)
    session.commit()
    session.refresh(item)
    log_audit(session, user, "pantry.update", entity_type="pantry_item", entity_id=item_id)
    return item


@router.delete("/{item_id}")
def consume_pantry_item(
    item_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = session.get(PantryItem, item_id)
    if not item or item.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="Hittades inte")
    log_audit(session, user, "pantry.consume", entity_type="pantry_item",
              entity_id=item_id, details={"name": item.name})
    session.delete(item)
    session.commit()
    return {"ok": True}


class BulkAddIn(BaseModel):
    items: list[PantryItemIn]


@router.post("/bulk")
def bulk_add_pantry(
    data: BulkAddIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Lägg till många items samtidigt — används av kylskåps-scan."""
    if not data.items:
        raise HTTPException(status_code=400, detail="Tom lista")
    created = []
    for it in data.items:
        obj = PantryItem(**it.model_dump(), added_by_user_id=user.id, household_id=user.household_id)
        session.add(obj)
        created.append(obj)
    session.commit()
    for o in created:
        session.refresh(o)
    log_audit(session, user, "pantry.bulk_add", entity_type="pantry_item",
              details={"count": len(created)})
    return {"created": len(created), "ids": [o.id for o in created]}


@router.post("/scan-photo")
async def scan_pantry_photo(
    file: UploadFile = File(...),
    location: str = Form("Kyl"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Foto av kyl/skafferi/frys → vision-AI identifierar varor.

    Returnerar lista av föreslagna pantry-items. Användaren får granska och
    bekräfta innan vi sparar (för att slippa hallucinationer i pantry).
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Tom fil")
    image_b64 = base64.b64encode(content).decode("ascii")

    # Lokations-specifika hints förbättrar träffsäkerheten markant
    loc_lower = (location or "").lower()
    if "kryddor" in loc_lower or "kryddhylla" in loc_lower:
        location_hint = (
            "Detta är en KRYDDHYLLA. Läs etiketterna på burkar och påsar noggrant. "
            "Vanliga svenska kryddor: paprikapulver, vitlökspulver, oregano, basilika, "
            "timjan, kanel, kardemumma, spiskummin, chili, currypulver, gurkmeja. "
            "Var aggressiv — det är OK att lista även om confidence är medel (0.4+)."
        )
    elif "skafferi" in loc_lower:
        location_hint = (
            "Detta är ett SKAFFERI — torrvaror på hylla. Lista pasta, ris, mjöl, "
            "konserver, kex, müsli, oljor, vinäger osv. Läs etiketter."
        )
    elif "frys" in loc_lower:
        location_hint = (
            "Detta är en FRYS. Lista frysta varor — kött, fisk, grönsaker, "
            "färdigmat, glass, bröd. Var uppmärksam på påsar med text."
        )
    else:
        # Kyl
        location_hint = (
            "Detta är ett KYLSKÅP. Lista mejeriprodukter, kallskuret, grönsaker, "
            "drycker, såser. Tetror och flaskor har ofta tydliga etiketter."
        )

    today = date.today()

    prompt = (
        f"{location_hint}\n\n"
        "Lista ALLA matvaror du kan identifiera. Returnera JSON:\n"
        "{\n"
        "  \"items\": [\n"
        "    {\"name\": \"svenskt namn\", \"amount\": <number eller null>, "
        "\"unit\": \"dl/g/st/l/burk\", \"confidence\": 0.0-1.0, "
        "\"expiry_date\": \"YYYY-MM-DD eller null\"}\n"
        "  ]\n"
        "}\n\n"
        "REGLER:\n"
        "1. Bara JSON, ingen prosa\n"
        "2. Namn på svenska (Mjölk inte Milk, Grädde inte Cream)\n"
        "3. Confidence 0.4+ räcker (användaren granskar och bockar av i UI)\n"
        "4. Inkludera kvantitet om uppenbart (\"2 äpplen\" → amount=2, unit=\"st\")\n"
        f"5. expiry_date: läs av bäst-före/utgångsdatum OM synligt på förpackningen "
        f"(format ÅÅÅÅ-MM-DD, dagens år är {today.year}). "
        "Sätt null om inget datum syns — vi gissar sedan baserat på varutyp."
    )

    try:
        raw = await vision_chat(prompt, image_b64, expect_json=True, task="fridge_scan")
    except AIUnavailable as e:
        return {
            "ok": False,
            "reason": "ai_offline",
            "message": "Vision-AI inte tillgänglig — fyll i pantry manuellt så länge",
            "detail": str(e),
        }

    parsed = safe_parse_json(raw)
    if not parsed or "items" not in parsed:
        return {"ok": False, "reason": "parse_error", "raw": raw[:300]}

    suggestions = []
    for it in parsed.get("items", []):
        if not isinstance(it, dict) or not it.get("name"):
            continue
        conf = float(it.get("confidence", 0.5))
        # Lägre threshold (0.35) — användaren granskar och bockar av i UI
        if conf < 0.35:
            continue
        name = str(it["name"]).strip()
        # Use AI-extracted date if present, otherwise estimate from item category
        ai_date = it.get("expiry_date")
        if ai_date and isinstance(ai_date, str) and len(ai_date) == 10:
            expiry = ai_date
            expiry_guessed = False
        else:
            days = _guess_expiry_days(name)
            expiry = (today + timedelta(days=days)).isoformat()
            expiry_guessed = True
        suggestions.append({
            "name": name,
            "amount": it.get("amount"),
            "unit": str(it.get("unit", "")).strip() or None,
            "location": location,
            "expiry_date": expiry,
            "expiry_guessed": expiry_guessed,
            "confidence": conf,
        })

    return {
        "ok": True,
        "suggestions": suggestions,
        "count": len(suggestions),
    }


# ─── Kvitto-OCR ──────────────────────────────────────────────────

# Default-utgångsdatum per kategori (dagar från idag) — bara en grov vink.
# Användaren kan redigera vid bekräftelse.
EXPIRY_DEFAULTS = {
    "mejeri":   7,    # mjölk, yoghurt, grädde, kvarg
    "kött":     3,    # färsk färs, kyckling
    "fisk":     2,
    "färsk":    5,    # grönsaker, frukt
    "frys":     90,
    "bröd":     5,
    "skafferi": 365,  # pasta, ris, mjöl, konserver
    "övrigt":   30,
}


def _guess_expiry_days(name: str) -> int:
    """Gissar kategori utifrån varunamnet och returnerar default-dagar."""
    n = (name or "").lower()
    if any(k in n for k in ["mjölk", "yoghurt", "grädde", "kvarg", "keso", "ost", "filmjölk", "creme fraiche"]):
        return EXPIRY_DEFAULTS["mejeri"]
    if any(k in n for k in ["fryst", "glass", "frys"]):
        return EXPIRY_DEFAULTS["frys"]
    if any(k in n for k in ["kyckling", "färs", "fläsk", "biff", "korv", "bacon", "skinka"]):
        return EXPIRY_DEFAULTS["kött"]
    if any(k in n for k in ["lax", "torsk", "fisk", "räk", "tonfisk"]):
        return EXPIRY_DEFAULTS["fisk"]
    if any(k in n for k in ["bröd", "limpa", "bulle", "kex"]):
        return EXPIRY_DEFAULTS["bröd"]
    if any(k in n for k in ["pasta", "ris", "mjöl", "socker", "salt", "olja", "konserv", "burk", "tetra",
                            "bönor", "linser", "havre", "müsli", "flingor", "kryddor"]):
        return EXPIRY_DEFAULTS["skafferi"]
    if any(k in n for k in ["sallad", "tomat", "gurka", "paprika", "lök", "potatis", "äpple", "banan",
                            "morot", "vitlök", "broccoli", "spenat", "champinjon"]):
        return EXPIRY_DEFAULTS["färsk"]
    return EXPIRY_DEFAULTS["övrigt"]


@router.post("/scan-receipt")
async def scan_receipt(
    file: UploadFile = File(...),
    location: str = Form("Skafferi"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Foto av butikskvitto → vision-AI extraherar matvaror → föreslår pantry-items
    med uppskattat utgångsdatum baserat på varutyp.

    Användaren får granska + redigera datum innan vi sparar.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Tom fil")
    image_b64 = base64.b64encode(content).decode("ascii")

    prompt = (
        "Detta är ett foto av ett svenskt butikskvitto (ICA, Coop, Willys, Hemköp, Lidl etc.).\n"
        "Läs av ALLA matvaror som handlats. Hoppa över: pant, rabatt, summa, plastpåse, "
        "öppettider, butiksinfo, kvittonummer.\n\n"
        "Returnera JSON enligt schemat:\n"
        "{\n"
        "  \"store\": \"butiksnamn eller null\",\n"
        "  \"items\": [\n"
        "    {\"name\": \"svenskt produktnamn renskrivet (t.ex. 'ICA Mjölk 3%' → 'Mjölk')\", "
        "\"amount\": <number eller null>, \"unit\": \"st/l/g/kg/dl\", "
        "\"confidence\": 0.0-1.0}\n"
        "  ]\n"
        "}\n\n"
        "REGLER:\n"
        "1. Bara JSON, ingen prosa\n"
        "2. Renskriv namn (ta bort förkortningar, varumärken om möjligt)\n"
        "3. Confidence ≥ 0.6 för att inkludera\n"
        "4. Om mängd står på kvittot (t.ex. '2 ST' eller '500 G') — inkludera"
    )

    try:
        raw = await vision_chat(prompt, image_b64, expect_json=True, task="receipt_scan")
    except AIUnavailable as e:
        return {"ok": False, "reason": "ai_offline",
                "message": "Vision-AI inte tillgänglig", "detail": str(e)}

    parsed = safe_parse_json(raw)
    if not parsed or "items" not in parsed:
        return {"ok": False, "reason": "parse_error", "raw": raw[:300]}

    today = date.today()
    suggestions = []
    for it in parsed.get("items", []):
        if not isinstance(it, dict) or not it.get("name"):
            continue
        conf = float(it.get("confidence", 0.5))
        if conf < 0.5:
            continue
        name = str(it["name"]).strip()
        days = _guess_expiry_days(name)
        suggestions.append({
            "name": name,
            "amount": it.get("amount"),
            "unit": str(it.get("unit", "")).strip() or None,
            "location": location,
            "expiry_date": (today + timedelta(days=days)).isoformat(),
            "expiry_days_guess": days,
            "confidence": conf,
        })

    return {
        "ok": True,
        "store": parsed.get("store"),
        "suggestions": suggestions,
        "count": len(suggestions),
    }


# ─── Standardskafferi — bas-import ──────────────────────────────

STANDARD_STAPLES = [
    # Torrvaror
    ("Pasta",            "Skafferi"),
    ("Spaghetti",        "Skafferi"),
    ("Ris",              "Skafferi"),
    ("Couscous",         "Skafferi"),
    ("Bulgur",           "Skafferi"),
    ("Havregryn",        "Skafferi"),
    ("Müsli",            "Skafferi"),
    ("Mjöl",             "Skafferi"),
    ("Florsocker",       "Skafferi"),
    ("Strösocker",       "Skafferi"),
    ("Salt",             "Skafferi"),
    ("Peppar",           "Skafferi"),
    ("Buljongtärningar", "Skafferi"),
    # Oljor & vinäger
    ("Olivolja",         "Skafferi"),
    ("Rapsolja",         "Skafferi"),
    ("Smör",             "Kyl - kök"),
    ("Vinäger",          "Skafferi"),
    # Kryddor
    ("Paprikapulver",    "Skafferi"),
    ("Currypulver",      "Skafferi"),
    ("Vitlökspulver",    "Skafferi"),
    ("Lökpulver",        "Skafferi"),
    ("Oregano",          "Skafferi"),
    ("Basilika",         "Skafferi"),
    ("Timjan",           "Skafferi"),
    ("Kanel",            "Skafferi"),
    ("Kardemumma",       "Skafferi"),
    # Smaksättare
    ("Soja",             "Skafferi"),
    ("Senap",            "Kyl - kök"),
    ("Ketchup",          "Kyl - kök"),
    ("Tomatpuré",        "Skafferi"),
    ("Krossade tomater", "Skafferi"),
    ("Kokosmjölk",       "Skafferi"),
    # Bas-grönt
    ("Gul lök",          "Skafferi"),
    ("Vitlök",           "Skafferi"),
    ("Potatis",          "Skafferi"),
    ("Morötter",         "Kyl - kök"),
    ("Citron",           "Kyl - kök"),
]


@router.post("/import-staples")
def import_staples(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Engångs-import av typiska svenska basvaror med is_staple=true.
    Hoppar över saker som redan finns med samma namn (case-insensitive)."""
    existing = {n.lower() for n in session.exec(
        select(PantryItem.name).where(PantryItem.household_id == user.household_id)
    ).all() if n}
    created = 0
    skipped = []
    for name, location in STANDARD_STAPLES:
        if name.lower() in existing:
            skipped.append(name)
            continue
        item = PantryItem(
            name=name,
            location=location,
            is_staple=True,
            added_by_user_id=user.id,
            household_id=user.household_id,
        )
        session.add(item)
        created += 1
    session.commit()
    log_audit(session, user, "pantry.import_staples",
              details={"created": created, "skipped": len(skipped)})
    return {"created": created, "skipped": skipped, "total_in_list": len(STANDARD_STAPLES)}
