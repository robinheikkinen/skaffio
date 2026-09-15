"""Local AI meal planner powered by Ollama.

Takes a free-form Swedish prompt, feeds the user's recipe library as
context, and asks the model for a structured weekly plan that matches
our MealPlanEntry schema.
"""

import base64
import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlmodel import Session, select

from database import get_session
from models import MealPlanEntry, PantryItem, Recipe, User
from services.audit import log_audit
from services.auth import get_current_user
from services.hass import fetch_inventory
from services.ai import chat, vision_chat, safe_parse_json, AIUnavailable

logger = logging.getLogger("skaffio.ai_planner")

router = APIRouter(prefix="/ai", tags=["ai"])


SYSTEM_PROMPT = """Du är Skaffio – en varm, praktisk svensk hemkock-AI som planerar veckans måltider.

PLANERINGSPRINCIPER:
- Du föreslår BARA recept som finns i användarens befintliga receptsamling (id-lista nedan). Hitta inte på nya.
- Variera proteiner och smaker över veckan (kyckling, nöt, fisk, vego, ägg).
- Prioritera snabba recept (≤25 min) på vardagar mån–tor. Helgrätter på fredag/lördag.
- Använd gärna ingredienser som redan finns hemma (markerade som "I LAGER hemma").
- ⚠️ PRIORITERA STARKT recept som använder ingredienser markerade som "SNART UTGÅNGNA" — det minskar matsvinnet.
- Föreslå gärna 1–2 batch-vänliga rätter (lasagne, gryta) som kan frysas.
- Följ användarens önskemål exakt — anpassa efter familjekontext, allergier eller mål som de nämner.

Svara ALLTID på svenska. Returnera ENDAST denna JSON (inget annat):
{
  "plan": [
    {
      "recipe_id": <int>,
      "date": "YYYY-MM-DD",
      "meal_type": "breakfast|lunch|dinner|snack",
      "servings": <int>,
      "notes": "<kort motivering>",
      "batch_friendly": <bool>
    }
  ],
  "summary": "<2-3 meningar om veckans tema>"
}
"""


def _build_context(
    recipes: list[Recipe],
    inventory_names: list[str],
    pantry_items: list = None,
) -> str:
    lines = ["RECEPT TILLGÄNGLIGA I DATABASEN:"]
    for r in recipes:
        try:
            ings = json.loads(r.ingredients or "[]")
            ing_names = ", ".join((i.get("name", "") for i in ings[:8] if i.get("name")))
        except Exception:
            ing_names = ""
        time = (r.prep_time or 0) + (r.cook_time or 0)
        lines.append(
            f"- id={r.id} | {r.title} | {time} min | {r.servings} port. | ingredienser: {ing_names}"
        )

    today = date.today()
    urgent: list[str] = []

    if pantry_items:
        lines.append("")
        lines.append("I LAGER HEMMA (lokalt pantry):")
        for p in pantry_items:
            qty = f"{p.amount} {p.unit or ''}".strip() if p.amount else ""
            line = f"- {p.name}"
            if qty:
                line += f" ({qty})"
            if p.expiry_date and not p.is_staple:
                days = (p.expiry_date - today).days
                if days <= 0:
                    line += " [UTGÅNGET]"
                    urgent.append(p.name)
                elif days <= 3:
                    line += f" [GÅR UT OM {days}d]"
                    urgent.append(p.name)
            lines.append(line)

    if urgent:
        lines.append("")
        lines.append(f"⚠️ MÅSTE ANVÄNDAS SNART (välj recept med dessa): {', '.join(urgent)}")

    if inventory_names and not pantry_items:
        # Fallback till Home Assistant om lokalt pantry saknas
        lines.append("")
        lines.append("I LAGER HEMMA (från Home Assistant):")
        lines.append(", ".join(inventory_names))

    return "\n".join(lines)


@router.post("/plan")
async def generate_plan(
    payload: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Generate a structured meal plan from a natural-language prompt.

    Body:
        prompt: str            – the user's request
        start_date: "YYYY-MM-DD" (optional, defaults to today)
        commit: bool           – if true, also write entries to the database
    """
    user_prompt = (payload.get("prompt") or "").strip()
    if not user_prompt:
        raise HTTPException(status_code=400, detail="prompt krävs")

    start_str = payload.get("start_date")
    try:
        start_date = date.fromisoformat(start_str) if start_str else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="ogiltigt start_date")

    commit = bool(payload.get("commit", False))

    recipes = session.exec(
        select(Recipe).where(
            (Recipe.household_id == user.household_id) | (Recipe.visibility == "public")
        )
    ).all()
    if not recipes:
        return {
            "ok": False,
            "reason": "no_recipes",
            "message": "Du har inga recept i databasen ännu. Lägg till några innan AI:n kan planera!",
        }

    inventory = await fetch_inventory()
    inventory_names = [i.raw_name for i in inventory]

    # Hämta lokalt pantry — prioriteras över Home Assistant
    local_pantry = session.exec(select(PantryItem).where(PantryItem.household_id == user.household_id)).all()

    # Hämta förskolans matsedel om konfigurerad — AI undviker dubbletter
    preschool_block = ""
    import os as _os
    school_url = _os.getenv("SCHOOL_MENU_URL", "").strip()
    if school_url:
        try:
            from services.skolmaten import fetch_school_menu
            psk = await fetch_school_menu(school_url, weeks_ahead=2)
            # Bara dagar inom vår planerings-vecka
            from datetime import timedelta as _td
            week_dates = {(start_date + _td(days=i)).isoformat() for i in range(7)}
            relevant = [p for p in psk if p["date"] in week_dates]
            if relevant:
                lines = [f"- {p['date']}: {p['summary']}" for p in relevant]
                preschool_block = (
                    "\n\nFÖRSKOLAN SERVERAR DESSA DAGAR (UNDVIK liknande mat hemma samma dag):\n"
                    + "\n".join(lines) + "\n"
                )
        except Exception as _e:
            logger.warning("Preschool menu fetch failed: %s", _e)

    context = _build_context(recipes, inventory_names, pantry_items=local_pantry)
    full_prompt = (
        f"{context}{preschool_block}\n\n"
        f"VECKANS STARTDATUM: {start_date.isoformat()} (måndag)\n\n"
        f"ANVÄNDARENS ÖNSKEMÅL:\n{user_prompt}\n\n"
        f"Returnera JSON enligt schemat."
    )

    try:
        raw = await chat(full_prompt, system=SYSTEM_PROMPT, expect_json=True, task="meal_plan")
    except AIUnavailable as e:
        return {
            "ok": False,
            "reason": "ollama_offline",
            "message": "Den lokala AI:n (Ollama) är inte tillgänglig just nu. Du kan fortfarande planera manuellt!",
            "detail": str(e),
        }

    parsed = safe_parse_json(raw)
    if not parsed or "plan" not in parsed:
        logger.warning("Could not parse plan from Ollama. Raw: %s", raw[:300])
        return {
            "ok": False,
            "reason": "parse_error",
            "message": "AI:n kunde inte producera en giltig plan. Försök igen eller justera prompten.",
            "raw": raw,
        }

    valid_ids = {r.id for r in recipes}
    recipe_lookup = {r.id: r for r in recipes}
    plan_items = []
    for entry in parsed.get("plan", []):
        try:
            recipe_id = int(entry["recipe_id"])
            entry_date = date.fromisoformat(entry["date"])
        except (KeyError, ValueError, TypeError):
            continue
        if recipe_id not in valid_ids:
            continue
        meal_type = entry.get("meal_type", "dinner")
        plan_items.append({
            "recipe_id": recipe_id,
            "date": entry_date.isoformat(),
            "meal_type": meal_type,
            "servings": int(entry.get("servings", 4)),
            "notes": entry.get("notes", ""),
            "batch_friendly": bool(entry.get("batch_friendly", False)),
            "recipe": recipe_lookup[recipe_id].model_dump(),
        })

    if commit and plan_items:
        for item in plan_items:
            db_entry = MealPlanEntry(
                recipe_id=item["recipe_id"],
                date=date.fromisoformat(item["date"]),
                meal_type=item["meal_type"],
                servings=item["servings"],
                notes=item.get("notes") or None,
                household_id=user.household_id,
            )
            session.add(db_entry)
        session.commit()
        log_audit(session, user, "ai.plan_commit",
                  details={"start_date": start_date.isoformat(), "entries": len(plan_items)})
    else:
        log_audit(session, user, "ai.plan_preview",
                  details={"start_date": start_date.isoformat(), "entries": len(plan_items)})

    return {
        "ok": True,
        "plan": plan_items,
        "summary": parsed.get("summary", ""),
        "committed": commit,
    }


VISION_SYSTEM_PROMPT = """Du är en OCR-expert som extraherar recept från bilder. Bilden kan vara: foto av kokbokssida, screenshot från receptsajt, foto av tidningssida, eller handskrivet recept.

ARBETSGÅNG:
1. Läs ALL text på bilden ord-för-ord, även små rubriker och fotnoter
2. Hitta receptets titel (oftast störst eller överst)
3. Hitta INGREDIENS-listan — varje rad är typiskt: "<mängd> <enhet> <ingrediens>". Inkludera ALLA, även de små (salt, peppar, olja)
4. Hitta INSTRUKTIONER — numrerad eller löpande prosa, dela upp i steg
5. Hitta portioner ("4 port", "ca 6 personer", etc.)

LÄS NOGA:
- ALL svensk text inkl. å/ä/ö
- Siffror och mängder exakt — 1,5 dl ≠ 15 dl
- Enheter: dl, msk, tsk, krm, g, kg, st, l
- Skippa INTE något även om texten är liten

Returnera ENDAST JSON enligt detta schema (inget annat):
{
  "title": "<receptets namn på svenska – var konkret, t.ex. 'Kebabgratäng', 'Kycklinggryta med curry'>",
  "description": "<1-2 meningar som beskriver rätten, eller tom sträng>",
  "ingredients": [
    { "name": "<ingrediens>", "amount": "<mängd>", "unit": "<enhet>" }
  ],
  "instructions": "<numrerade steg, ett per rad, '1. ...\\n2. ...'>",
  "servings": <int eller null>,
  "prep_time": <minuter som int eller null>,
  "cook_time": <minuter som int eller null>,
  "confidence": <0.0 – 1.0, hur säker du är på extraktion>
}

Om bilden bara visar färdig maträtt utan text: gissa namn från vad du ser, lämna ingredients/instructions tomma, sätt confidence=0.3.
Om bilden inte alls verkar vara mat: returnera title="" och confidence=0."""


@router.post("/extract-from-image")
async def extract_from_image(
    file: UploadFile = File(...),
    only_title: bool = Form(False),
    _: User = Depends(get_current_user),
):
    """Analyze a food/recipe image with the local vision model.

    Returns a partially-filled recipe object the user can review.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Tom fil")

    image_b64 = base64.b64encode(content).decode("ascii")

    prompt = (
        "Vad heter denna rätt? Returnera bara JSON: "
        "{\"title\": \"...\", \"confidence\": 0.0-1.0}"
        if only_title else
        "Analysera receptbilden enligt schemat. Svara på svenska."
    )

    try:
        # vision_chat har inbyggd provider-failover (Gemini→GitHub→Claude→Staik).
        raw = await vision_chat(prompt, image_b64, expect_json=True, task="recipe_photo")
    except AIUnavailable as e:
        return {
            "ok": False,
            "reason": "ai_offline",
            "message": "Vision-AI:n är inte tillgänglig. Kontrollera att minst en av "
                       "GEMINI_API_KEY / ANTHROPIC_API_KEY / GITHUB_MODELS_API_KEY finns i .env.",
            "detail": str(e),
        }

    parsed = safe_parse_json(raw)
    if not parsed:
        return {
            "ok": False,
            "reason": "parse_error",
            "message": "AI:n kunde inte tolka bilden. Försök med en tydligare bild.",
            "raw": raw,
        }

    # Normalize ingredients into the JSON-string shape the rest of the app uses
    ings = parsed.get("ingredients") or []
    if not isinstance(ings, list):
        ings = []
    ingredients_json = json.dumps(
        [
            {
                "name": str(i.get("name", "")).strip(),
                "amount": str(i.get("amount", "")).strip(),
                "unit": str(i.get("unit", "")).strip(),
            }
            for i in ings if isinstance(i, dict) and i.get("name")
        ],
        ensure_ascii=False,
    )

    return {
        "ok": True,
        "title": (parsed.get("title") or "").strip(),
        "description": (parsed.get("description") or "").strip(),
        "ingredients": ingredients_json,
        "instructions": (parsed.get("instructions") or "").strip(),
        "servings": parsed.get("servings"),
        "confidence": parsed.get("confidence", 0),
        "source_type": "image",
    }


@router.post("/extract-from-images")
async def extract_from_multiple_images(
    files: list[UploadFile] = File(...),
    _: User = Depends(get_current_user),
):
    """Multi-bild extraktion: tar flera bilder som hör ihop (t.ex. kokbok-uppslag)
    och returnerar ETT recept som sammanfattning av alla.

    Prioriterar Claude (Anthropic) för OCR om ANTHROPIC_API_KEY finns —
    Claude är dramatiskt bättre på att läsa text i bilder än mindre vision-modeller.
    Fall back till AI_VISION_MODEL (Staik) om Claude inte är konfigurerat eller failar.
    """
    from services.ai import vision_chat_multi, last_provider
    if not files:
        raise HTTPException(status_code=400, detail="Inga bilder")
    if len(files) > 6:
        raise HTTPException(status_code=400, detail="Max 6 bilder per recept")

    images_b64 = []
    for f in files:
        content = await f.read()
        if not content:
            continue
        b64 = base64.b64encode(content).decode("ascii")
        mime = f.content_type or "image/jpeg"
        if not mime.startswith("image/"):
            mime = "image/jpeg"
        images_b64.append((b64, mime))

    if not images_b64:
        raise HTTPException(status_code=400, detail="Inga giltiga bilder")

    prompt = (
        f"Du får {len(images_b64)} bilder som tillsammans utgör ETT recept "
        "(kan vara sidor från en kokbok, screenshots, foton från en tidning).\n\n"
        "LÄS NOGA all text på alla bilder och kombinera till ett komplett recept. "
        "Inkludera ALLA ingredienser du ser, även om de står på olika bilder. "
        "Skriv instruktionerna i ordning, numrerade.\n\n"
        "Returnera ENDAST JSON, ingen prosa runt om. "
        + VISION_SYSTEM_PROMPT
    )

    # vision_chat_multi har inbyggd provider-failover (Gemini→GitHub→Claude→Staik).
    try:
        raw = await vision_chat_multi(prompt, images_b64, expect_json=True, task="recipe_photo")
    except AIUnavailable as e:
        return {"ok": False, "reason": "ai_offline", "detail": str(e)}
    used = last_provider() or "?"

    parsed = safe_parse_json(raw)
    if not parsed:
        return {"ok": False, "reason": "parse_error", "raw": raw[:500]}

    ings = parsed.get("ingredients") or []
    if not isinstance(ings, list):
        ings = []
    ingredients_json = json.dumps(
        [
            {
                "name": str(i.get("name", "")).strip(),
                "amount": str(i.get("amount", "")).strip(),
                "unit": str(i.get("unit", "")).strip(),
            }
            for i in ings if isinstance(i, dict) and i.get("name")
        ],
        ensure_ascii=False,
    )

    return {
        "ok": True,
        "title": (parsed.get("title") or "").strip(),
        "description": (parsed.get("description") or "").strip(),
        "ingredients": ingredients_json,
        "instructions": (parsed.get("instructions") or "").strip(),
        "servings": parsed.get("servings"),
        "prep_time": parsed.get("prep_time"),
        "cook_time": parsed.get("cook_time"),
        "confidence": parsed.get("confidence", 0),
        "source_type": "image",
        "image_count": len(images_b64),
        "model_used": used,
    }


@router.get("/status")
async def ai_status():
    """Quick liveness check from the frontend for the chat drawer header."""
    import os
    base_url = os.getenv("AI_API_URL", "")
    model = os.getenv("AI_MODEL", "")
    try:
        await chat("ping", expect_json=False)
        return {"ollama": "online", "ai": "online", "base_url": base_url, "model": model}
    except AIUnavailable as e:
        return {"ollama": "offline", "ai": "offline", "base_url": base_url, "model": model, "detail": str(e)}


@router.post("/invent-recipe")
async def invent_recipe(
    payload: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Generera ett NYTT recept från pantry-innehållet — inte från befintliga recept."""
    from models import PantryItem
    from services.ai import chat, AIUnavailable

    mood = (payload.get("mood") or "").strip()

    # Hämta pantry-innehållet
    pantry_items = session.exec(select(PantryItem).where(PantryItem.household_id == user.household_id)).all()
    if not pantry_items:
        raise HTTPException(status_code=400, detail="Pantry är tomt — lägg till varor först")

    # Bygg ingredienslista med utgångsdatum-varningar
    today_d = date.today()
    by_location: dict = {}
    urgent_names: list[str] = []
    for item in pantry_items:
        qty = f" ({item.amount} {item.unit or ''})" if item.amount else ""
        label = item.name + qty
        if item.expiry_date and not item.is_staple:
            days = (item.expiry_date - today_d).days
            if days <= 0:
                label += " ⚠️UTGÅNGET"
                urgent_names.append(item.name)
            elif days <= 3:
                label += f" ⚠️{days}d"
                urgent_names.append(item.name)
        by_location.setdefault(item.location, []).append(label)

    pantry_text = "\n".join(
        f"{loc}: {', '.join(items)}" for loc, items in by_location.items()
    )
    urgent_block = ""
    if urgent_names:
        urgent_block = f"\n\n⚠️ PRIORITERA att använda dessa (snart utgångna): {', '.join(urgent_names)}"

    mood_instruction = f"\nAnpassa receptet till: {mood}" if mood else ""

    prompt = f"""Du är en kreativ svensk hemkock. Hitta på ett NYTT recept baserat på vad som finns hemma.
Du behöver INTE använda alla ingredienser — välj de som passar ihop.
Det är OK att anta att basvaror som salt, peppar, olja, smör, mjöl finns hemma.
{mood_instruction}{urgent_block}

VAD SOM FINNS HEMMA:
{pantry_text}

Svara ENDAST med denna JSON (inget annat, inga kommentarer):
{{
  "title": "<receptnamn på svenska>",
  "description": "<1-2 meningar om rätten>",
  "servings": <antal portioner, int>,
  "prep_time": <förberedelsetid i minuter, int>,
  "cook_time": <tillagningstid i minuter, int>,
  "ingredients": [
    {{"name": "<ingrediensnamn>", "amount": <mängd som tal eller null>, "unit": "<enhet eller tom sträng>"}}
  ],
  "instructions": "<steg-för-steg instruktioner som markdown med radbrytningar>",
  "notes": "<tips eller variationer>"
}}"""

    try:
        raw = await chat(prompt, expect_json=True, task="invent_recipe")
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI inte tillgänglig: {e}")

    recipe = safe_parse_json(raw)
    if not recipe or "title" not in recipe:
        raise HTTPException(status_code=500, detail="AI returnerade ogiltigt format")

    log_audit(session, user, "ai.invent_recipe", details={"mood": mood, "title": recipe.get("title")})
    return {"ok": True, "recipe": recipe}
