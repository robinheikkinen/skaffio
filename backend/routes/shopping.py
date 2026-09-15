import json
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from database import get_session
from models import ShoppingList, Recipe, PantryItem, User
from services.audit import log_audit
from services.auth import get_current_user
from services.hass import fetch_inventory, match_ingredient
from services.grocery_categories import categorize, sort_key, CATEGORIES

router = APIRouter(prefix="/shopping", tags=["shopping"])


def scale_ingredients(ingredients_json: str, original_servings: int, target_servings: int) -> list:
    items = json.loads(ingredients_json)
    if original_servings <= 0:
        return items
    factor = target_servings / original_servings
    scaled = []
    for item in items:
        new_item = dict(item)
        try:
            amount = float(item.get("amount", 0) or 0)
            new_item["amount"] = str(round(amount * factor, 2)).rstrip("0").rstrip(".")
        except (ValueError, TypeError):
            pass
        scaled.append(new_item)
    return scaled


def merge_ingredients(all_items: list) -> list:
    merged = {}
    for item in all_items:
        key = (item["name"].lower().strip(), item.get("unit", "").lower().strip())
        if key in merged:
            try:
                existing = float(merged[key].get("amount", 0) or 0)
                new = float(item.get("amount", 0) or 0)
                merged[key]["amount"] = str(round(existing + new, 2)).rstrip("0").rstrip(".")
            except (ValueError, TypeError):
                pass
        else:
            merged[key] = dict(item)
    return list(merged.values())


def _normalize_name(text: str) -> str:
    return re.sub(r"[^\w\sÅÄÖåäö]", "", text or "").strip().lower()


def _pantry_match(ingredient_name: str, pantry_names: list[str]) -> bool:
    needle = _normalize_name(ingredient_name)
    if not needle:
        return False
    for p in pantry_names:
        if needle in p or p in needle:
            return True
    return False


@router.post("/missing-from-recipe")
async def missing_from_recipe(
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe_id = data.get("recipe_id")
    servings = int(data.get("servings", 4))

    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recept hittades inte")
    if recipe.visibility == "private" and recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Inte ditt recept")

    scaled = scale_ingredients(recipe.ingredients, recipe.servings or 4, servings)

    pantry_items = session.exec(select(PantryItem).where(PantryItem.household_id == user.household_id)).all()
    pantry_names = [_normalize_name(p.name) for p in pantry_items]

    missing = []
    available = []
    for ing in scaled:
        ing["category"] = categorize(ing.get("name", ""))
        ing["checked"] = False
        ing["recipe_id"] = recipe_id
        if _pantry_match(ing.get("name", ""), pantry_names):
            available.append(ing)
        else:
            missing.append(ing)

    missing.sort(key=lambda i: (sort_key(i.get("category", "Övrigt")), i.get("name", "").lower()))

    log_audit(session, user, "shopping.missing_check",
              details={"recipe_id": recipe_id, "missing": len(missing), "total": len(scaled)})
    return {
        "missing": missing,
        "available": available,
        "total": len(scaled),
        "recipe_title": recipe.title,
    }


@router.post("/from-recipes")
async def generate_from_recipes(
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    recipe_ids = data.get("recipe_ids", [])
    servings_override = data.get("servings_override", {})

    all_items = []
    for recipe_id in recipe_ids:
        recipe = session.get(Recipe, recipe_id)
        if not recipe:
            continue
        target_servings = servings_override.get(str(recipe_id), recipe.servings)
        scaled = scale_ingredients(recipe.ingredients, recipe.servings, target_servings)
        for item in scaled:
            item["recipe_id"] = recipe_id
            item["recipe_title"] = recipe.title
            item["checked"] = False
        all_items.extend(scaled)

    merged = merge_ingredients(all_items)

    # Cross-reference against Home Assistant inventory (fail-soft).
    inventory = await fetch_inventory()
    for item in merged:
        match = match_ingredient(item.get("name", ""), inventory)
        if match:
            item["available_at_home"] = True
            item["location"] = match.location
            item["hass_entity"] = match.entity_id
        else:
            item["available_at_home"] = False
        item["category"] = categorize(item.get("name", ""))

    # Sort: butikssektion-ordning, sedan alfabetiskt
    merged.sort(key=lambda i: (sort_key(i.get("category", "Övrigt")), i.get("name", "").lower()))

    log_audit(session, user, "shopping.generate",
              details={"recipe_ids": recipe_ids, "items": len(merged)})
    return merged


@router.get("")
def list_shopping_lists(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return session.exec(
        select(ShoppingList).where(ShoppingList.household_id == user.household_id)
    ).all()


@router.post("", response_model=ShoppingList)
def create_shopping_list(
    data: ShoppingList,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    data.household_id = user.household_id
    session.add(data)
    session.commit()
    session.refresh(data)
    log_audit(session, user, "shopping.create", entity_type="shopping_list",
              entity_id=data.id, details={"name": data.name})
    return data


@router.put("/{list_id}", response_model=ShoppingList)
def update_shopping_list(
    list_id: int,
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    shopping_list = session.get(ShoppingList, list_id)
    if not shopping_list or shopping_list.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="List not found")
    changed = []
    for key, value in data.items():
        if hasattr(shopping_list, key) and key not in ("id", "household_id", "created_at"):
            setattr(shopping_list, key, value)
            changed.append(key)
    session.commit()
    session.refresh(shopping_list)
    log_audit(session, user, "shopping.update", entity_type="shopping_list",
              entity_id=list_id, details={"fields": changed})
    return shopping_list


@router.delete("/{list_id}")
def delete_shopping_list(
    list_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    shopping_list = session.get(ShoppingList, list_id)
    if not shopping_list or shopping_list.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="List not found")
    name = shopping_list.name
    session.delete(shopping_list)
    session.commit()
    log_audit(session, user, "shopping.delete", entity_type="shopping_list",
              entity_id=list_id, details={"name": name})
    return {"ok": True}


# ─── Delning ──────────────────────────────────────────────────────────
# /api/shopping/{id}/share — generera (eller hämta) en delningstoken (auth).
# /api/shopping/share/{token} — publik read+toggle endpoint utan auth.

@router.post("/{list_id}/share")
def create_share_link(
    list_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    shopping_list = session.get(ShoppingList, list_id)
    if not shopping_list or shopping_list.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="List not found")
    if not shopping_list.share_token:
        shopping_list.share_token = uuid.uuid4().hex
        session.commit()
        session.refresh(shopping_list)
    log_audit(session, user, "shopping.share", entity_type="shopping_list",
              entity_id=list_id, details={"token_prefix": shopping_list.share_token[:8]})
    return {"token": shopping_list.share_token, "list_id": list_id}


@router.delete("/{list_id}/share")
def revoke_share_link(
    list_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    shopping_list = session.get(ShoppingList, list_id)
    if not shopping_list or shopping_list.household_id != user.household_id:
        raise HTTPException(status_code=404, detail="List not found")
    shopping_list.share_token = None
    session.commit()
    log_audit(session, user, "shopping.unshare", entity_type="shopping_list",
              entity_id=list_id)
    return {"ok": True}


# ── Publika delningsendpoints — INGEN auth ───────────────────────────
# Middleware-whitelist i main.py släpper igenom /api/shopping/share/*.
# Det är medvetet: gäst/partner ska kunna öppna länken direkt utan login.

@router.get("/share/{token}")
def get_shared_list(token: str, session: Session = Depends(get_session)):
    """Public read-only view of a shared shopping list."""
    shopping_list = session.exec(
        select(ShoppingList).where(ShoppingList.share_token == token)
    ).first()
    if not shopping_list:
        raise HTTPException(status_code=404, detail="Listan hittades inte")
    return {
        "id": shopping_list.id,
        "name": shopping_list.name,
        "items": shopping_list.items,
        "created_at": shopping_list.created_at,
    }


@router.patch("/share/{token}/toggle")
def toggle_shared_item(token: str, payload: dict, session: Session = Depends(get_session)):
    """Allow the link recipient to check/uncheck items — no other edits permitted."""
    shopping_list = session.exec(
        select(ShoppingList).where(ShoppingList.share_token == token)
    ).first()
    if not shopping_list:
        raise HTTPException(status_code=404, detail="Listan hittades inte")
    try:
        index = int(payload.get("index"))
        checked = bool(payload.get("checked"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="index och checked krävs")

    try:
        items = json.loads(shopping_list.items or "[]")
    except json.JSONDecodeError:
        items = []
    if not (0 <= index < len(items)):
        raise HTTPException(status_code=400, detail="index utanför listan")
    items[index]["checked"] = checked
    shopping_list.items = json.dumps(items, ensure_ascii=False)
    session.commit()
    # Audit utan user — guest-handling. user_id blir NULL och visas som "Gäst".
    log_audit(session, None, "shopping.share_toggle", entity_type="shopping_list",
              entity_id=shopping_list.id,
              details={"index": index, "checked": checked, "via": "share_link"})
    return {"ok": True, "index": index, "checked": checked}
