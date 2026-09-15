"""
Test fixtures for household isolation security tests.

All tests use an in-memory SQLite database.  Route functions are called
directly (bypassing FastAPI DI) by passing session and user explicitly —
this avoids lifespan/startup issues while still testing real DB queries.
"""
import os
import secrets
from types import SimpleNamespace

os.environ.setdefault("JWT_SECRET", "pytest-only-secret-do-not-use-in-production")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("ALLOW_REGISTRATION", "false")
os.environ.setdefault("AI_API_URL", "http://localhost:11434")

import pytest
from datetime import date
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.pool import StaticPool

from models import (
    Collection, FreezerPortion, Household, InboxRecipe, MealPlanEntry,
    PantryItem, Recipe, ShoppingList, User,
)
from services.auth import hash_password


def _user(id: int, household_id: int, role: str = "member") -> SimpleNamespace:
    """Lightweight stand-in for a User ORM object — avoids DetachedInstanceError."""
    return SimpleNamespace(id=id, household_id=household_id, role=role)


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(eng)
    yield eng


@pytest.fixture(scope="session")
def seeded(engine):
    """
    Creates two isolated households (A and B) with users and sample data for A.

    Returns plain IDs and lightweight user objects (not live ORM instances).
    Household B has no data — any data leaking from A to B is a security bug.
    """
    with Session(engine) as s:
        hh_a = Household(name="Alfa", invite_code=secrets.token_urlsafe(8))
        hh_b = Household(name="Beta", invite_code=secrets.token_urlsafe(8))
        s.add_all([hh_a, hh_b])
        s.commit()
        s.refresh(hh_a)
        s.refresh(hh_b)

        ua = User(
            email="a@test.com", name="User A",
            password_hash=hash_password("x"), household_id=hh_a.id,
        )
        ub = User(
            email="b@test.com", name="User B",
            password_hash=hash_password("x"), household_id=hh_b.id,
        )
        s.add_all([ua, ub])
        s.commit()
        s.refresh(ua)
        s.refresh(ub)

        recipe = Recipe(
            title="Hemlig rätt A", ingredients="[]", instructions=".",
            household_id=hh_a.id, visibility="private",
        )
        s.add(recipe)
        s.commit()
        s.refresh(recipe)

        pantry = PantryItem(name="Hemlig mjölk A", household_id=hh_a.id, added_by_user_id=ua.id)
        shopping = ShoppingList(name="Hemlig lista A", items="[]", household_id=hh_a.id)
        coll = Collection(name="Hemlig samling A", household_id=hh_a.id)
        freezer = FreezerPortion(label="Hemlig portion A", household_id=hh_a.id)
        inbox = InboxRecipe(url="https://example.com/secret", title="Hemlig inkorg A", household_id=hh_a.id)
        meal = MealPlanEntry(recipe_id=recipe.id, date=date(2026, 6, 15), household_id=hh_a.id)
        s.add_all([pantry, shopping, coll, freezer, inbox, meal])
        s.commit()
        s.refresh(pantry)
        s.refresh(shopping)
        s.refresh(coll)
        s.refresh(freezer)
        s.refresh(inbox)
        s.refresh(meal)

        return {
            # Lightweight user objects (no live session attachment)
            "user_a": _user(ua.id, hh_a.id),
            "user_b": _user(ub.id, hh_b.id),
            # Plain IDs for fetching in test sessions
            "hh_a_id": hh_a.id,
            "hh_b_id": hh_b.id,
            "recipe_a_id": recipe.id,
            "pantry_a_name": pantry.name,
            "shopping_a_id": shopping.id,
            "shopping_a_name": shopping.name,
            "coll_a_id": coll.id,
            "coll_a_name": coll.name,
            "freezer_a_label": freezer.label,
            "inbox_a_id": inbox.id,
            "inbox_a_title": inbox.title,
            "meal_a_id": meal.id,
        }


@pytest.fixture()
def db(engine):
    with Session(engine) as session:
        yield session
