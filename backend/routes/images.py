import asyncio
import ipaddress
import logging
import os
import socket
import uuid
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger("skaffio.images")
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlmodel import Session, select
from PIL import Image as PILImage
import aiofiles
from slugify import slugify
from database import get_session
from models import RecipeImage, User
from services.audit import log_audit
from services.auth import get_current_user

router = APIRouter(tags=["images"])

UPLOAD_DIR = "/data/uploads"
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_IMAGE_SIZE = 20 * 1024 * 1024   # 20 MB
MAX_PDF_SIZE   = 50 * 1024 * 1024   # 50 MB


def _is_safe_url(url: str) -> bool:
    """Returnerar False om URL:en pekar på ett privat/internt nätverksadress (SSRF-skydd)."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        host = parsed.hostname
        if not host:
            return False
        addrs = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        for addr in addrs:
            try:
                ip = ipaddress.ip_address(addr[4][0])
                if (ip.is_private or ip.is_loopback or ip.is_link_local
                        or ip.is_reserved or ip.is_unspecified):
                    return False
            except ValueError:
                return False
        return True
    except Exception:
        return False


def _validate_image_bytes(content: bytes) -> bool:
    """Kontrollerar magic bytes — säkerställer att filen faktiskt är en bild."""
    if len(content) < 8:
        return False
    if content[:3] == b"\xff\xd8\xff":                          # JPEG
        return True
    if content[:8] == b"\x89PNG\r\n\x1a\n":                     # PNG
        return True
    if content[:6] in (b"GIF87a", b"GIF89a"):                   # GIF
        return True
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":     # WebP
        return True
    return False


def make_unique_filename(original_name: str) -> str:
    ext = os.path.splitext(original_name)[1].lower()
    slug = slugify(os.path.splitext(original_name)[0])[:40]
    return f"{slug}-{uuid.uuid4().hex[:8]}{ext}"


def create_thumbnail(src_path: str, dest_path: str, width: int = 400):
    with PILImage.open(src_path) as img:
        img = img.convert("RGB")
        ratio = width / img.width
        height = int(img.height * ratio)
        img = img.resize((width, height), PILImage.LANCZOS)
        img.save(dest_path, "JPEG", quality=85)


@router.post("/images/upload")
async def upload_images(
    files: list[UploadFile] = File(...),
    recipe_id: Optional[int] = Form(None),   # ← Form(), inte query string
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    result = []

    # Om receptet är angivet — hämta det en gång (för cover-koll)
    from models import Recipe as _Recipe
    target_recipe = session.get(_Recipe, recipe_id) if recipe_id else None
    if target_recipe and target_recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Inte ditt recept")

    first_filename_for_cover = None

    for file in files:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            raise HTTPException(status_code=415, detail=f"Filtypen {ext or '(okänd)'} stöds inte — använd jpg, png, gif eller webp")

        content = await file.read()
        if len(content) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="Bilden är för stor — max 20 MB")
        if not _validate_image_bytes(content):
            raise HTTPException(status_code=415, detail="Filen verkar inte vara en giltig bild")

        filename = make_unique_filename(file.filename)
        file_path = os.path.join(UPLOAD_DIR, filename)
        thumb_path = os.path.join(UPLOAD_DIR, f"thumb_{filename.rsplit('.', 1)[0]}.jpg")

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

        try:
            create_thumbnail(file_path, thumb_path)
        except Exception:
            pass

        db_image = RecipeImage(
            recipe_id=recipe_id,
            filename=filename,
            original_name=file.filename,
        )
        session.add(db_image)
        session.commit()
        session.refresh(db_image)
        if not first_filename_for_cover:
            first_filename_for_cover = filename
        result.append(db_image)

    # Sätt första bilden som cover om receptet saknar en
    if target_recipe and not target_recipe.cover_image and first_filename_for_cover:
        target_recipe.cover_image = first_filename_for_cover
        from datetime import datetime as _dt
        target_recipe.updated_at = _dt.utcnow()
        session.commit()

    log_audit(session, user, "image.upload",
              details={"count": len(result), "recipe_id": recipe_id,
                       "set_cover": bool(target_recipe and first_filename_for_cover and target_recipe.cover_image == first_filename_for_cover)})
    return result


# ─── Heuristisk PDF-extraktion (utan AI) ────────────────────────────────
# Splittar en svensk receptbok på sektionsrubriker. Robust för PDF:er som
# konsekvent använder "Ingredienser" + "Gör så här"-pattern (vilket de flesta
# matblogs- och kokboks-PDF:er gör).

import re as _re

_INGREDIENTS_MARKER = _re.compile(
    r"^\s*(ingredienser|du beh[öo]ver|ingredients)\s*:?\s*$",
    _re.IGNORECASE | _re.MULTILINE,
)
_INSTRUCTIONS_MARKER = _re.compile(
    r"^\s*(g[öo]r s[åa] h[äa]r|tillagning|instruktion(?:er)?|metod|method|directions|s[åa] h[äa]r g[öo]r du)\s*:?\s*$",
    _re.IGNORECASE | _re.MULTILINE,
)
_SERVINGS_RX = _re.compile(r"(\d+)\s*(?:port(?:ion(?:er)?)?|pers(?:oner)?|st)", _re.IGNORECASE)


def _extract_recipes_heuristic(full_text: str) -> list[dict]:
    """Split cookbook text into recipes using Swedish section markers.

    Strategi: hitta varje "Ingredienser"-rubrik. Det som ligger 1-4 rader OVANFÖR
    är titel. Det mellan "Ingredienser" och "Gör så här" är ingredienser.
    Det mellan "Gör så här" och nästa "Ingredienser" är instruktioner.
    """
    recipes: list[dict] = []
    ing_matches = list(_INGREDIENTS_MARKER.finditer(full_text))
    if not ing_matches:
        return []

    for i, m in enumerate(ing_matches):
        # Titel: titta bakåt från Ingredienser-rubriken och hitta bästa kandidaten
        head_end = m.start()
        # Begränsa sökning till efter förra receptets slut
        prev_end = ing_matches[i - 1].end() if i > 0 else 0
        head_start = max(prev_end, head_end - 800)
        head = full_text[head_start:head_end]
        head_lines = [l.strip() for l in head.split("\n") if l.strip()]

        candidates: list[str] = []
        for line in reversed(head_lines):
            if _INSTRUCTIONS_MARKER.match(line + "\n"):
                break  # föregående recept slutar här — gå inte längre bakåt
            if not (2 <= len(line) <= 80):
                continue
            if _re.match(r"^\d+\s*(?:\.|\)|port|pers|st\b)", line, _re.IGNORECASE):
                continue  # numrerat steg eller portionsangivelse
            low = line.lower()
            if low in ("ingredienser", "du behöver", "du behover", "ingredients"):
                continue
            candidates.append(line)

        # Välj titel: föredra (1) UPPERCASE-rad, (2) rad utan slut-skiljetecken,
        # (3) annars senaste kandidaten (närmast Ingredienser). Beskrivande
        # meningar slutar typiskt på .,:; och filtreras bort på (2).
        title = ""
        for line in candidates:
            if line.isupper() and len(line) >= 3:
                title = line
                break
        if not title:
            for line in candidates:
                if line[-1] not in ".,:;!?":
                    title = line
                    break
        if not title and candidates:
            title = candidates[0]

        # Slut på recept = nästa "Ingredienser" eller dokumentets slut
        if i + 1 < len(ing_matches):
            recipe_end = ing_matches[i + 1].start()
        else:
            recipe_end = len(full_text)

        # Ingredienser-block: från rubrikens slut tills instruktionsmarkör
        body = full_text[m.end():recipe_end]
        inst_match = _INSTRUCTIONS_MARKER.search(body)
        if inst_match:
            ing_block = body[:inst_match.start()]
            instr_block = body[inst_match.end():]
        else:
            # Inga "Gör så här" — splitta vid första numrerade steget
            num_step = _re.search(r"^\s*1[\.\)]\s+\S", body, _re.MULTILINE)
            if num_step:
                ing_block = body[:num_step.start()]
                instr_block = body[num_step.start():]
            else:
                ing_block = body
                instr_block = ""

        # Tolka ingredienser rad-för-rad
        ingredients: list[dict] = []
        for raw in ing_block.split("\n"):
            line = raw.strip()
            if not line or len(line) > 140:
                continue
            if _INGREDIENTS_MARKER.match(line + "\n") or _INSTRUCTIONS_MARKER.match(line + "\n"):
                continue
            # Hoppa över rena rubriker (allt versaler, korta)
            if line.isupper() and len(line) < 30:
                continue
            parsed = _split_ingredient(line)
            if parsed.get("name"):
                ingredients.append(parsed)

        # Instruktioner: behåll bara rader som ser ut som steg eller löpande text
        instructions = "\n".join(
            l.strip() for l in instr_block.split("\n")
            if l.strip() and len(l.strip()) > 3 and not _INGREDIENTS_MARKER.match(l + "\n")
        ).strip()

        # Portioner — leta i hela receptet
        servings = None
        sm = _SERVINGS_RX.search(full_text[max(0, head_end - 200):m.end() + 200])
        if sm:
            try: servings = int(sm.group(1))
            except ValueError: pass

        # Kvalitetsfilter — kräver titel + minst 2 ingredienser
        if not title or len(ingredients) < 2:
            continue

        recipes.append({
            "title": title,
            "description": "",
            "ingredients": ingredients,
            "instructions": instructions,
            "servings": servings,
            "prep_time": None,
            "cook_time": None,
        })

    return recipes


MAX_RECIPES_PER_PDF = 200


# ─── Makro-ankrad parser (Anton Ekefäll-stil receptkort) ────────────────────
# Layout per recept: titel(1-2 rader) / CA N KALORIER / N G PROTEIN / N G K /
# N G FETT / receptnummer / 1. steg 2. steg ... / ingrediensrader /
# INGREDIENSER (markör) / SÅHÄR GÖR DU (markör) / Skapad av ...

_MACRO_ANCHOR = _re.compile(r"^\s*CA\s+\d+\s+KALORIER\s*$", _re.MULTILINE | _re.IGNORECASE)
_MACRO_LINE = _re.compile(r"^\s*\d+\s*G\s+(PROTEIN|KOLHYDRATER|FETT)\s*$", _re.MULTILINE | _re.IGNORECASE)
_RECIPE_NUMBER_LINE = _re.compile(r"^\s*\d{1,3}\s*$", _re.MULTILINE)
_NUMBERED_STEP = _re.compile(r"^\s*\d+\s*[.)]\s+")
_INGREDIENT_HEAD = _re.compile(
    r"^\s*[\d.,/½¼¾⅓⅔]+\s*(g|dl|cl|ml|l|msk|tsk|krm|st|kg|p|pkt|paket|burk)\b",
    _re.IGNORECASE,
)


def _looks_like_ingredient(line: str) -> bool:
    return bool(_INGREDIENT_HEAD.match(line))


def _extract_macro_anchored(full_text: str) -> list[tuple[dict, int]]:
    """Parser för receptkort med 'CA N KALORIER'-rubrik.

    Returnerar lista av (recipe, char_pos_för_ankaret) så vi senare kan
    matcha varje recept till bilder på samma sida.
    """
    anchors = list(_MACRO_ANCHOR.finditer(full_text))
    if not anchors:
        return []

    out: list[tuple[dict, int]] = []
    for i, anchor in enumerate(anchors):
        # Titel: gå bakåt från ankaret, samla 1-3 rader tills tom rad / signature
        upper_lines = full_text[:anchor.start()].split("\n")
        title_parts: list[str] = []
        for line in reversed(upper_lines):
            s = line.strip()
            if not s:
                if title_parts:
                    break
                continue
            low = s.lower()
            if low.startswith("skapad av") or low in ("ingredienser", "ingredients"):
                break
            if "såhär gör du" in low or "sahar gor du" in low:
                break
            if _MACRO_LINE.match(s + "\n") or _MACRO_ANCHOR.match(s + "\n"):
                break
            if len(s) <= 3 and s.isdigit():
                break
            if len(title_parts) >= 3:
                break
            title_parts.insert(0, s)
        title = " ".join(title_parts).strip()
        # PDF-radbrytning lämnar "Lövbiffs- rullader" → städa till "Lövbiffsrullader"
        title = _re.sub(r"(\w)-\s+(\w)", r"\1\2", title)
        if not title or len(title) > 80:
            continue

        # Block: ankarets slut → nästa ankare / dokumentets slut
        block_end = anchors[i + 1].start() if i + 1 < len(anchors) else len(full_text)
        block_lines = full_text[anchor.end():block_end].split("\n")

        # Hoppa över 3 makro-rader (PROTEIN/KOLHYDRATER/FETT) + ev. nummer-rad
        idx, macro_count = 0, 0
        while idx < len(block_lines) and macro_count < 3:
            s = block_lines[idx].strip()
            if not s:
                idx += 1
                continue
            if _MACRO_LINE.match(s + "\n"):
                macro_count += 1
                idx += 1
                continue
            break
        while idx < len(block_lines):
            s = block_lines[idx].strip()
            if not s:
                idx += 1
                continue
            if s.isdigit() and len(s) <= 3:
                idx += 1
                continue
            break

        # Resten = instruktioner (numrerade steg, kan spänna flera rader)
        # + ingredienser (rader som börjar med siffra+enhet). Markörer (INGREDIENSER,
        # SÅHÄR GÖR DU, signatur) släpps.
        instructions_lines: list[str] = []
        ingredients_lines: list[str] = []
        in_signature = False
        for raw in block_lines[idx:]:
            s = raw.strip()
            if not s:
                continue
            low = s.lower()
            if low.startswith("skapad av"):
                in_signature = True
                continue
            if in_signature:
                continue
            if low in ("ingredienser", "ingredients") or "såhär gör du" in low or "sahar gor du" in low:
                continue
            if _NUMBERED_STEP.match(s):
                instructions_lines.append(s)
            elif instructions_lines and not _looks_like_ingredient(s) and len(ingredients_lines) == 0:
                # fortsättning på föregående steg (radbrutet recept)
                instructions_lines[-1] += " " + s
            else:
                ingredients_lines.append(s)

        instructions = "\n".join(instructions_lines).strip()

        ingredients: list[dict] = []
        for line in ingredients_lines:
            if len(line) > 140:
                continue
            parsed = _split_ingredient(line)
            if parsed.get("name"):
                ingredients.append(parsed)

        # Makros: parsa från ankaret + närliggande rader
        head = full_text[anchor.start():anchor.end() + 200]
        calm = _re.search(r"CA\s+(\d+)\s+KALORIER", head, _re.IGNORECASE)
        calories = int(calm.group(1)) if calm else None
        protein = carbs = fat = None
        for mm in _re.finditer(r"(\d+)\s*G\s+(PROTEIN|KOLHYDRATER|FETT)", head, _re.IGNORECASE):
            v, k = int(mm.group(1)), mm.group(2).upper()
            if k == "PROTEIN": protein = v
            elif k == "KOLHYDRATER": carbs = v
            elif k == "FETT": fat = v

        if not ingredients and not instructions:
            continue

        out.append(({
            "title": title,
            "description": "",
            "ingredients": ingredients,
            "instructions": instructions,
            "servings": 1,  # receptkort = 1 portion typiskt
            "prep_time": None,
            "cook_time": None,
            "calories": calories,
            "protein": float(protein) if protein is not None else None,
            "carbs": float(carbs) if carbs is not None else None,
            "fat": float(fat) if fat is not None else None,
        }, anchor.start()))

    return out


def _dedup_recipes(items: list[dict]) -> list[dict]:
    """Collapse duplicates by normalized title and cap output."""
    seen: set[str] = set()
    unique: list[dict] = []
    for r in items:
        if not isinstance(r, dict):
            continue
        title = " ".join((r.get("title") or "").lower().split())
        if not title or title in seen:
            continue
        seen.add(title)
        unique.append(r)
        if len(unique) >= MAX_RECIPES_PER_PDF:
            break
    return unique


@router.post("/images/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Pure-Python PDF → recipes. NO AI calls.

    Pipeline:
      1. PyMuPDF extraherar text + bilder per sida
      2. Försök makro-ankrad parser (Anton Ekefäll-style receptkort)
      3. Om noll resultat, fall tillbaka på sektions-heuristik
      4. Matcha varje recept till bilder på samma sida → cover_image
      5. Dedupa + cappa
    """
    import fitz  # PyMuPDF

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    content = await file.read()
    if len(content) > MAX_PDF_SIZE:
        raise HTTPException(status_code=413, detail="PDF är för stor — max 50 MB")
    if not content:
        raise HTTPException(status_code=400, detail="Tom fil")

    doc = fitz.open(stream=content, filetype="pdf")
    page_texts: list[str] = [page.get_text() for page in doc]

    # Rendera HELA sidan som bild via PyMuPDF — då får vi exakt det användaren
    # ser i en PDF-viewer (text + foto + makros). Mycket mer pålitligt än att
    # gräva i embedded image-objekt (som ofta är vita bakgrundslager / soft-masks).
    # En bild per sida = perfekt för "1 recept per sida"-PDF:er som Anton Ekefäll.
    from PIL import Image as _PILImage
    import io as _io

    images_by_page: dict[int, list[str]] = {}
    all_images: list[str] = []
    for page_num, page in enumerate(doc):
        try:
            # 2x zoom för skarpa bilder
            mat = fitz.Matrix(2.0, 2.0)
            # Crop till nedre delen av sidan — för receptkort-layouter (Anton Ekefäll
            # och liknande) ligger matfotot i nedre 50-55%. Crop = mycket snyggare
            # cover än hela sidan med text/makros på.
            rect = page.rect
            crop = fitz.Rect(
                rect.x0,
                rect.y0 + rect.height * 0.42,
                rect.x1,
                rect.y1,
            )
            pix = page.get_pixmap(matrix=mat, alpha=False, clip=crop)
            img_bytes = pix.tobytes("jpeg", jpg_quality=85)
            if len(img_bytes) < 5_000:
                pix = None
                images_by_page[page_num] = []
                continue
            filename = f"pdf-page-{uuid.uuid4().hex[:8]}.jpg"
            full_path = os.path.join(UPLOAD_DIR, filename)
            with open(full_path, "wb") as f:
                f.write(img_bytes)
            # Skapa thumb (400 px bred) för snabb listrendering
            try:
                thumb_path = os.path.join(UPLOAD_DIR, f"thumb_{filename.rsplit('.', 1)[0]}.jpg")
                with _PILImage.open(_io.BytesIO(img_bytes)) as pim:
                    pim = pim.convert("RGB")
                    target_w = 400
                    if pim.width > target_w:
                        scale = target_w / pim.width
                        new_h = int(pim.height * scale)
                        pim = pim.resize((target_w, new_h), _PILImage.LANCZOS)
                    pim.save(thumb_path, "JPEG", quality=85)
            except Exception as e:
                print(f"[pdf-img] thumb-fel för {filename}: {e}", flush=True)
            pix = None
            images_by_page[page_num] = [filename]
            all_images.append(filename)
        except Exception as e:
            print(f"[pdf-img] sidrendering-fel sida {page_num}: {e}", flush=True)
            images_by_page[page_num] = []

    raw_text = "\n\n".join(page_texts)

    # Beräkna kumulativa start-positioner per sida för att mappa
    # ett char-offset i raw_text → sidnummer.
    page_start_pos = [0]
    for pt in page_texts:
        page_start_pos.append(page_start_pos[-1] + len(pt) + 2)

    def _page_of(char_pos: int) -> int:
        for i in range(len(page_start_pos) - 1):
            if char_pos < page_start_pos[i + 1]:
                return i
        return len(page_texts) - 1

    # ── VÄG B: Försök AI one-shot mot Staik om nyckel finns ──────────────
    method = "heuristic"
    ai_reason = None
    raw_recipes: list[dict] = []
    macro_results: list[tuple[dict, int]] = []

    from services.ai import chat, safe_parse_json, AIUnavailable, AI_API_KEY

    if AI_API_KEY:
        try:
            system_prompt = (
                "Du är en strikt receptextraktor. Givet rå text från en svensk "
                "kokboks-PDF returnerar du JSON med EXAKT denna struktur:\n"
                "{\"recipes\": [\n"
                "  {\"title\": string, \"description\": string,\n"
                "   \"ingredients\": [{\"name\": str, \"amount\": str, \"unit\": str}],\n"
                "   \"instructions\": string (numrerade steg, ett per rad),\n"
                "   \"servings\": number|null, \"prep_time\": number|null,\n"
                "   \"cook_time\": number|null,\n"
                "   \"calories\": number|null, \"protein\": number|null,\n"
                "   \"carbs\": number|null, \"fat\": number|null}\n"
                "]}\n\n"
                "REGLER (bryt aldrig):\n"
                "1. Returnera ENDAST recept som faktiskt står utskrivna med både "
                "ingredienser OCH instruktioner. Hitta inte på något.\n"
                "2. En unik maträtt = ett objekt. Aldrig dubbletter.\n"
                "3. Hoppa över innehållsförteckningar, kapitelintron, sidnummer.\n"
                "4. Behåll svenska accenter och specialtecken som de står.\n"
                "5. Svara endast med JSON-objektet — ingen prosa, ingen markdown."
            )
            user_prompt = (
                f"Extrahera alla unika recept ur följande PDF-text "
                f"({len(page_texts)} sidor):\n\n{raw_text}"
            )
            # Begränsa AI-väntan till 45s — Staik:s Qwen står ofta i kö.
            # Snabb fallback till heuristik om svaret dröjer.
            ai_response = await asyncio.wait_for(
                chat(user_prompt, system=system_prompt, expect_json=True, task="pdf_extract"),
                timeout=45,
            )
            parsed = safe_parse_json(ai_response)
            if isinstance(parsed, dict) and isinstance(parsed.get("recipes"), list):
                raw_recipes = [r for r in parsed["recipes"] if isinstance(r, dict)]
                method = "ai_oneshot"
        except asyncio.TimeoutError:
            ai_reason = "Staik svarade inte inom 45s (kö/överbelastad) — använder heuristik"
        except AIUnavailable as e:
            ai_reason = str(e)
        except Exception as e:
            ai_reason = str(e)[:200]

    # ── Fallback: makro-ankrad heuristik om AI tom eller misslyckades ─────
    if not raw_recipes:
        macro_results = _extract_macro_anchored(raw_text)
        if macro_results:
            raw_recipes = [r for r, _ in macro_results]
            method = "macro_anchored" if not AI_API_KEY else f"macro_anchored_fallback ({ai_reason or 'tom AI'})"
        else:
            raw_recipes = _extract_recipes_heuristic(raw_text)
            method = "section_heuristic" if not AI_API_KEY else f"section_heuristic_fallback ({ai_reason or 'tom AI'})"

    # ── Bildmatchning — körs ALLTID, oavsett extraktionsmetod ─────────────
    # 1. Försök först via anchor_pos om vi har det (macro-results)
    anchor_lookup = {id(r): pos for r, pos in macro_results} if macro_results else {}

    def _find_page_for_title(title: str) -> int | None:
        """Sök igenom sidor och hitta första som innehåller receptets titel.

        Normaliserar whitespace åt båda håll så vi matchar även när PDF:en
        bryter titeln på två rader (t.ex. "Kebabpizza\\npå libabröd") medan
        AI-svaret har en enrads-titel ("Kebabpizza på libabröd").
        """
        if not title or len(title) < 3:
            return None
        needle = " ".join(title.lower().split())
        for page_idx, page_text in enumerate(page_texts):
            normalized = " ".join(page_text.lower().split())
            if needle in normalized:
                return page_idx
        # Sista utvägen: första betydande ord (t.ex. "Kebabpizza")
        words = needle.split()
        first_word = words[0] if words else ""
        if len(first_word) >= 5:
            for page_idx, page_text in enumerate(page_texts):
                if first_word in page_text.lower():
                    return page_idx
        return None

    matched = 0
    no_page = 0
    no_image_on_page = 0
    cover_debug: list[dict] = []  # för frontend-diagnostik
    for recipe in raw_recipes:
        title = recipe.get("title", "")
        if recipe.get("cover_image"):
            matched += 1
            continue
        if id(recipe) in anchor_lookup:
            page_idx = _page_of(anchor_lookup[id(recipe)])
            source = "anchor"
        else:
            page_idx = _find_page_for_title(title)
            source = "title-search"
        if page_idx is None:
            no_page += 1
            cover_debug.append({"title": title, "outcome": "title-not-found", "source": source})
            continue
        attached = False
        for try_page in (page_idx, page_idx + 1, page_idx - 1, page_idx + 2):
            if try_page in images_by_page and images_by_page[try_page]:
                recipe["cover_image"] = images_by_page[try_page][0]
                matched += 1
                attached = True
                cover_debug.append({"title": title, "outcome": "matched", "page": try_page, "source": source})
                break
        if not attached:
            no_image_on_page += 1
            cover_debug.append({"title": title, "outcome": "no-image-on-page", "page": page_idx, "source": source})

    print(
        f"[skaffio.pdf] cover-matching: {matched} matched, "
        f"{no_page} title-not-found, {no_image_on_page} no-image-on-page · "
        f"total images extracted: {len(all_images)} from {len(page_texts)} pages",
        flush=True,
    )
    print(f"[skaffio.pdf] images-per-page (non-empty): "
          f"{ {p: len(imgs) for p, imgs in images_by_page.items() if imgs} }", flush=True)

    unique = _dedup_recipes(raw_recipes)

    log_audit(session, user, "pdf.import",
              details={"pages": len(page_texts), "recipes_found": len(unique), "method": method})

    return {
        "images": all_images,
        "extracted_recipes": unique,
        "ai_status": "ok" if method == "ai_oneshot" else ("disabled" if not AI_API_KEY else "fallback"),
        "ai_reason": ai_reason,
        "extraction_stats": {
            "method": method,
            "pages": len(page_texts),
            "raw_extracted": len(raw_recipes),
            "after_dedup": len(unique),
            "capped_at": MAX_RECIPES_PER_PDF if len(raw_recipes) > MAX_RECIPES_PER_PDF else None,
            "total_images_extracted": len(all_images),
            "covers_matched": matched,
            "covers_no_page_match": no_page,
            "covers_no_image_on_page": no_image_on_page,
            "cover_debug": cover_debug[:5],  # första 5 för diagnos
            "images_per_page": {p: len(imgs) for p, imgs in images_by_page.items() if imgs},
        },
    }


def _parse_iso_duration(s: str) -> Optional[int]:
    """Parse ISO 8601 duration like 'PT30M' or 'PT1H15M' → minutes."""
    if not s:
        return None
    import re as _re
    m = _re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?", str(s))
    if not m:
        return None
    h, mi = m.group(1), m.group(2)
    return (int(h or 0) * 60) + int(mi or 0) or None


def _split_ingredient(text: str) -> dict:
    """Heuristic: split 'Mängd Enhet Namn' from a free-text line."""
    import re as _re
    text = (text or "").strip()
    if not text:
        return {"name": "", "amount": "", "unit": ""}
    # Capture leading amount (incl. fractions / decimals / dl-style)
    m = _re.match(r"^([\d.,/\s½¼¾⅓⅔]+)\s*([a-zA-ZåäöÅÄÖ.]+)?\s+(.+)$", text)
    if m:
        amount = m.group(1).strip()
        unit = (m.group(2) or "").strip()
        # Only treat short tokens (msk/tsk/dl/g/kg/ml/l/krm) as units
        if unit and len(unit) <= 5:
            return {"amount": amount, "unit": unit, "name": m.group(3).strip()}
        return {"amount": amount, "unit": "", "name": (unit + " " + m.group(3)).strip()}
    return {"name": text, "amount": "", "unit": ""}


async def _download_remote_image(url: str) -> Optional[str]:
    """Fetch a remote image into /data/uploads/ + thumb. Returns local filename, or None on failure."""
    import httpx
    import uuid as _uuid
    if not url or not url.startswith(("http://", "https://")):
        return None
    if not _is_safe_url(url):
        logger.warning("_download_remote_image: blockerad intern URL %s", url)
        return None
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/jpeg")
            content = resp.content
    except Exception:
        return None

    ext = ".jpg"
    if "png" in content_type: ext = ".png"
    elif "webp" in content_type: ext = ".webp"
    elif "gif" in content_type: ext = ".gif"

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"import-{_uuid.uuid4().hex[:10]}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    try:
        with open(path, "wb") as f:
            f.write(content)
        thumb_path = os.path.join(UPLOAD_DIR, f"thumb_{filename.rsplit('.', 1)[0]}.jpg")
        create_thumbnail(path, thumb_path)
    except Exception:
        return None
    return filename


async def _extract_video_frame(url: str) -> Optional[str]:
    """Ladda ner video (Instagram/TikTok/YouTube) via yt-dlp, plocka frame vid 50%
    via ffmpeg, spara som cover-bild + thumb. Returnerar lokalt filnamn eller None."""
    import asyncio
    import tempfile
    import uuid as _uuid

    if not url:
        return None
    if not _is_safe_url(url):
        logger.warning("_extract_video_frame: blockerad intern URL %s", url)
        return None

    tmpdir = tempfile.mkdtemp(prefix="skaffio-vid-")
    video_path = os.path.join(tmpdir, "video.mp4")
    try:
        # 1) Ladda ner video (lägsta upplösning räcker — vi vill bara ha en frame)
        ytdlp = await asyncio.create_subprocess_exec(
            "yt-dlp",
            "--quiet",
            "--no-warnings",
            "--no-playlist",
            "--format", "worst[ext=mp4]/worst",
            "--max-filesize", "50M",
            "-o", video_path,
            url,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await asyncio.wait_for(ytdlp.communicate(), timeout=60)
        if ytdlp.returncode != 0 or not os.path.exists(video_path):
            logger.warning("yt-dlp failed for %s: %s", url, (err or b"").decode()[:200])
            return None

        # 2) Hitta video-längd via ffprobe
        probe = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", video_path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(probe.communicate(), timeout=10)
        try:
            duration = float((out or b"0").decode().strip() or "0")
        except ValueError:
            duration = 0.0
        seek = max(0.5, duration * 0.5) if duration > 0 else 1.0

        # 3) Plocka frame
        filename = f"vid-{_uuid.uuid4().hex[:10]}.jpg"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        out_path = os.path.join(UPLOAD_DIR, filename)
        ffmpeg = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-ss", str(seek), "-i", video_path,
            "-frames:v", "1", "-q:v", "2", out_path,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(ffmpeg.communicate(), timeout=15)
        if ffmpeg.returncode != 0 or not os.path.exists(out_path):
            return None

        thumb_path = os.path.join(UPLOAD_DIR, f"thumb_{filename.rsplit('.', 1)[0]}.jpg")
        try:
            create_thumbnail(out_path, thumb_path)
        except Exception:
            pass
        return filename
    except Exception as e:
        logger.warning("Video frame extraction failed for %s: %s", url, e)
        return None
    finally:
        try:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


async def _suggest_tags_for(title: str, ingredients_json: str, instructions: str, session) -> list[str]:
    """AI föreslår 1-5 taggar baserat på recept + dina befintliga taggar."""
    if not title:
        return []
    try:
        from services.ai import chat, safe_parse_json, AIUnavailable
        from models import Tag
        from sqlmodel import select as _sel
        import json as __json
        existing = [t.name for t in session.exec(_sel(Tag)).all()]
        prompt = (
            "Föreslå 1-5 relevanta svenska taggar för detta recept. "
            "Återanvänd helst BEFINTLIGA taggar, lägg bara till nya om det verkligen behövs.\n\n"
            f"BEFINTLIGA TAGGAR: {', '.join(existing) if existing else '(inga än)'}\n\n"
            f"RECEPT:\n"
            f"Titel: {title}\n"
            f"Ingredienser (sample): {(ingredients_json or '')[:400]}\n"
            f"Instruktioner (start): {(instructions or '')[:300]}\n\n"
            "Vanliga svenska tag-namn: vegetariskt, vego, kyckling, nöt, fläsk, fisk, "
            "skaldjur, ägg, snabbt, barnvänligt, vardagsmat, helgmat, soppa, gryta, "
            "pasta, ris, pizza, glutenfritt, laktosfritt, asiatiskt, italienskt, "
            "mexikanskt, indiskt, frukost, lunch, middag, mellanmål, dessert, bakning.\n\n"
            'Returnera STRICT JSON: {"tags": ["tag1", "tag2", ...]}'
        )
        raw = await chat(prompt, expect_json=True, task="tag_suggest")
        parsed = safe_parse_json(raw) or {}
        tags = [str(t).strip().lower() for t in (parsed.get("tags") or []) if t]
        return tags[:5]
    except (AIUnavailable, Exception) as e:
        logger.warning("Tag suggestion failed: %s", e)
        return []


def _extract_jsonld_recipe(soup) -> Optional[dict]:
    """Find a schema.org Recipe inside any <script type=application/ld+json>."""
    import json as _json
    for script in soup.find_all("script", type="application/ld+json"):
        raw = (script.string or script.get_text() or "").strip()
        if not raw:
            continue
        try:
            data = _json.loads(raw)
        except _json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        # Flatten @graph if present
        flat = []
        for c in candidates:
            if isinstance(c, dict) and "@graph" in c and isinstance(c["@graph"], list):
                flat.extend(c["@graph"])
            else:
                flat.append(c)
        for item in flat:
            if not isinstance(item, dict):
                continue
            t = item.get("@type")
            if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
                return item
    return None


@router.post("/import/url")
async def import_from_url(
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    import asyncio as _asyncio
    import httpx
    import json as _json
    from bs4 import BeautifulSoup
    from services.ai import chat, safe_parse_json, AIUnavailable
    from services import firecrawl as _fc

    url = data.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    if not _is_safe_url(url):
        raise HTTPException(status_code=400, detail="URL tillåts inte — interna adresser blockerade")

    empty = {
        "title": "", "description": "", "ingredients": "[]",
        "instructions": "", "cover_image": None, "source_url": url,
        "source_type": "url", "servings": None, "prep_time": None, "cook_time": None,
    }

    # Kör Firecrawl + httpx parallellt — sparar tid
    async def _fetch_html():
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            return r.text

    try:
        html_text, fc_data = await _asyncio.gather(
            _fetch_html(),
            _fc.scrape_url(url),
            return_exceptions=True,
        )
        if isinstance(html_text, Exception):
            return {**empty, "error": str(html_text)}
        if isinstance(fc_data, Exception):
            fc_data = None
    except Exception as e:
        return {**empty, "error": str(e)}

    soup = BeautifulSoup(html_text, "html.parser")
    fc_markdown = (fc_data or {}).get("markdown", "") or ""
    fc_meta = (fc_data or {}).get("metadata") or {}

    def meta(name):
        tag = soup.find("meta", property=name) or soup.find("meta", attrs={"name": name})
        return tag["content"].strip() if tag and tag.get("content") else ""

    is_instagram = "instagram.com" in url.lower()
    if is_instagram:
        caption = meta("og:description") or meta("description")
        cover_image = meta("og:image")
        if caption:
            try:
                prompt = (
                    "Extract a recipe from this Instagram caption. "
                    "Do not include unrelated content. Return strict JSON:\n"
                    "{ \"title\": string, \"description\": string, "
                    "\"ingredients\": [{\"name\": string, \"amount\": string, \"unit\": string}], "
                    "\"instructions\": string, \"servings\": number|null }"
                    f"\n\nCaption:\n{caption}"
                )
                raw = await chat(prompt, expect_json=True, task="url_import")
                parsed = safe_parse_json(raw) or {}
                title = (parsed.get("title") or meta("og:title") or "").strip()
                description = (parsed.get("description") or "").strip()
                ingredients_list = parsed.get("ingredients") if isinstance(parsed.get("ingredients"), list) else []
                ingredients = [
                    {
                        "name": str(i.get("name", "")).strip(),
                        "amount": str(i.get("amount", "")).strip(),
                        "unit": str(i.get("unit", "")).strip(),
                    }
                    for i in ingredients_list if isinstance(i, dict) and i.get("name")
                ]
                instructions = (parsed.get("instructions") or "").strip()
                servings = parsed.get("servings")
                # Reels/video → yt-dlp for a clean frame; skip og:image if it fails
                # (og:image for video posts has a play-button baked into the pixels)
                is_video_post = (
                    "/reel/" in url.lower()
                    or "video" in (meta("og:type") or "").lower()
                )
                video_cover = await _extract_video_frame(url)
                if video_cover:
                    cover_image = video_cover
                elif is_video_post:
                    cover_image = None  # play-button thumbnail — skip it
                else:
                    local_cover = await _download_remote_image(cover_image)
                    if local_cover:
                        cover_image = local_cover
                if title or ingredients or instructions:
                    ig_ings = _json.dumps(ingredients, ensure_ascii=False)
                    return {
                        "title": title,
                        "description": description,
                        "ingredients": ig_ings,
                        "instructions": instructions,
                        "cover_image": cover_image,
                        "source_url": url,
                        "source_type": "url",
                        "servings": servings,
                        "prep_time": None,
                        "cook_time": None,
                        "suggested_tags": await _suggest_tags_for(title, ig_ings, instructions, session),
                    }
            except AIUnavailable:
                pass

    # ── 1. Prefer schema.org Recipe (JSON-LD) — much more reliable ─────────
    recipe = _extract_jsonld_recipe(soup)
    if recipe:
        title = (recipe.get("name") or "").strip()
        description = (recipe.get("description") or "").strip()

        import html as _html
        image = recipe.get("image")
        if isinstance(image, list) and image:
            image = image[0]
        if isinstance(image, dict):
            image = image.get("url", "")
        # JSON-LD image URLs sometimes contain HTML entities (e.g. &amp; from mathem.se)
        jsonld_image = _html.unescape((image or "").strip())
        og_image = meta("og:image") or ""
        # Try JSON-LD image first, then og:image as fallback
        local_cover = None
        for candidate in filter(None, [jsonld_image, og_image]):
            local_cover = await _download_remote_image(candidate)
            if local_cover:
                break
        cover_image = local_cover or jsonld_image or og_image

        raw_ings = recipe.get("recipeIngredient") or []
        if isinstance(raw_ings, str):
            raw_ings = [raw_ings]
        ingredients = [_split_ingredient(i) for i in raw_ings if i]

        instr = recipe.get("recipeInstructions") or []
        steps: list[str] = []
        if isinstance(instr, str):
            steps = [s.strip() for s in instr.split("\n") if s.strip()]
        elif isinstance(instr, list):
            for step in instr:
                if isinstance(step, str):
                    steps.append(step.strip())
                elif isinstance(step, dict):
                    t = step.get("@type", "")
                    if t == "HowToSection" and isinstance(step.get("itemListElement"), list):
                        for sub in step["itemListElement"]:
                            if isinstance(sub, dict):
                                steps.append((sub.get("text") or sub.get("name") or "").strip())
                    else:
                        steps.append((step.get("text") or step.get("name") or "").strip())
        steps = [s for s in steps if s]
        instructions = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps))

        yield_field = recipe.get("recipeYield")
        if isinstance(yield_field, list) and yield_field:
            yield_field = yield_field[0]
        servings = None
        if yield_field:
            import re as _re
            m = _re.search(r"\d+", str(yield_field))
            if m:
                servings = int(m.group(0))

        prep_time = _parse_iso_duration(recipe.get("prepTime"))
        cook_time = _parse_iso_duration(recipe.get("cookTime") or recipe.get("totalTime"))

        final_title = title or meta("og:title")
        final_ings = _json.dumps(ingredients, ensure_ascii=False)
        return {
            "title": final_title,
            "description": description or meta("og:description"),
            "ingredients": final_ings,
            "instructions": instructions,
            "cover_image": cover_image,
            "source_url": url,
            "source_type": "url",
            "servings": servings,
            "prep_time": prep_time,
            "cook_time": cook_time,
            "suggested_tags": await _suggest_tags_for(final_title, final_ings, instructions, session),
        }

    # ── 2. Fallback: og: meta tags + heuristic DOM scraping ────────────────
    title = meta("og:title") or (soup.find("h1").get_text(strip=True) if soup.find("h1") else "")
    description = meta("og:description")
    cover_image = meta("og:image") or fc_meta.get("ogImage") or _fc.pick_best_image(fc_markdown, fc_meta)
    local_cover = await _download_remote_image(cover_image)
    if local_cover:
        cover_image = local_cover

    ingredients = []
    for el in soup.find_all(["ul", "ol"]):
        classes = " ".join(el.get("class", []))
        if "ingredient" in classes.lower():
            for li in el.find_all("li"):
                t = li.get_text(strip=True)
                if t:
                    ingredients.append(_split_ingredient(t))
            break

    instructions = ""
    for el in soup.find_all(["ol", "div"]):
        classes = " ".join(el.get("class", []))
        if any(k in classes.lower() for k in ("instruction", "direction", "step")):
            steps = [li.get_text(strip=True) for li in el.find_all("li")]
            if steps:
                instructions = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps))
                break

    # ── 3. Sista fallback: AI extraherar från sidans text ────────────────
    # Triggas om heuristiken hittade inga ingredienser ELLER inga instruktioner.
    if not ingredients or not instructions:
        try:
            if fc_markdown:
                # Firecrawl ger redan ren markdown — bättre än BeautifulSoup-text
                page_text = fc_markdown[:8000]
            else:
                for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                    tag.decompose()
                page_text = soup.get_text(separator="\n", strip=True)[:8000]
            ai_prompt = (
                "Extrahera ett recept från denna webbsida. Svara alltid på svenska. Returnera STRICT JSON:\n"
                "{\"title\": string, \"description\": string, "
                "\"ingredients\": [{\"name\": string, \"amount\": string, \"unit\": string}], "
                "\"instructions\": string, \"servings\": number|null, "
                "\"prep_time\": number|null, \"cook_time\": number|null}\n\n"
                f"SIDA:\n{page_text}"
            )
            raw = await chat(ai_prompt, expect_json=True, task="url_import")
            parsed = safe_parse_json(raw) or {}
            ai_ings = parsed.get("ingredients") if isinstance(parsed.get("ingredients"), list) else []
            ai_ings = [
                {"name": str(i.get("name", "")).strip(),
                 "amount": str(i.get("amount", "")).strip(),
                 "unit": str(i.get("unit", "")).strip()}
                for i in ai_ings if isinstance(i, dict) and i.get("name")
            ]
            f_title = (parsed.get("title") or title or "").strip()
            f_ings = _json.dumps(ai_ings or ingredients, ensure_ascii=False)
            f_instr = (parsed.get("instructions") or instructions or "").strip()
            return {
                "title": f_title,
                "description": (parsed.get("description") or description or "").strip(),
                "ingredients": f_ings,
                "instructions": f_instr,
                "cover_image": cover_image,
                "source_url": url,
                "source_type": "url",
                "servings": parsed.get("servings"),
                "prep_time": parsed.get("prep_time"),
                "cook_time": parsed.get("cook_time"),
                "suggested_tags": await _suggest_tags_for(f_title, f_ings, f_instr, session),
            }
        except (AIUnavailable, Exception) as e:
            logger.warning("AI fallback failed for %s: %s", url, e)

    return {
        **empty,
        "title": title,
        "description": description,
        "ingredients": _json.dumps(ingredients, ensure_ascii=False),
        "instructions": instructions,
        "cover_image": cover_image,
    }


@router.post("/import/url-discover")
async def discover_recipe_urls(
    data: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Hitta alla individuella recept-URL:er på en samlingssida via Firecrawl + AI."""
    import json as _json
    from services.ai import chat, safe_parse_json, AIUnavailable
    from services import firecrawl as _fc

    url = data.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    if not _is_safe_url(url):
        raise HTTPException(status_code=400, detail="URL tillåts inte")

    # Strategi 1: Firecrawl links-format med waitFor — hanterar lazy loading/infinite scroll
    all_links = await _fc.scrape_links(url, wait_ms=5000)

    if all_links:
        # Skicka länklistan till AI för filtrering — mycket billigare än hel markdown
        links_text = "\n".join(all_links[:300])
        prompt = (
            f"Nedan är alla URL:er från sidan {url}. "
            f'Returnera JSON-objekt med nyckel "urls" innehållande BARA URL:er till enskilda recept. '
            f"Exkludera kategorisidor, taggsidor, om-sidor, navigation och liknande.\n\n"
            f"URL-LISTA:\n{links_text}"
        )
    else:
        # Strategi 2 (fallback): httpx+BS markdown → AI
        import httpx as _httpx
        from bs4 import BeautifulSoup as _BS
        try:
            async with _httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                resp.raise_for_status()
            soup = _BS(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer"]):
                tag.decompose()
            page_text = soup.get_text(separator="\n", strip=True)[:8000]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Kunde inte hämta sidan: {e}")
        prompt = (
            f"Hitta alla URL:er till individuella recept på denna sida. "
            f'Returnera JSON-objekt med nyckel "urls" innehållande en array av kompletta URL-strängar. '
            f"Inkludera BARA URL:er till enskilda recept, inte kategorier eller samlingar. "
            f"Om en URL är relativ, gör den absolut med basdomänen från: {url}\n\n"
            f"SIDINNEHÅLL:\n{page_text}"
        )

    try:
        raw = await chat(prompt, expect_json=True, task="url_discover")
        parsed = safe_parse_json(raw)
        if isinstance(parsed, list):
            found = parsed
        elif isinstance(parsed, dict):
            found = parsed.get("urls") or []
        else:
            found = []
        urls = [u for u in found if isinstance(u, str) and u.startswith("http")]
    except (AIUnavailable, Exception) as e:
        logger.warning("url-discover AI failed: %s", e)
        urls = []

    return {"urls": urls, "count": len(urls)}


@router.get("/images")
def list_images(
    recipe_id: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from models import Recipe as _Recipe
    # Only return images for recipes that belong to the caller's household
    owned_recipe_ids = session.exec(
        select(_Recipe.id).where(_Recipe.household_id == user.household_id)
    ).all()
    query = select(RecipeImage).where(RecipeImage.recipe_id.in_(owned_recipe_ids))
    if recipe_id is not None:
        query = query.where(RecipeImage.recipe_id == recipe_id)
    return session.exec(query).all()


@router.delete("/images/{image_id}")
def delete_image(
    image_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    image = session.get(RecipeImage, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    from models import Recipe as _Recipe
    owner_recipe = session.get(_Recipe, image.recipe_id) if image.recipe_id else None
    if owner_recipe and owner_recipe.household_id != user.household_id:
        raise HTTPException(status_code=403, detail="Inte ditt recept")

    for path in [
        os.path.join(UPLOAD_DIR, image.filename),
        os.path.join(UPLOAD_DIR, f"thumb_{image.filename.rsplit('.', 1)[0]}.jpg"),
    ]:
        if os.path.exists(path):
            os.remove(path)

    filename = image.filename
    session.delete(image)
    session.commit()
    log_audit(session, user, "image.delete", entity_type="recipe_image",
              entity_id=image_id, details={"filename": filename})
    return {"ok": True}
