"""Async import-kö för inkorg-recept.

En enkel asyncio.Queue med en bakgrunds-worker som processar ett jobb i taget.
Varje jobb är ett InboxRecipe.id.

Flöde:
  1. POST /api/inbox  → skapar InboxRecipe(status=pending), anropar enqueue(id)
  2. Worker plockar jobbet, sätter status=processing
  3. Firecrawl hämtar Markdown, AI parsar recept
  4. Status → review (klar) eller error (misslyckad)
  5. Användaren ser resultatet i Inkorg-vyn
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx
from sqlmodel import Session, select

logger = logging.getLogger("skaffio.import_queue")

_queue: asyncio.Queue[int] = asyncio.Queue()


async def enqueue(inbox_id: int) -> None:
    await _queue.put(inbox_id)


async def _download_image(image_url: str) -> tuple[str | None, bytes | None]:
    """Ladda ner bild och returnera (local_filename, raw_bytes) eller (None, None)."""
    if not image_url or not image_url.startswith(("http://", "https://")):
        return None, None
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(image_url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/jpeg")
            if not content_type.startswith("image/"):
                return None, None
            ext = "jpg"
            if "png" in content_type:
                ext = "png"
            elif "webp" in content_type:
                ext = "webp"
            filename = f"inbox_{uuid.uuid4().hex[:12]}.{ext}"
            return filename, resp.content
    except Exception as e:
        logger.warning("Image download failed %s: %s", image_url, e)
        return None, None


async def _process_job(inbox_id: int) -> None:
    from database import engine
    from models import InboxRecipe
    from services.firecrawl import scrape_url, pick_best_image
    from services.nextcloud import upload_image, is_configured as nc_configured
    from services.ai import chat, safe_parse_json, AIUnavailable

    with Session(engine) as session:
        item = session.get(InboxRecipe, inbox_id)
        if not item or item.status not in ("pending", "processing"):
            return
        item.status = "processing"
        session.commit()
        url = item.url

    try:
        # ── 1. Firecrawl → Markdown ─────────────────────────────────────────
        fc_data = await scrape_url(url)
        markdown = (fc_data or {}).get("markdown", "") if fc_data else ""
        metadata = (fc_data or {}).get("metadata", {}) if fc_data else {}

        if not markdown:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                resp.raise_for_status()
                markdown = resp.text[:8000]

        # ── 2. AI-parsning av Markdown → recept-JSON ───────────────────────
        prompt = (
            "Du är en receptextraktör. Extrahera receptet ur nedanstående text och returnera ENDAST giltig JSON "
            "med dessa exakta nycklar:\n"
            '{"title": "string", "description": "string", '
            '"ingredients": [{"name": "string", "amount": "string", "unit": "string"}], '
            '"instructions": "string (markdown med numrerade steg)", '
            '"servings": number_or_null, "prep_time": number_or_null, "cook_time": number_or_null}\n\n'
            f"Text:\n{markdown[:6000]}"
        )

        parsed: dict = {}
        try:
            raw = await chat(prompt, expect_json=True, task="inbox_import")
            parsed = safe_parse_json(raw) or {}
        except (AIUnavailable, Exception) as e:
            logger.warning("AI parse failed for inbox %d: %s", inbox_id, e)

        # ── 3. Bild — identifiera och ladda ner ────────────────────────────
        image_url = pick_best_image(markdown, metadata)
        local_filename = None

        if image_url:
            local_filename, raw_bytes = await _download_image(image_url)
            if local_filename and raw_bytes:
                os.makedirs("/data/uploads", exist_ok=True)
                with open(f"/data/uploads/{local_filename}", "wb") as f:
                    f.write(raw_bytes)
                if nc_configured():
                    await upload_image(local_filename, raw_bytes)

        # ── 4. Uppdatera InboxRecipe med resultat ──────────────────────────
        with Session(engine) as session:
            item = session.get(InboxRecipe, inbox_id)
            if not item:
                return

            item.title = (parsed.get("title") or "").strip() or url
            item.description = (parsed.get("description") or "").strip()
            item.ingredients = json.dumps(
                [
                    {
                        "name": str(i.get("name", "")).strip(),
                        "amount": str(i.get("amount", "")).strip(),
                        "unit": str(i.get("unit", "")).strip(),
                    }
                    for i in (parsed.get("ingredients") or [])
                    if isinstance(i, dict) and i.get("name")
                ],
                ensure_ascii=False,
            )
            item.instructions = (parsed.get("instructions") or "").strip()
            item.servings = parsed.get("servings") or None
            item.prep_time = parsed.get("prep_time") or None
            item.cook_time = parsed.get("cook_time") or None
            item.cover_image = local_filename
            item.cover_image_url = image_url
            item.raw_markdown = markdown[:20000] if markdown else None
            item.status = "review" if (item.title or item.instructions) else "error"
            item.error_message = None if item.status == "review" else "AI kunde inte extrahera receptet"
            item.processed_at = datetime.now(timezone.utc)
            session.commit()

        logger.info("Inbox job %d done: status=%s title=%r", inbox_id, item.status, item.title)

    except Exception as e:
        logger.error("Inbox job %d failed: %s", inbox_id, e)
        with Session(engine) as session:
            item = session.get(InboxRecipe, inbox_id)
            if item:
                item.status = "error"
                item.error_message = str(e)
                item.processed_at = datetime.now(timezone.utc)
                session.commit()


async def import_worker() -> None:
    """Bakgrunds-worker — kör för alltid, processar ett jobb i taget."""
    logger.info("Import queue worker started")
    while True:
        inbox_id = await _queue.get()
        try:
            await _process_job(inbox_id)
        except Exception as e:
            logger.error("Unexpected worker error for job %d: %s", inbox_id, e)
        finally:
            _queue.task_done()


async def resume_pending() -> None:
    """Köa om jobb som var i 'pending'/'processing' vid förra omstarten."""
    from database import engine
    from models import InboxRecipe

    with Session(engine) as session:
        stuck = session.exec(
            select(InboxRecipe).where(
                InboxRecipe.status.in_(["pending", "processing"])
            )
        ).all()
        ids = [item.id for item in stuck]
        for item in stuck:
            item.status = "pending"
        session.commit()

    for inbox_id in ids:
        await enqueue(inbox_id)
    if ids:
        logger.info("Resumed %d stuck import jobs", len(ids))
