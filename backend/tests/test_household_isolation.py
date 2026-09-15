"""
Security regression suite: household data isolation.

Principle: User B (Household B) must NEVER be able to read or modify
User A's (Household A) data — regardless of endpoint.

How to run:
    cd backend
    pip install pytest
    pytest tests/test_household_isolation.py -v

CI: add `cd backend && pytest tests/` to your deploy pipeline.
If any test fails, a data-isolation bug exists — do NOT deploy.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from routes.collections import list_collections, get_collection
from routes.freezer import list_portions
from routes.inbox import list_inbox, get_inbox_item
from routes.mealplan import get_mealplan
from routes.pantry import list_pantry
from routes.recipes import get_recipe
from routes.shopping import list_shopping_lists, update_shopping_list


def _names(items) -> set[str]:
    result = set()
    for i in items:
        if isinstance(i, dict):
            result.add(i.get("name") or i.get("title") or i.get("label") or "")
        else:
            result.add(
                getattr(i, "name", None)
                or getattr(i, "title", None)
                or getattr(i, "label", None)
                or ""
            )
    return result


# ─── Pantry ──────────────────────────────────────────────────────────────────

class TestPantryIsolation:
    def test_list_does_not_leak_other_household(self, db, seeded):
        result = list_pantry(session=db, user=seeded["user_b"])
        assert seeded["pantry_a_name"] not in _names(result), (
            "SECURITY: user_b kan se user_a:s pantry-varor"
        )

    def test_list_returns_own_household_data(self, db, seeded):
        result = list_pantry(session=db, user=seeded["user_a"])
        assert seeded["pantry_a_name"] in _names(result)


# ─── Shopping ────────────────────────────────────────────────────────────────

class TestShoppingIsolation:
    def test_list_does_not_leak_other_household(self, db, seeded):
        result = list_shopping_lists(session=db, user=seeded["user_b"])
        assert seeded["shopping_a_name"] not in _names(result), (
            "SECURITY: user_b kan se user_a:s inköpslistor"
        )

    def test_update_other_household_list_raises(self, db, seeded):
        with pytest.raises(HTTPException) as exc:
            update_shopping_list(
                list_id=seeded["shopping_a_id"],
                data={"name": "hackad lista"},
                session=db,
                user=seeded["user_b"],
            )
        assert exc.value.status_code in (403, 404), (
            "SECURITY: update returnerade inte 403/404 för fel hushåll"
        )


# ─── Collections ─────────────────────────────────────────────────────────────

class TestCollectionsIsolation:
    def test_list_does_not_leak_other_household(self, db, seeded):
        result = list_collections(session=db, user=seeded["user_b"])
        assert seeded["coll_a_name"] not in _names(result), (
            "SECURITY: user_b kan se user_a:s samlingar"
        )

    def test_get_other_household_collection_raises(self, db, seeded):
        with pytest.raises(HTTPException) as exc:
            get_collection(
                collection_id=seeded["coll_a_id"],
                session=db,
                user=seeded["user_b"],
            )
        assert exc.value.status_code in (403, 404), (
            "SECURITY: get_collection returnerade inte 403/404 för fel hushåll"
        )


# ─── Freezer ─────────────────────────────────────────────────────────────────

class TestFreezerIsolation:
    def test_list_does_not_leak_other_household(self, db, seeded):
        result = list_portions(session=db, user=seeded["user_b"])
        assert seeded["freezer_a_label"] not in _names(result), (
            "SECURITY: user_b kan se user_a:s frysposter"
        )


# ─── Inbox ───────────────────────────────────────────────────────────────────

class TestInboxIsolation:
    def test_list_does_not_leak_other_household(self, db, seeded):
        result = list_inbox(session=db, user=seeded["user_b"])
        assert seeded["inbox_a_title"] not in _names(result), (
            "SECURITY: user_b kan se user_a:s inkorg"
        )

    def test_get_item_from_other_household_raises(self, db, seeded):
        with pytest.raises(HTTPException) as exc:
            get_inbox_item(
                item_id=seeded["inbox_a_id"],
                session=db,
                user=seeded["user_b"],
            )
        assert exc.value.status_code in (403, 404), (
            "SECURITY: get_inbox_item returnerade inte 403/404 för fel hushåll"
        )


# ─── Meal Plan ───────────────────────────────────────────────────────────────

class TestMealPlanIsolation:
    def test_list_does_not_leak_other_household(self, db, seeded):
        result = get_mealplan(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            session=db,
            user=seeded["user_b"],
        )
        entry_ids = [e.id for e in result]
        assert seeded["meal_a_id"] not in entry_ids, (
            "SECURITY: user_b kan se user_a:s måltidsplan"
        )


# ─── Recipes ─────────────────────────────────────────────────────────────────

class TestRecipesIsolation:
    def test_get_private_recipe_from_other_household_raises(self, db, seeded):
        with pytest.raises(HTTPException) as exc:
            get_recipe(
                recipe_id=seeded["recipe_a_id"],
                session=db,
                user=seeded["user_b"],
            )
        assert exc.value.status_code in (403, 404), (
            "SECURITY: get_recipe returnerade privat recept från annat hushåll"
        )
