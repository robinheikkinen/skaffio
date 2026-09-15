"""
Upphovsrättsspärr: importerade recept (source_url satt) får ALDRIG vara publika.

Instruktionstext och foton från externa sajter är skyddat material.
Privat bruk inom hushållet är OK — återpublicering i publika biblioteket är det inte.

Regeln gäller tre vägar in:
  1. create/bulk-create — visibility tvingas tyst till private
  2. update — 403 om slutläget skulle bli public + source_url (även för admin)
  3. inbox approve — alltid private (inbox-recept är per definition importerade)
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models import InboxRecipe, Recipe
from routes.inbox import ApproveIn, approve_inbox_item
from routes.recipes import RecipeCreate, RecipeUpdate, create_recipe, update_recipe


def _admin(seeded) -> SimpleNamespace:
    u = seeded["user_a"]
    return SimpleNamespace(id=u.id, household_id=u.household_id, role="admin")


class TestCreateForcesPrivate:
    def test_imported_recipe_created_public_becomes_private(self, db, seeded):
        recipe = create_recipe(
            data=RecipeCreate(
                title="Stulen carbonara",
                source_url="https://koket.se/carbonara",
                visibility="public",
            ),
            session=db,
            user=seeded["user_a"],
        )
        assert recipe.visibility == "private", (
            "COPYRIGHT: importerat recept skapades som public"
        )

    def test_own_recipe_can_be_created_public(self, db, seeded):
        recipe = create_recipe(
            data=RecipeCreate(title="Mormors köttbullar", visibility="public"),
            session=db,
            user=seeded["user_a"],
        )
        assert recipe.visibility == "public"


class TestUpdateBlocksPublishingImports:
    def test_admin_cannot_publish_imported_recipe(self, db, seeded):
        imported = Recipe(
            title="Importerad rätt", ingredients="[]", instructions=".",
            source_url="https://ica.se/recept", visibility="private",
            household_id=seeded["hh_a_id"],
        )
        db.add(imported)
        db.commit()
        db.refresh(imported)

        with pytest.raises(HTTPException) as exc:
            update_recipe(
                recipe_id=imported.id,
                data=RecipeUpdate(visibility="public"),
                session=db,
                user=_admin(seeded),
            )
        assert exc.value.status_code == 403, (
            "COPYRIGHT: admin kunde publicera importerat recept"
        )

    def test_admin_can_publish_own_recipe(self, db, seeded):
        own = Recipe(
            title="Egen skapelse", ingredients="[]", instructions=".",
            visibility="private", household_id=seeded["hh_a_id"],
        )
        db.add(own)
        db.commit()
        db.refresh(own)

        update_recipe(
            recipe_id=own.id,
            data=RecipeUpdate(visibility="public"),
            session=db,
            user=_admin(seeded),
        )
        db.refresh(own)
        assert own.visibility == "public"

    def test_cannot_add_source_url_to_public_recipe(self, db, seeded):
        public = Recipe(
            title="Publik rätt", ingredients="[]", instructions=".",
            visibility="public", household_id=seeded["hh_a_id"],
        )
        db.add(public)
        db.commit()
        db.refresh(public)

        with pytest.raises(HTTPException) as exc:
            update_recipe(
                recipe_id=public.id,
                data=RecipeUpdate(source_url="https://koket.se/x"),
                session=db,
                user=_admin(seeded),
            )
        assert exc.value.status_code == 403, (
            "COPYRIGHT: source_url kunde läggas på publikt recept"
        )


class TestRewriteDropsSource:
    """AI-omskrivning skapar en kopia UTAN source_url/cover — publicerbar."""

    @pytest.mark.anyio
    async def test_rewrite_strips_source_and_cover(self, db, seeded, monkeypatch):
        import routes.recipes as recipes_module
        import services.ai as ai_module

        async def fake_chat(prompt, **kwargs):
            return '{"title": "Egen version", "description": "Min beskrivning", "instructions": "Gör så här."}'

        async def fake_image(prompt, **kwargs):
            return None  # ingen bild i test — fail-soft-vägen

        monkeypatch.setattr(ai_module, "chat", fake_chat)
        monkeypatch.setattr(ai_module, "generate_image", fake_image)

        imported = Recipe(
            title="Instagramrätt", ingredients='[{"name":"ägg","amount":"2","unit":"st"}]',
            instructions="Källans skyddade text.",
            source_url="https://instagram.com/p/abc123", source_type="url",
            cover_image="import-deadbeef.jpg", visibility="private",
            household_id=seeded["hh_a_id"],
        )
        db.add(imported)
        db.commit()
        db.refresh(imported)

        result = await recipes_module.rewrite_recipe(
            recipe_id=imported.id, session=db, user=seeded["user_a"],
        )
        rewritten = db.get(Recipe, result["id"])
        assert rewritten.source_url is None, "COPYRIGHT: source_url följde med i omskrivningen"
        assert rewritten.cover_image is None, "COPYRIGHT: källans cover-bild följde med"
        assert rewritten.source_type == "rewrite"
        assert rewritten.visibility == "private"
        assert rewritten.instructions == "Gör så här."
        assert rewritten.ingredients == imported.ingredients  # fakta behålls

    @pytest.mark.anyio
    async def test_rewrite_other_household_private_recipe_forbidden(self, db, seeded, monkeypatch):
        import routes.recipes as recipes_module

        with pytest.raises(HTTPException) as exc:
            await recipes_module.rewrite_recipe(
                recipe_id=seeded["recipe_a_id"], session=db, user=seeded["user_b"],
            )
        assert exc.value.status_code == 403, (
            "SECURITY: user_b kunde skriva om user_a:s privata recept"
        )


class TestInboxApproveForcesPrivate:
    def test_approve_with_public_requested_becomes_private(self, db, seeded):
        item = InboxRecipe(
            url="https://arla.se/recept", title="Inkorgsrecept",
            status="review", household_id=seeded["hh_a_id"],
        )
        db.add(item)
        db.commit()
        db.refresh(item)

        result = approve_inbox_item(
            item_id=item.id,
            data=ApproveIn(visibility="public"),
            session=db,
            user=seeded["user_a"],
        )
        recipe = db.get(Recipe, result["recipe_id"])
        assert recipe.visibility == "private", (
            "COPYRIGHT: inbox-approve skapade publikt recept från importerad URL"
        )
