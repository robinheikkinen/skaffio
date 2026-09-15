import json
import os
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlmodel import Session, select
from database import get_session
from models import Recipe, RecipeTag, Tag, RecipeImage, User
from services.audit import log_audit
from services.auth import get_current_user
import secrets as _secrets
from services.ratelimit import limiter

_TRACKING_PARAMS = {
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_name', 'igsh', 'fbclid', 'ref', 'mc_cid', 'mc_eid',
}

def _normalize_url(url: str) -> str:
    """Normalisera URL för duplikat-jämförelse: strippa tracking-params och /reel/→/p/."""
    try:
        p = urlparse(url.strip())
        path = p.path.rstrip('/')
        # Instagram: /reel/ID och /p/ID är samma innehåll
        if 'instagram.com' in p.netloc:
            path = re.sub(r'/reel/([^/]+)', r'/p/\1', path)
        params = {k: v for k, v in parse_qs(p.query).items() if k not in _TRACKING_PARAMS}
        clean = p._replace(path=path, query=urlencode(params, doseq=True), fragment='')
        return urlunparse(clean).rstrip('?')
    except Exception:
        return url

router = APIRouter(prefix="/recipes", tags=["recipes"])

UPLOAD_DIR = "/data/uploads"


@router.get("")
def list_recipes(
    search: Optional[str] = None,
    tags: Optional[str] = None,
    source_type: Optional[str] = None,
    favorites_only: bool = False,
    sort: Optional[str] = "recent",  # recent|popular|rating|stale|title
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import or_, desc, asc, nulls_last
    from models import Favorite

    query = select(Recipe)

    # Visa publika recept ELLER recept i användarens hushåll
    if user.household_id is not None:
        query = query.where(
            or_(Recipe.visibility == "public", Recipe.household_id == user.household_id)
        )
    else:
        query = query.where(Recipe.visibility == "public")

    if search:
        # Varje ord måste finnas (AND), men behöver inte sitta ihop
        for word in search.split():
            p = f"%{word}%"
            query = query.where(or_(
                Recipe.title.ilike(p),
                Recipe.description.ilike(p),
                Recipe.ingredients.ilike(p),
                Recipe.instructions.ilike(p),
            ))
    if source_type:
        query = query.where(Recipe.source_type == source_type)
    if favorites_only:
        fav_ids = session.exec(
            select(Favorite.recipe_id).where(Favorite.user_id == user.id)
        ).all()
        if not fav_ids:
            return []
        query = query.where(Recipe.id.in_(fav_ids))

    # Sortering — SQLite hanterar NULLS LAST via nulls_last() wrapper
    sort_map = {
        "recent":  desc(Recipe.created_at),
        "popular": nulls_last(desc(Recipe.times_cooked)),
        "rating":  nulls_last(desc(Recipe.rating)),
        "stale":   nulls_last(asc(Recipe.last_cooked_at)),  # längst sen vi lagade först
        "title":   asc(Recipe.title),
    }
    query = query.order_by(sort_map.get(sort or "recent", sort_map["recent"]))

    recipes = session.exec(query).all()

    # Vilka är favoriter för current user? Slå upp en gång, slipp N+1.
    user_fav_ids = set(session.exec(
        select(Favorite.recipe_id).where(Favorite.user_id == user.id)
    ).all())

    # Pantry-matching: alla varor i pantry (inkl. staples), för trafikljus på varje kort.
    from models import PantryItem
    pantry_names = [
        " ".join(name.lower().split())
        for name in session.exec(select(PantryItem.name)).all()
        if name and len(name.strip()) >= 2
    ]

    def _pantry_match(ingredients_json: str) -> dict:
        try:
            ings = json.loads(ingredients_json or "[]")
        except Exception:
            ings = []
        if not ings or not pantry_names:
            return {"total": len(ings), "available": 0, "missing": len(ings)}
        avail = 0
        for ing in ings:
            name = " ".join((ing.get("name") or "").lower().split())
            if len(name) < 2:
                continue
            for pn in pantry_names:
                # Word-boundary check istället för bara substring — så "salt" matchar
                # "havssalt" men "ris" matchar inte "färsk persilja"
                if name == pn or f" {name} " in f" {pn} " or f" {pn} " in f" {name} ":
                    avail += 1
                    break
        return {"total": len(ings), "available": avail, "missing": len(ings) - avail}

    if tags:
        tag_names = [t.strip() for t in tags.split(",")]
        filtered = []
        for recipe in recipes:
            recipe_tags = session.exec(
                select(Tag)
                .join(RecipeTag, RecipeTag.tag_id == Tag.id)
                .where(RecipeTag.recipe_id == recipe.id)
            ).all()
            recipe_tag_names = [t.name for t in recipe_tags]
            if all(tn in recipe_tag_names for tn in tag_names):
                filtered.append(recipe)
        recipes = filtered

    result = []
    for recipe in recipes:
        recipe_tags = session.exec(
            select(Tag)
            .join(RecipeTag, RecipeTag.tag_id == Tag.id)
            .where(RecipeTag.recipe_id == recipe.id)
        ).all()
        can_edit = (recipe.household_id is not None and recipe.household_id == user.household_id)
        result.append({
            **recipe.model_dump(),
            "tags": recipe_tags,
            "is_favorite": recipe.id in user_fav_ids,
            "pantry_match": _pantry_match(recipe.ingredients or "[]"),
            "can_edit": can_edit,
        })

    return result


# ─── AI: generera HELT NYTT recept från pantry ─────────────────

class AIGenerateIn(BaseModel):
    extra_prompt: Optional[str] = None       # frivillig hint ("snabbt", "vego", "barnvänligt")
    save: bool = False                       # spara direkt i databasen


@router.post("/ai-generate-from-pantry")
@limiter.limit("10/minute")
async def ai_generate_from_pantry(
    request: Request,
    data: AIGenerateIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """AI hittar på ett helt nytt recept baserat på pantry-innehållet.
    Returnerar receptet — användaren granskar och kan spara med save=true."""
    from services.ai import chat, safe_parse_json, AIUnavailable
    from models import PantryItem

    items = session.exec(select(PantryItem)).all()
    if not items:
        raise HTTPException(status_code=400, detail="Pantry är tom — lägg till varor först")

    from datetime import date as _date
    today = _date.today()
    pantry_lines = []
    urgent_names: list[str] = []
    for p in items:
        prefix = "📌 " if p.is_staple else ""
        qty = f"{p.amount} {p.unit or ''}".strip() if p.amount else ""
        line = f"- {prefix}{p.name}"
        if qty: line += f" ({qty})"
        if p.location: line += f" — {p.location}"
        if p.expiry_date and not p.is_staple:
            days = (p.expiry_date - today).days
            if days <= 0:
                line += " ⚠️UTGÅNGET"
                urgent_names.append(p.name)
            elif days <= 3:
                line += f" ⚠️{days}d kvar"
                urgent_names.append(p.name)
        pantry_lines.append(line)
    pantry_text = "\n".join(pantry_lines)
    urgent_block_pantry = (
        f"\n⚠️ PRIORITERA STARKT recept som använder: {', '.join(urgent_names)} — de måste användas upp snart!\n"
        if urgent_names else ""
    )

    extra = (data.extra_prompt or "").strip()
    extra_block = f"\nANVÄNDARENS ÖNSKEMÅL: {extra}\n" if extra else ""

    prompt = (
        "Du är en svensk hemkock. Hitta på ETT helt nytt recept för en familj "
        "med två vuxna och två barn (1 + 4,5 år) baserat på vad som finns hemma. "
        "Förslå rätter du faktiskt KAN laga med det du ser, men du kan anta att "
        "salt, peppar, olja och vatten finns även om de inte är listade.\n"
        "VIKTIGT: Välj ETT kolhydrat som passar rätten (t.ex. ris ELLER pasta ELLER potatis — "
        "aldrig flera på samma gång). En paj, soppa eller sallad behöver inte extra kolhydrat.\n\n"
        f"FINNS HEMMA (📌 = basvara, finns alltid):\n{pantry_text}\n"
        f"{urgent_block_pantry}"
        f"{extra_block}\n"
        "Returnera STRICT JSON enligt schemat:\n"
        "{\n"
        '  "title": "<receptnamn på svenska>",\n'
        '  "description": "<1-2 meningar om rätten>",\n'
        '  "ingredients": [{"name": string, "amount": string, "unit": string}],\n'
        '  "instructions": "<numrerade steg, separerade med radbrytning>",\n'
        '  "servings": <int>,\n'
        '  "prep_time": <minuter>,\n'
        '  "cook_time": <minuter>,\n'
        '  "tags": ["tag1", "tag2"],\n'
        '  "why": "<varför det här passar med det du har hemma>"\n'
        "}"
    )

    try:
        raw = await chat(prompt, expect_json=True, task="generate_recipe")
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI inte tillgänglig: {e}")

    parsed = safe_parse_json(raw) or {}
    title = (parsed.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=502, detail="AI returnerade ogiltigt recept")

    raw_ings = parsed.get("ingredients") if isinstance(parsed.get("ingredients"), list) else []
    ings = [
        {"name": str(i.get("name", "")).strip(),
         "amount": str(i.get("amount", "")).strip(),
         "unit": str(i.get("unit", "")).strip()}
        for i in raw_ings if isinstance(i, dict) and i.get("name")
    ]

    raw_instructions = parsed.get("instructions")
    if isinstance(raw_instructions, list):
        raw_instructions = "\n".join(str(s).strip() for s in raw_instructions if s)
    instructions = (raw_instructions or "").strip()

    result = {
        "title": title,
        "description": (parsed.get("description") or "").strip(),
        "ingredients": json.dumps(ings, ensure_ascii=False),
        "instructions": instructions,
        "servings": int(parsed.get("servings", 4)) if parsed.get("servings") else 4,
        "prep_time": parsed.get("prep_time"),
        "cook_time": parsed.get("cook_time"),
        "source_type": "ai",
        "tags_suggested": [str(t).strip().lower() for t in (parsed.get("tags") or []) if t][:5],
        "why": (parsed.get("why") or "").strip(),
    }

    if data.save:
        # Spara direkt + auto-tags
        recipe = Recipe(
            title=result["title"],
            description=result["description"],
            ingredients=result["ingredients"],
            instructions=result["instructions"],
            servings=result["servings"],
            prep_time=result["prep_time"],
            cook_time=result["cook_time"],
            source_type="ai",
        )
        session.add(recipe)
        session.commit()
        session.refresh(recipe)
        # Skapa/applicera tags
        for tag_name in result["tags_suggested"]:
            tag = session.exec(select(Tag).where(Tag.name == tag_name)).first()
            if not tag:
                tag = Tag(name=tag_name)
                session.add(tag)
                session.commit()
                session.refresh(tag)
            session.add(RecipeTag(recipe_id=recipe.id, tag_id=tag.id))
        session.commit()
        log_audit(session, user, "recipe.ai_generated",
                  entity_type="recipe", entity_id=recipe.id,
                  details={"title": recipe.title})
        result["saved_id"] = recipe.id

    return result


# ─── Slumpgenerator "Vad lagar vi?" ──────────────────────────────
# MÅSTE definieras FÖRE /{recipe_id} — annars matchar FastAPI "random" som int → 422.

@router.get("/random")
def random_recipe(
    pantry_priority: bool = True,
    max_time: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Returnerar ETT slumpat recept. Med pantry_priority=true viktas recept
    där du har många ingredienser hemma — annars rent slumpat."""
    import random as _random
    from models import PantryItem

    from sqlalchemy import or_ as _or
    visible_filter = (
        _or(Recipe.visibility == "public", Recipe.household_id == user.household_id)
        if user.household_id is not None
        else Recipe.visibility == "public"
    )
    recipes = list(session.exec(select(Recipe).where(visible_filter)).all())
    if max_time:
        recipes = [r for r in recipes if ((r.prep_time or 0) + (r.cook_time or 0)) <= max_time]
    if not recipes:
        raise HTTPException(status_code=404, detail="Inga recept att slumpa bland")

    if pantry_priority:
        pantry_names = [
            " ".join(name.lower().split())
            for name in session.exec(select(PantryItem.name)).all()
            if name and len(name.strip()) >= 2
        ]
        if pantry_names:
            weighted = []
            for r in recipes:
                try:
                    ings = json.loads(r.ingredients or "[]")
                except Exception:
                    ings = []
                if not ings:
                    weighted.append((r, 1))
                    continue
                avail = 0
                for ing in ings:
                    name = " ".join((ing.get("name") or "").lower().split())
                    if len(name) < 2: continue
                    if any(name == pn or f" {name} " in f" {pn} " or f" {pn} " in f" {name} "
                           for pn in pantry_names):
                        avail += 1
                w = 1 + int(3 * (avail / max(1, len(ings))) * 10)
                weighted.append((r, w))
            chosen = _random.choices(
                [r for r, _ in weighted],
                weights=[w for _, w in weighted],
                k=1
            )[0]
            return _hydrate_recipe(chosen.id, session, user)

    return _hydrate_recipe(_random.choice(recipes).id, session, user)


@router.get("/{recipe_id}")
def get_recipe(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    # Block access to private recipes from other households
    if recipe.visibility == "private" and recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Receptet är privat")

    tags = session.exec(
        select(Tag)
        .join(RecipeTag, RecipeTag.tag_id == Tag.id)
        .where(RecipeTag.recipe_id == recipe_id)
    ).all()

    images = session.exec(
        select(RecipeImage).where(RecipeImage.recipe_id == recipe_id)
    ).all()

    can_edit = (recipe.household_id is not None and recipe.household_id == user.household_id)
    return {**recipe.model_dump(), "tags": tags, "images": images, "can_edit": can_edit}


def _hydrate_recipe(recipe_id: int, session: Session, user: Optional[User] = None) -> dict:
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    tags = session.exec(
        select(Tag)
        .join(RecipeTag, RecipeTag.tag_id == Tag.id)
        .where(RecipeTag.recipe_id == recipe_id)
    ).all()
    images = session.exec(
        select(RecipeImage).where(RecipeImage.recipe_id == recipe_id)
    ).all()
    can_edit = user is not None and recipe.household_id is not None and recipe.household_id == user.household_id
    return {**recipe.model_dump(), "tags": tags, "images": images, "can_edit": can_edit}


class RecipeCreate(BaseModel):
    title: str
    description: Optional[str] = None
    ingredients: str = "[]"
    instructions: str = ""
    servings: int = 4
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    source_url: Optional[str] = None
    source_type: str = "manual"
    cover_image: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    visibility: str = "private"
    tag_ids: list[int] = []


class RecipeUpdate(BaseModel):
    """Explicit allowlist av uppdateringsbara fält — skyddar mot mass-assignment."""
    title: Optional[str] = None
    description: Optional[str] = None
    ingredients: Optional[str] = None
    instructions: Optional[str] = None
    servings: Optional[int] = None
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    cover_image: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    visibility: Optional[str] = None
    tag_ids: Optional[list[int]] = None


class BulkDeleteIn(BaseModel):
    ids: list[int]


@router.post("/bulk-delete")
def bulk_delete_recipes(
    data: BulkDeleteIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Radera flera recept i ett anrop. Tar med bilder + tags + favoriter."""
    if not data.ids:
        raise HTTPException(status_code=400, detail="Tom lista")
    if len(data.ids) > 500:
        raise HTTPException(status_code=400, detail="Max 500 per anrop")

    from models import Favorite, RecipeCollection
    deleted = 0
    for recipe_id in data.ids:
        recipe = session.get(Recipe, recipe_id)
        if not recipe or recipe.household_id != user.household_id:
            continue
        # Rensa kopplade rader först (FK constraints)
        for img in session.exec(select(RecipeImage).where(RecipeImage.recipe_id == recipe_id)).all():
            for path in [
                os.path.join(UPLOAD_DIR, img.filename),
                os.path.join(UPLOAD_DIR, f"thumb_{img.filename}"),
            ]:
                if os.path.exists(path):
                    try: os.remove(path)
                    except OSError: pass
            session.delete(img)
        for rt in session.exec(select(RecipeTag).where(RecipeTag.recipe_id == recipe_id)).all():
            session.delete(rt)
        for fav in session.exec(select(Favorite).where(Favorite.recipe_id == recipe_id)).all():
            session.delete(fav)
        for rc in session.exec(select(RecipeCollection).where(RecipeCollection.recipe_id == recipe_id)).all():
            session.delete(rc)
        session.delete(recipe)
        deleted += 1
    session.commit()

    log_audit(session, user, "recipe.bulk_delete", entity_type="recipe",
              details={"requested": len(data.ids), "deleted": deleted})

    return {"requested": len(data.ids), "deleted": deleted}


@router.post("/bulk")
def bulk_create_recipes(
    items: list[RecipeCreate],
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Spara många recept i ett anrop — används av PDF-importens 'Spara alla'."""
    if not items:
        raise HTTPException(status_code=400, detail="Tom lista")
    if len(items) > 200:
        raise HTTPException(status_code=400, detail="Max 200 recept per anrop")

    created_ids: list[int] = []
    for data in items:
        # Skippa dubbletter baserat på source_url
        if data.source_url:
            if session.exec(select(Recipe).where(Recipe.source_url == data.source_url)).first():
                continue
        recipe = Recipe(
            title=data.title,
            description=data.description,
            ingredients=data.ingredients,
            instructions=data.instructions,
            servings=data.servings,
            prep_time=data.prep_time,
            cook_time=data.cook_time,
            source_url=data.source_url,
            source_type=data.source_type,
            cover_image=data.cover_image,
            calories=data.calories,
            protein=data.protein,
            carbs=data.carbs,
            fat=data.fat,
            visibility=_safe_visibility(data.visibility, data.source_url),
            household_id=user.household_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        session.add(recipe)
        session.commit()
        session.refresh(recipe)
        for tag_id in data.tag_ids:
            session.add(RecipeTag(recipe_id=recipe.id, tag_id=tag_id))
        created_ids.append(recipe.id)
    session.commit()

    log_audit(session, user, "recipe.bulk_create", entity_type="recipe",
              details={"count": len(created_ids), "ids": created_ids[:20]})

    return {"created": len(created_ids), "ids": created_ids}


def _safe_visibility(requested: Optional[str], source_url: Optional[str]) -> str:
    """Importerade recept (source_url satt) får ALDRIG vara publika — upphovsrätt.

    Instruktionstext och foton från externa sajter är skyddat material.
    Privat bruk inom hushållet är OK; återpublicering i publika biblioteket är det inte.
    """
    if source_url:
        return "private"
    return requested if requested in ("public", "private") else "private"


def _build_recipe(data: RecipeCreate, household_id: Optional[int] = None) -> Recipe:
    return Recipe(
        title=data.title,
        description=data.description,
        ingredients=data.ingredients,
        instructions=data.instructions,
        servings=data.servings,
        prep_time=data.prep_time,
        cook_time=data.cook_time,
        source_url=data.source_url,
        source_type=data.source_type,
        cover_image=data.cover_image,
        calories=data.calories,
        protein=data.protein,
        carbs=data.carbs,
        fat=data.fat,
        visibility=_safe_visibility(data.visibility, data.source_url),
        household_id=household_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


@router.post("", response_model=Recipe)
def create_recipe(
    data: RecipeCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = _build_recipe(data, household_id=user.household_id)
    session.add(recipe)
    session.commit()
    session.refresh(recipe)

    for tag_id in data.tag_ids:
        session.add(RecipeTag(recipe_id=recipe.id, tag_id=tag_id))
    session.commit()

    log_audit(session, user, "recipe.create", entity_type="recipe", entity_id=recipe.id,
              details={"title": recipe.title, "source_type": recipe.source_type})
    return recipe


@router.post("/create")
def create_recipe_with_tags(
    data: RecipeCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Dubblettskydd — jämför normaliserade URL:er (strippar UTM-params, /reel/→/p/ etc.)
    if data.source_url:
        normalized = _normalize_url(data.source_url)
        all_recipes = session.exec(select(Recipe.id, Recipe.title, Recipe.source_url)).all()
        existing = next(
            (r for r in all_recipes if r.source_url and _normalize_url(r.source_url) == normalized),
            None,
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail={"exists": True, "id": existing.id, "title": existing.title},
            )

    recipe = _build_recipe(data, household_id=user.household_id)
    session.add(recipe)
    session.commit()
    session.refresh(recipe)

    for tag_id in data.tag_ids:
        session.add(RecipeTag(recipe_id=recipe.id, tag_id=tag_id))
    session.commit()

    log_audit(session, user, "recipe.create", entity_type="recipe", entity_id=recipe.id,
              details={"title": recipe.title, "source_type": recipe.source_type})

    return _hydrate_recipe(recipe.id, session, user)


@router.put("/{recipe_id}")
def update_recipe(
    recipe_id: int,
    data: RecipeUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.household_id is not None and recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Du kan bara redigera receptet om du tillhör samma hushåll")

    update_fields = data.model_dump(exclude_none=True, exclude={"tag_ids"})
    if "visibility" in update_fields and user.role != "admin":
        raise HTTPException(status_code=403, detail="Bara admins kan ändra synlighet")
    # Admin kan medvetet publicera importerade recept (source_url satt) — beslutat
    # 2026-09-14 eftersom appen är invite-only och "publik" innebär "synlig för
    # inbjudna hushåll", inte öppet internet. Se README.md.
    changed = []
    for key, value in update_fields.items():
        setattr(recipe, key, value)
        changed.append(key)
    recipe.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(recipe)

    if data.tag_ids is not None:
        existing = session.exec(
            select(RecipeTag).where(RecipeTag.recipe_id == recipe_id)
        ).all()
        for rt in existing:
            session.delete(rt)
        for tag_id in data.tag_ids:
            session.add(RecipeTag(recipe_id=recipe_id, tag_id=tag_id))
        session.commit()

    log_audit(session, user, "recipe.update", entity_type="recipe", entity_id=recipe_id,
              details={"title": recipe.title, "fields": changed})

    return _hydrate_recipe(recipe_id, session, user)


@router.delete("/{recipe_id}")
def delete_recipe(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.household_id is not None and recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Du kan bara radera receptet om du tillhör samma hushåll")

    title = recipe.title

    images = session.exec(
        select(RecipeImage).where(RecipeImage.recipe_id == recipe_id)
    ).all()
    for img in images:
        for path in [
            os.path.join(UPLOAD_DIR, img.filename),
            os.path.join(UPLOAD_DIR, f"thumb_{img.filename}"),
        ]:
            if os.path.exists(path):
                os.remove(path)
        session.delete(img)

    from models import Favorite, RecipeCollection
    for rt in session.exec(select(RecipeTag).where(RecipeTag.recipe_id == recipe_id)).all():
        session.delete(rt)
    for fav in session.exec(select(Favorite).where(Favorite.recipe_id == recipe_id)).all():
        session.delete(fav)
    for rc in session.exec(select(RecipeCollection).where(RecipeCollection.recipe_id == recipe_id)).all():
        session.delete(rc)

    session.delete(recipe)
    session.commit()

    log_audit(session, user, "recipe.delete", entity_type="recipe", entity_id=recipe_id,
              details={"title": title})
    return {"ok": True}


# ─── Ratings & "senast lagad" ─────────────────────────────────────

class RatingIn(BaseModel):
    rating: Optional[int] = None  # 1-5 eller null för att rensa


@router.put("/{recipe_id}/rating")
def set_rating(
    recipe_id: int,
    data: RatingIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")
    if data.rating is not None and not (1 <= data.rating <= 5):
        raise HTTPException(status_code=400, detail="Rating måste vara 1-5")
    recipe.rating = data.rating
    recipe.updated_at = datetime.now(timezone.utc)
    session.commit()
    log_audit(session, user, "recipe.rate", entity_type="recipe", entity_id=recipe_id,
              details={"rating": data.rating})
    return {"ok": True, "rating": recipe.rating}


# ─── Export ──────────────────────────────────────────────────────

@router.get("/export/json")
def export_json(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Hel-export av alla recept + tags som JSON. Migrationsförsäkring."""
    from fastapi.responses import JSONResponse
    recipes = session.exec(select(Recipe)).all()
    out = []
    for r in recipes:
        tags = session.exec(
            select(Tag).join(RecipeTag, RecipeTag.tag_id == Tag.id)
            .where(RecipeTag.recipe_id == r.id)
        ).all()
        out.append({
            **r.model_dump(mode="json"),
            "tags": [{"name": t.name, "color": t.color} for t in tags],
        })
    return JSONResponse(
        content={"version": "1.0", "exported_at": datetime.now(timezone.utc).isoformat(),
                 "count": len(out), "recipes": out},
        headers={"Content-Disposition": f'attachment; filename="skaffio-export-{datetime.now(timezone.utc):%Y%m%d}.json"'}
    )


@router.get("/{recipe_id}/export/pdf")
def export_recipe_pdf(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Single-recipe PDF för utskrift. Genererad on-demand via PyMuPDF."""
    import fitz
    from fastapi.responses import Response

    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")

    try:
        ings = json.loads(recipe.ingredients or "[]")
    except Exception:
        ings = []

    # Bygg textinnehåll
    lines = [recipe.title, ""]
    if recipe.description:
        lines += [recipe.description, ""]
    meta = []
    if recipe.prep_time: meta.append(f"Förb: {recipe.prep_time} min")
    if recipe.cook_time: meta.append(f"Tillagning: {recipe.cook_time} min")
    meta.append(f"{recipe.servings} portioner")
    lines.append(" · ".join(meta))
    lines.append("")
    lines.append("INGREDIENSER")
    lines.append("─" * 40)
    for ing in ings:
        amt = f"{ing.get('amount', '')} {ing.get('unit', '')}".strip()
        lines.append(f"  {amt:<12} {ing.get('name', '')}")
    lines.append("")
    lines.append("INSTRUKTIONER")
    lines.append("─" * 40)
    lines.append(recipe.instructions or "")
    if recipe.source_url:
        lines += ["", f"Källa: {recipe.source_url}"]

    text = "\n".join(lines)

    # Skapa PDF
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4
    page.insert_text((50, 60), recipe.title, fontsize=20, fontname="helv")
    page.insert_textbox(
        fitz.Rect(50, 90, 545, 800),
        "\n".join(lines[2:]),
        fontsize=11,
        fontname="helv",
    )
    buf = doc.tobytes()
    doc.close()

    safe_name = "".join(c if c.isalnum() or c in " -_" else "_" for c in recipe.title)[:50].strip()
    return Response(
        content=buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name or recipe.title[:20]}.pdf"'},
    )


# ─── Publik delning ─────────────────────────────────────────────

@router.post("/{recipe_id}/share")
def create_share_link(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    import uuid
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")
    if not recipe.share_token:
        recipe.share_token = _secrets.token_urlsafe(16)
        recipe.updated_at = datetime.now(timezone.utc)
        session.commit()
    log_audit(session, user, "recipe.share", entity_type="recipe", entity_id=recipe_id)
    return {"token": recipe.share_token, "url": f"/shared/recipe/{recipe.share_token}"}


@router.delete("/{recipe_id}/share")
def revoke_share_link(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")
    recipe.share_token = None
    recipe.updated_at = datetime.now(timezone.utc)
    session.commit()
    log_audit(session, user, "recipe.share_revoke", entity_type="recipe", entity_id=recipe_id)
    return {"ok": True}


@router.get("/share/{token}")
def get_shared_recipe(
    token: str,
    session: Session = Depends(get_session),
):
    """Publik endpoint — kräver INGEN auth. Token = capability."""
    recipe = session.exec(
        select(Recipe).where(Recipe.share_token == token)
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Delningslänken finns inte eller har återkallats")
    tags = session.exec(
        select(Tag).join(RecipeTag, RecipeTag.tag_id == Tag.id)
        .where(RecipeTag.recipe_id == recipe.id)
    ).all()
    images = session.exec(
        select(RecipeImage).where(RecipeImage.recipe_id == recipe.id)
    ).all()
    return {**recipe.model_dump(), "tags": tags, "images": images}


# ─── AI-receptsök ─────────────────────────────────────────────────

class AISearchIn(BaseModel):
    query: str


@router.post("/ai-search")
@limiter.limit("20/minute")
async def ai_search(
    request: Request,
    data: AISearchIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Semantisk receptsök. Användaren skriver fritt
    ("snabbt med kyckling och pasta") och AI:n returnerar id-lista
    rankad efter relevans."""
    from services.ai import chat, safe_parse_json, AIUnavailable

    query = (data.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Tom sökfråga")
    if len(query) > 300:
        raise HTTPException(status_code=400, detail="Max 300 tecken")

    recipes = session.exec(select(Recipe)).all()
    if not recipes:
        return {"ids": [], "summary": "Inga recept i databasen."}

    # Bygg kompakt katalog för AI:n
    lines = []
    for r in recipes:
        try:
            ings = json.loads(r.ingredients or "[]")
            ing_names = ", ".join(i.get("name", "") for i in ings[:10] if i.get("name"))
        except Exception:
            ing_names = ""
        time = (r.prep_time or 0) + (r.cook_time or 0)
        lines.append(f"id={r.id} | {r.title} | {time}min | {ing_names[:120]}")

    catalog = "\n".join(lines)
    system = (
        "Du hjälper en svensk hemkock att hitta recept i deras egen samling. "
        "Returnera ENBART JSON: {\"ids\": [int], \"summary\": \"<en mening>\"}. "
        "Lista 1-10 recept rankade efter relevans mot sökfrågan. "
        "Om inget matchar bra, returnera tom lista."
    )
    prompt = f"SÖKFRÅGA:\n{query}\n\nRECEPT I SAMLINGEN:\n{catalog}\n\nReturnera JSON enligt schemat."

    try:
        raw = await chat(prompt, system=system, expect_json=True, task="ai_search")
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI inte tillgänglig: {e}")

    parsed = safe_parse_json(raw) or {}
    ids = parsed.get("ids") or []
    valid_ids = {r.id for r in recipes}
    ids = [int(i) for i in ids if isinstance(i, (int, str)) and str(i).isdigit() and int(i) in valid_ids][:10]
    return {"ids": ids, "summary": parsed.get("summary", "")}


@router.post("/{recipe_id}/calculate-macros")
@limiter.limit("30/minute")
async def calculate_macros(
    request: Request,
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """AI räknar ut kalorier, protein, kolhydrater, fett per portion baserat
    på ingredienser. Sparas på receptet."""
    from services.ai import chat, safe_parse_json, AIUnavailable

    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")

    try:
        ings = json.loads(recipe.ingredients or "[]")
    except Exception:
        ings = []
    if not ings:
        raise HTTPException(status_code=400, detail="Receptet har inga ingredienser")

    ing_lines = [
        f"- {i.get('amount', '')} {i.get('unit', '')} {i.get('name', '')}".strip()
        for i in ings if i.get("name")
    ]
    prompt = (
        f"Räkna ut näringsvärden per portion för detta recept med {recipe.servings} portioner. "
        "Använd standardvärden för svenska livsmedel. Var konservativ om mängden är otydlig.\n\n"
        f"INGREDIENSER:\n" + "\n".join(ing_lines) + "\n\n"
        "Returnera STRICT JSON med värden PER PORTION:\n"
        '{"calories": int, "protein": float, "carbs": float, "fat": float}'
    )

    try:
        raw = await chat(prompt, expect_json=True)
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI inte tillgänglig: {e}")

    parsed = safe_parse_json(raw) or {}
    try:
        recipe.calories = int(parsed.get("calories")) if parsed.get("calories") is not None else None
        recipe.protein  = float(parsed.get("protein"))  if parsed.get("protein")  is not None else None
        recipe.carbs    = float(parsed.get("carbs"))    if parsed.get("carbs")    is not None else None
        recipe.fat      = float(parsed.get("fat"))      if parsed.get("fat")      is not None else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=502, detail="AI returnerade ogiltigt format")

    recipe.updated_at = datetime.now(timezone.utc)
    session.commit()
    log_audit(session, user, "recipe.calc_macros", entity_type="recipe", entity_id=recipe_id)
    return {
        "calories": recipe.calories,
        "protein": recipe.protein,
        "carbs": recipe.carbs,
        "fat": recipe.fat,
    }


class CookedIn(BaseModel):
    servings: Optional[int] = None   # om None, använd receptets standard
    deduct_pantry: bool = True


@router.post("/{recipe_id}/cooked")
def mark_cooked(
    recipe_id: int,
    data: CookedIn = CookedIn(),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Marker receptet som lagat NU. Drar automatiskt av ingredienser från pantry."""
    from models import PantryItem
    import re as _re

    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Receptet finns inte")
    if recipe.household_id is not None and recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Inte ditt recept")

    recipe.times_cooked = (recipe.times_cooked or 0) + 1
    recipe.last_cooked_at = datetime.now(timezone.utc)
    recipe.updated_at = datetime.now(timezone.utc)
    session.commit()

    deducted = []
    shortages = []

    if data.deduct_pantry:
        try:
            ingredients = json.loads(recipe.ingredients or "[]")
        except Exception:
            ingredients = []

        scale = (data.servings or recipe.servings) / max(1, recipe.servings)

        def _norm(text: str) -> str:
            return _re.sub(r"[^\wåäö]", "", (text or "").lower())

        pantry_items = session.exec(select(PantryItem).where(PantryItem.household_id == user.household_id)).all()
        pantry_lookup = {_norm(p.name): p for p in pantry_items}

        for ing in ingredients:
            name = ing.get("name", "")
            needle = _norm(name)
            if not needle:
                continue

            # Fuzzy match: hitta pantry-vara där namnen överlappar
            matched = None
            for pname, pitem in pantry_lookup.items():
                if needle in pname or pname in needle:
                    matched = pitem
                    break

            if not matched:
                continue

            try:
                ing_amount = float(ing.get("amount") or 0) * scale
            except (TypeError, ValueError):
                ing_amount = 0.0

            if ing_amount <= 0 or matched.amount is None:
                # Ingen mängd att dra av — bara notera att vi har den
                deducted.append({"name": name, "deducted": None, "remaining": None})
                continue

            remaining = round(matched.amount - ing_amount, 2)
            if remaining <= 0:
                shortages.append({"name": name, "needed": ing_amount, "had": matched.amount})
                matched.amount = 0
            else:
                matched.amount = remaining
                deducted.append({
                    "name": name,
                    "deducted": round(ing_amount, 2),
                    "remaining": remaining,
                    "unit": matched.unit,
                })
            session.add(matched)

        session.commit()

    log_audit(session, user, "recipe.cooked", entity_type="recipe", entity_id=recipe_id,
              details={"times_cooked": recipe.times_cooked, "deducted": len(deducted), "shortages": len(shortages)})
    return {
        "ok": True,
        "times_cooked": recipe.times_cooked,
        "last_cooked_at": recipe.last_cooked_at.isoformat() if recipe.last_cooked_at else None,
        "pantry_deducted": deducted,
        "pantry_shortages": shortages,
    }


# ─── Fork ─────────────────────────────────────────────────────────

@router.post("/{recipe_id}/fork")
def fork_recipe(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Kopiera ett publikt recept till det egna hushållet (privat kopia)."""
    original = session.get(Recipe, recipe_id)
    if not original:
        raise HTTPException(status_code=404, detail="Receptet finns inte")
    if original.visibility == "private" and original.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Receptet är privat")

    forked = Recipe(
        title=original.title,
        description=original.description,
        ingredients=original.ingredients,
        instructions=original.instructions,
        servings=original.servings,
        prep_time=original.prep_time,
        cook_time=original.cook_time,
        source_url=original.source_url,
        source_type="fork",
        cover_image=original.cover_image,
        calories=original.calories,
        protein=original.protein,
        carbs=original.carbs,
        fat=original.fat,
        visibility="private",
        household_id=user.household_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(forked)
    session.commit()
    session.refresh(forked)

    # Kopiera tags
    original_tags = session.exec(
        select(RecipeTag).where(RecipeTag.recipe_id == recipe_id)
    ).all()
    for rt in original_tags:
        session.add(RecipeTag(recipe_id=forked.id, tag_id=rt.tag_id))
    session.commit()

    log_audit(session, user, "recipe.fork", entity_type="recipe", entity_id=forked.id,
              details={"from_id": recipe_id, "title": forked.title})

    return {"id": forked.id, "title": forked.title}


# ─── AI-omskrivning ────────────────────────────────────────────────
# "Skapa min egen version" — AI skriver om instruktioner/beskrivning med egna ord.
# Resultatet har INGEN source_url och INGEN cover_image → kan publiceras lagligt.
# (Rätten/metoden är inte upphovsrättsskyddad — bara källans text och foton.)

@router.post("/{recipe_id}/rewrite")
async def rewrite_recipe(
    recipe_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from services.ai import chat, safe_parse_json, AIUnavailable

    original = session.get(Recipe, recipe_id)
    if not original:
        raise HTTPException(status_code=404, detail="Receptet finns inte")
    if original.visibility == "private" and original.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Receptet är privat")

    prompt = (
        "Skriv om följande recept med HELT egna ord på svenska. "
        "Behåll exakta mängder, ingredienser, temperaturer och tillagningstider — "
        "men formulera beskrivning och instruktioner självständigt, som om du "
        "förklarar rätten för en vän. Kopiera INTE källtextens formuleringar.\n\n"
        'Returnera STRICT JSON: {"title": string, "description": string, '
        '"instructions": string}\n\n'
        f"TITEL: {original.title}\n"
        f"BESKRIVNING: {original.description or ''}\n"
        f"INGREDIENSER: {original.ingredients}\n"
        f"INSTRUKTIONER:\n{original.instructions}"
    )
    try:
        raw = await chat(prompt, expect_json=True, task="rewrite")
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI:n är inte tillgänglig just nu: {e}")

    parsed = safe_parse_json(raw) or {}
    new_instructions = str(parsed.get("instructions") or "").strip()
    if not new_instructions:
        raise HTTPException(status_code=502, detail="AI:n returnerade inga instruktioner — försök igen")

    # AI-genererad cover-bild (Nano Banana) — fail-soft, receptet skapas även utan.
    new_cover = None
    try:
        from services.ai import generate_image
        from routes.images import create_thumbnail
        import uuid as _uuid
        img_bytes = await generate_image(
            f"Professionell matfotografi av {parsed.get('title') or original.title}. "
            "Aptitretande, naturligt dagsljus, serverad på tallrik, ovanifrån-vinkel, "
            "skandinavisk stil. Ingen text i bilden."
        )
        if img_bytes:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            filename = f"rewrite-{_uuid.uuid4().hex[:10]}.png"
            path = os.path.join(UPLOAD_DIR, filename)
            with open(path, "wb") as f:
                f.write(img_bytes)
            create_thumbnail(path, os.path.join(UPLOAD_DIR, f"thumb_{filename.rsplit('.', 1)[0]}.jpg"))
            new_cover = filename
    except Exception:
        pass  # bild är nice-to-have

    rewritten = Recipe(
        title=str(parsed.get("title") or original.title).strip(),
        description=str(parsed.get("description") or "").strip(),
        ingredients=original.ingredients,   # fakta — inte skyddat
        instructions=new_instructions,
        servings=original.servings,
        prep_time=original.prep_time,
        cook_time=original.cook_time,
        source_url=None,                    # ingen källänk = publicerbart
        source_type="rewrite",
        cover_image=new_cover,              # AI-genererad — källans foto följer ALDRIG med
        calories=original.calories,
        protein=original.protein,
        carbs=original.carbs,
        fat=original.fat,
        visibility="private",
        household_id=user.household_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(rewritten)
    session.commit()
    session.refresh(rewritten)

    # Kopiera tags från originalet
    for rt in session.exec(select(RecipeTag).where(RecipeTag.recipe_id == recipe_id)).all():
        session.add(RecipeTag(recipe_id=rewritten.id, tag_id=rt.tag_id))
    session.commit()

    log_audit(session, user, "recipe.rewrite", entity_type="recipe", entity_id=rewritten.id,
              details={"from_id": recipe_id, "title": rewritten.title})

    return {"id": rewritten.id, "title": rewritten.title}


# ─── Smart Substitution ────────────────────────────────────────────

class SubstituteIn(BaseModel):
    ingredient: str
    amount: Optional[str] = None
    unit: Optional[str] = None


@router.post("/{recipe_id}/substitute")
@limiter.limit("20/minute")
async def suggest_substitute(
    recipe_id: int,
    request: Request,
    data: SubstituteIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """AI föreslår ersättare för en ingrediens — prioriterar det som redan finns i pantryn."""
    from services.ai import chat, safe_parse_json, AIUnavailable
    from models import PantryItem

    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recept hittades inte")

    # Bygg pantry-kontext
    pantry_items = session.exec(select(PantryItem)).all()
    pantry_lines = []
    for p in pantry_items:
        qty = f" ({p.amount} {p.unit or ''})" if p.amount else ""
        pantry_lines.append(f"- {p.name}{qty}")
    pantry_text = "\n".join(pantry_lines) if pantry_lines else "(Pantryn är tom)"

    qty_str = f"{data.amount} {data.unit}".strip() if data.amount else ""
    ing_str = data.ingredient + (f" ({qty_str})" if qty_str else "")

    prompt = (
        f"Du är en professionell kock och ersättningsexpert. Svara ALLTID på svenska.\n\n"
        f"RECEPT: {recipe.title}\n"
        f"SAKNAD INGREDIENS: {ing_str}\n\n"
        f"VAD ANVÄNDAREN HAR HEMMA:\n{pantry_text}\n\n"
        "Hitta BÄSTA ersättaren för den saknade ingrediensen. "
        "Titta NOGA i pantry-listan — prioritera vad användaren redan har hemma. "
        "Om inget lämpligt finns i pantryn, föreslå ett vanligt alternativ.\n\n"
        "Returnera STRICT JSON (inget annat):\n"
        "{\n"
        '  "found_in_pantry": true,\n'
        '  "pantry_item": "exakt namn från pantry-listan, eller null om inget lämpligt finns",\n'
        '  "substitute": "ersättarens namn",\n'
        '  "amount_note": "mängdjustering om nödvändigt, t.ex. \'använd 20% mer\', annars null",\n'
        '  "explanation": "Varför det fungerar och hur smak/konsistens ändras (1-2 meningar)",\n'
        '  "allergen_warning": "Varning om ersättaren ändrar allergen-profil (laktos/gluten/nötter), annars null"\n'
        "}"
    )

    try:
        raw = await chat(prompt, expect_json=True, task="substitute")
        parsed = safe_parse_json(raw) or {}
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI inte tillgänglig: {e}")

    return {
        "original": data.ingredient,
        "found_in_pantry": bool(parsed.get("found_in_pantry")),
        "pantry_item": parsed.get("pantry_item"),
        "substitute": parsed.get("substitute", ""),
        "amount_note": parsed.get("amount_note"),
        "explanation": parsed.get("explanation", ""),
        "allergen_warning": parsed.get("allergen_warning"),
    }


# ─── Prep-Master Game Plan ─────────────────────────────────────────

class PrepPlanIn(BaseModel):
    recipe_ids: list[int]


@router.post("/prep-plan")
@limiter.limit("5/minute")
async def generate_prep_plan(
    request: Request,
    data: PrepPlanIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """AI skapar en optimerad köksplan (Game Plan) för batch-cooking av flera recept."""
    from services.ai import chat, safe_parse_json, AIUnavailable
    from models import PantryItem

    if not (2 <= len(data.recipe_ids) <= 6):
        raise HTTPException(status_code=400, detail="Välj 2–6 recept")

    # Hämta recept
    recipes_data = []
    for rid in data.recipe_ids:
        r = session.get(Recipe, rid)
        if not r:
            continue
        # Kontrollera synlighet
        if r.visibility == "private" and r.household_id != user.household_id:
            continue
        ings = []
        try:
            ings = json.loads(r.ingredients or "[]")
        except Exception:
            pass
        recipes_data.append({
            "title": r.title,
            "servings": r.servings or 4,
            "prep_time": r.prep_time,
            "cook_time": r.cook_time,
            "ingredients": ings,
            "instructions": (r.instructions or "")[:800],  # begränsa längd
        })

    if not recipes_data:
        raise HTTPException(status_code=404, detail="Inga giltiga recept hittades")

    # Pantry-kontext (frys/kyl-varor för tiningslista)
    from models import PantryItem as _PI
    pantry_items = session.exec(select(_PI)).all()
    freezer_items = [p.name for p in pantry_items if "Frys" in (p.location or "")]
    pantry_names = [p.name for p in pantry_items]

    # Bygg receptbeskrivningar för AI
    recipe_blocks = []
    for r in recipes_data:
        ing_lines = "\n".join(
            f"  - {i.get('amount','')} {i.get('unit','')} {i.get('name','')}".strip()
            for i in r["ingredients"]
        )
        times = []
        if r["prep_time"]: times.append(f"förb {r['prep_time']} min")
        if r["cook_time"]:  times.append(f"tillagn {r['cook_time']} min")
        time_str = ", ".join(times) or "tid okänd"
        recipe_blocks.append(
            f"### {r['title']} ({r['servings']} port, {time_str})\n"
            f"Ingredienser:\n{ing_lines}\n"
            f"Instruktioner (sammanfattat): {r['instructions'][:400]}"
        )

    recipes_text = "\n\n".join(recipe_blocks)
    freezer_ctx = f"\nVaror i frysen: {', '.join(freezer_items)}" if freezer_items else ""

    prompt = f"""Du är en expert på meal-prep och kök-logistik. Svara ALLTID på svenska.

Användaren ska batch-laga dessa recept:

{recipes_text}
{freezer_ctx}

Skapa en optimerad 'Game Plan' med tre optimeringar:
1. INGREDIENS-KONSOLIDERING: Gruppera samma ingredienser. T.ex. "Hacka totalt 5 lökar (3 till X, 2 till Y)".
2. TIDS-OPTIMERING: Identifiera parallellt arbete under väntetid. T.ex. "Medan såsen sjuder 20 min → förbered Y".
3. UGNS-OPTIMERING: Gruppera rätter med liknande temperatur i ugnen.

Inkludera även:
- tiningslista: vad som behöver tas ur frysen dagen/kvällen innan
- förvaringstips: hur man bäst förvarar det färdiglagade

Returnera STRICT JSON (INGET annat):
{{
  "summary": "Kort beskrivning av planen (1 mening)",
  "total_time_estimate": "t.ex. '2h 30min' — parallellt optimerad tid",
  "thaw_list": [
    {{"item": "ingrediensnamn + mängd", "note": "Ta ut X timmar/dagar innan"}}
  ],
  "phases": [
    {{
      "id": "prep",
      "title": "Förberedelser",
      "emoji": "🔪",
      "steps": [
        {{"text": "Stegbeskrivning", "time_min": 10, "recipes": ["Receptnamn1"], "shared": true}}
      ]
    }},
    {{
      "id": "active",
      "title": "Aktiv matlagning",
      "emoji": "🍳",
      "steps": [
        {{"text": "Stegbeskrivning", "time_min": 20, "recipes": ["Receptnamn1", "Receptnamn2"], "shared": false}}
      ]
    }},
    {{
      "id": "storage",
      "title": "Förvaring & tips",
      "emoji": "🧊",
      "steps": [
        {{"text": "Stegbeskrivning", "time_min": null, "recipes": ["Receptnamn1"], "shared": false}}
      ]
    }}
  ]
}}"""

    try:
        raw = await chat(prompt, expect_json=True, task="prep_plan")
        parsed = safe_parse_json(raw) or {}
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=f"AI inte tillgänglig: {e}")

    return {
        "recipes": [r["title"] for r in recipes_data],
        "summary": parsed.get("summary", ""),
        "total_time_estimate": parsed.get("total_time_estimate", ""),
        "thaw_list": parsed.get("thaw_list") or [],
        "phases": parsed.get("phases") or [],
    }
