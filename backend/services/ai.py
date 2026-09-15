"""Multi-provider AI bridge med automatisk failover.

Stödjer flera providers samtidigt. Varje provider aktiveras automatiskt när
dess API-nyckel finns i .env — saknas nyckeln hoppas providern över i kedjan.
Lägg till en nyckel → providern går med. Ta bort → den skippas. Inga
kodändringar behövs för att byta motor.

Providers (alla OpenAI-kompatibla utom Claude som är native Anthropic):
  - gemini   GEMINI_API_KEY        (gratis-tier, stark vision/OCR)
  - staik    STAIK_API_KEY/AI_API_KEY (legacy single-provider config funkar kvar)
  - github   GITHUB_MODELS_API_KEY (GitHub Models gratis-tier)
  - claude   ANTHROPIC_API_KEY     (premium OCR, kostar credits)

Fallback-ordning styrs av TEXT_CHAIN / VISION_CHAIN nedan. Free/billigt först,
betalt (Claude) sist. Vill du ändra ordningen — redigera listorna.

Public surface (oförändrad mot tidigare): chat(), vision_chat(),
vision_chat_multi(), claude_chat(), claude_vision(), safe_parse_json(),
AIUnavailable, AI_API_KEY (truthy om någon text-provider är konfigurerad).
"""

import json
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("skaffio.ai")

ANTHROPIC_VERSION = "2023-06-01"

# Bakåtkomp: gamla single-provider Anthropic-konstanter (används av claude_chat/_vision)
ANTHROPIC_API_URL = os.getenv("ANTHROPIC_API_URL", "https://api.anthropic.com/v1").rstrip("/")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")


class AIUnavailable(Exception):
    """Raised when no configured provider could fulfil the request."""


# Backward-compat alias så äldre imports fortsätter funka.
OllamaUnavailable = AIUnavailable


# ─── Provider-registry ──────────────────────────────────────────────────────
def _provider(name, url, key, text_model, vision_model, kind="openai"):
    return {
        "name": name,
        "url": (url or "").rstrip("/"),
        "key": key or "",
        "text_model": text_model or "",
        "vision_model": vision_model or "",
        "kind": kind,  # "openai" | "anthropic"
    }


PROVIDERS = {
    "gemini": _provider(
        "gemini",
        os.getenv("GEMINI_API_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
        os.getenv("GEMINI_API_KEY", ""),
        os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        os.getenv("GEMINI_VISION_MODEL", os.getenv("GEMINI_MODEL", "gemini-2.0-flash")),
    ),
    "staik": _provider(
        "staik",
        # Legacy AI_API_* honoras så befintlig Staik-config funkar utan att döpas om.
        # Use "or" (not default arg) because docker-compose sets vars to "" (empty string),
        # which os.getenv() returns as-is instead of falling through to the default.
        os.getenv("STAIK_API_URL") or os.getenv("AI_API_URL", ""),
        os.getenv("STAIK_API_KEY") or os.getenv("AI_API_KEY", ""),
        os.getenv("STAIK_MODEL") or os.getenv("AI_MODEL", ""),
        os.getenv("STAIK_VISION_MODEL") or os.getenv("AI_VISION_MODEL") or os.getenv("AI_MODEL", ""),
    ),
    "github": _provider(
        "github",
        os.getenv("GITHUB_MODELS_API_URL", "https://models.inference.ai.azure.com"),
        os.getenv("GITHUB_MODELS_API_KEY", ""),
        os.getenv("GITHUB_MODELS_MODEL", "gpt-4o"),
        os.getenv("GITHUB_MODELS_VISION_MODEL", "gpt-4o"),
    ),
    "claude": _provider(
        "claude",
        ANTHROPIC_API_URL,
        ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL,
        ANTHROPIC_MODEL,
        kind="anthropic",
    ),
}

# Fallback-ordning. Provider hoppas över automatiskt om nyckel/url saknas.
# Staik = huvudmotor (bäst). Resten är fallback om Staik ligger nere / svarar fel.
TEXT_CHAIN = ["staik", "gemini", "github", "claude"]
VISION_CHAIN = ["staik", "gemini", "claude", "github"]

# ── Per-task routing ────────────────────────────────────────────────────────
# Vill du att en viss funktion ska föredra en viss modell? Lägg den här med
# sin egen prioordning. Saknas en task här används default (TEXT_CHAIN/VISION_CHAIN).
# Providers utan nyckel hoppas alltid över automatiskt, så listorna kan vara
# generösa. Redigera fritt — detta är hela "vilken modell gör vad"-styrningen.
# Per-task override. TOMT = alla uppgifter använder default-kedjorna ovan
# (Staik först). Vill du styra en enskild uppgift till en annan motor, lägg den
# här, t.ex.:  "ai_search": ["github", "staik"]  (mat-tips på GitHub istället).
# Saknad task → default. Providers utan nyckel hoppas alltid över automatiskt.
TASK_CHAINS: dict[str, list[str]] = {}

# ── Privacy ─────────────────────────────────────────────────────────────────
# Providers som kör i hemmet — data lämnar aldrig huset. Allt annat är cloud.
LOCAL_PROVIDERS = {"staik"}

# Kvitton = köphistorik. Default: skickas ALDRIG till cloud — bara lokala Staik.
# Är Staik nere får kvittoskanningen ett tydligt fel istället för tyst cloud-läcka.
# Sätt RECEIPT_LOCAL_ONLY=false i .env om cloud-fallback för kvitton är OK.
RECEIPT_LOCAL_ONLY = os.getenv("RECEIPT_LOCAL_ONLY", "true").lower() in ("1", "true", "yes")
if RECEIPT_LOCAL_ONLY:
    TASK_CHAINS["receipt_scan"] = ["staik"]


def _chain_for(task: Optional[str], default: list[str]) -> list[str]:
    if task and task in TASK_CHAINS:
        return TASK_CHAINS[task]
    return default

# Senast använda provider (för diagnos / model_used i API-svar).
_LAST_PROVIDER: Optional[str] = None

# Fallback-notiser: max en Discord-notis per provider per timme (annars spam
# om Staik ligger nere en hel kväll).
_FALLBACK_NOTIFIED: dict[str, float] = {}
_FALLBACK_COOLDOWN = 3600.0


async def _notify_fallback(kind: str, used: dict, primary: str, err) -> None:
    """Discord-notis när en CLOUD-provider används för att primären failade.
    En tyst privacy-nedgradering ska aldrig vara tyst. Fail-soft — får aldrig
    krascha AI-anropet."""
    if used["name"] in LOCAL_PROVIDERS:
        return  # fallback till lokal motor läcker inget — ingen notis
    import time
    now = time.monotonic()
    if now - _FALLBACK_NOTIFIED.get(used["name"], -_FALLBACK_COOLDOWN) < _FALLBACK_COOLDOWN:
        return
    _FALLBACK_NOTIFIED[used["name"]] = now
    try:
        from services.discord import notify
        await notify(
            f"AI-{kind} föll tillbaka till cloud-providern **{used['name']}** — "
            f"`{primary}` failade: {str(err)[:150]}",
            level="warning",
            embed_title="☁️ AI cloud-fallback (data lämnade huset)",
        )
    except Exception:
        logger.debug("fallback-notis kunde inte skickas", exc_info=True)


def last_provider() -> Optional[str]:
    return _LAST_PROVIDER


def _available(chain: list[str]) -> list[dict]:
    """Providers i kedjan som har både nyckel och url + relevant modell."""
    out = []
    for name in chain:
        p = PROVIDERS.get(name)
        if p and p["key"] and p["url"]:
            out.append(p)
    return out


# Truthy om minst en text-provider är konfigurerad. Bakåtkomp för callers
# som gör `if AI_API_KEY:` (t.ex. images.py PDF-extraktion).
AI_API_KEY = "configured" if _available(TEXT_CHAIN) else ""


# ─── Low-level POST ──────────────────────────────────────────────────────────
async def _openai_post(prov: dict, payload: dict, timeout: float) -> str:
    headers = {
        "Authorization": f"Bearer {prov['key']}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{prov['url']}/chat/completions", json=payload, headers=headers)
        if resp.status_code >= 400:
            raise AIUnavailable(f"{prov['name']} HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise AIUnavailable(f"{prov['name']} oväntat svar: {e}")


async def _anthropic_post(prov: dict, content, system: str, timeout: float) -> str:
    payload = {
        "model": prov["text_model"],
        "max_tokens": 8192,
        "messages": [{"role": "user", "content": content}],
    }
    if system:
        payload["system"] = system
    headers = {
        "x-api-key": prov["key"],
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{prov['url']}/messages", json=payload, headers=headers)
        if resp.status_code >= 400:
            raise AIUnavailable(f"claude HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
    for block in data.get("content", []):
        if block.get("type") == "text":
            return block.get("text", "") or ""
    return ""


# ─── Public: text ────────────────────────────────────────────────────────────
async def chat(prompt: str, system: Optional[str] = None, *, expect_json: bool = False,
               timeout: float = 120, task: Optional[str] = None) -> str:
    global _LAST_PROVIDER
    provs = _available(_chain_for(task, TEXT_CHAIN))
    if not provs:
        raise AIUnavailable(
            "Ingen text-AI konfigurerad — sätt GEMINI_API_KEY / STAIK_API_KEY / "
            "GITHUB_MODELS_API_KEY / ANTHROPIC_API_KEY i .env"
        )
    last_err = None
    for prov in provs:
        try:
            if prov["kind"] == "anthropic":
                sys = system or ""
                out = await _anthropic_post(prov, prompt, sys, timeout)
            else:
                messages = []
                if system:
                    messages.append({"role": "system", "content": system})
                messages.append({"role": "user", "content": prompt})
                payload: dict = {"model": prov["text_model"], "messages": messages}
                if expect_json:
                    payload["response_format"] = {"type": "json_object"}
                out = await _openai_post(prov, payload, timeout)
            _LAST_PROVIDER = prov["name"]
            logger.info("AI text via %s", prov["name"])
            if prov is not provs[0]:
                await _notify_fallback("text", prov, provs[0]["name"], last_err)
            return out
        except Exception as e:
            logger.warning("text provider %s misslyckades: %s", prov["name"], e)
            last_err = e
    raise AIUnavailable(f"Alla text-providers misslyckades (sist: {last_err})")


# ─── Public: bildgenerering (Gemini "Nano Banana") ──────────────────────────
GEMINI_IMAGE_MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")


async def generate_image(prompt: str, *, timeout: float = 60) -> Optional[bytes]:
    """Generera en bild via Gemini image-modellen. Returnerar råa bildbytes
    (PNG/JPEG) eller None — fail-soft, anroparen ska klara sig utan bild.

    Använder Geminis NATIVA endpoint (inte OpenAI-kompat-lagret) eftersom
    bildgenerering inte exponeras via /openai-vägen.
    """
    key = PROVIDERS["gemini"]["key"]
    if not key:
        logger.info("generate_image: GEMINI_API_KEY saknas — hoppar över")
        return None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_IMAGE_MODEL}:generateContent"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers={"x-goog-api-key": key})
            if resp.status_code >= 400:
                logger.warning("generate_image: HTTP %s: %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json()
        for cand in data.get("candidates", []):
            for part in (cand.get("content") or {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if inline.get("data"):
                    import base64
                    return base64.b64decode(inline["data"])
    except Exception as e:
        logger.warning("generate_image misslyckades: %s", e)
    return None


# ─── Public: vision ──────────────────────────────────────────────────────────
async def vision_chat_multi(prompt: str, images: list[tuple[str, str]], *,
                            expect_json: bool = False, timeout: float = 240,
                            task: Optional[str] = None) -> str:
    """Skicka en eller flera bilder till vision-AI:n i ETT anrop, med failover.

    images = [(base64, mime_type), ...]
    """
    global _LAST_PROVIDER
    provs = _available(_chain_for(task, VISION_CHAIN))
    if not provs:
        raise AIUnavailable(
            "Ingen vision-AI konfigurerad — sätt GEMINI_API_KEY / ANTHROPIC_API_KEY / "
            "GITHUB_MODELS_API_KEY i .env"
        )
    last_err = None
    for prov in provs:
        try:
            if prov["kind"] == "anthropic":
                content_blocks: list[dict] = []
                for image_b64, mime in images:
                    content_blocks.append({
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime or "image/jpeg", "data": image_b64},
                    })
                content_blocks.append({"type": "text", "text": prompt})
                out = await _anthropic_post(prov, content_blocks, "", timeout)
            else:
                content = [{"type": "text", "text": prompt}]
                for image_b64, mime in images:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                    })
                payload: dict = {"model": prov["vision_model"], "messages": [{"role": "user", "content": content}]}
                if expect_json:
                    payload["response_format"] = {"type": "json_object"}
                out = await _openai_post(prov, payload, timeout)
            _LAST_PROVIDER = prov["name"]
            logger.info("AI vision via %s", prov["name"])
            if prov is not provs[0]:
                await _notify_fallback("vision", prov, provs[0]["name"], last_err)
            return out
        except Exception as e:
            logger.warning("vision provider %s misslyckades: %s", prov["name"], e)
            last_err = e
    raise AIUnavailable(f"Alla vision-providers misslyckades (sist: {last_err})")


async def vision_chat(prompt: str, image_b64: str, *, expect_json: bool = False,
                      mime: str = "image/jpeg", task: Optional[str] = None) -> str:
    return await vision_chat_multi(prompt, [(image_b64, mime)], expect_json=expect_json, task=task)


# ─── Native Anthropic (bakåtkomp — direkta anropare) ─────────────────────────
async def claude_chat(prompt: str, system: str, *, model: Optional[str] = None,
                      max_tokens: int = 8192, timeout: float = 180) -> str:
    if not ANTHROPIC_API_KEY:
        raise AIUnavailable("ANTHROPIC_API_KEY saknas")
    payload = {
        "model": model or ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{ANTHROPIC_API_URL}/messages", json=payload, headers=headers)
            if resp.status_code >= 400:
                raise AIUnavailable(f"HTTP {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
    except AIUnavailable:
        raise
    except Exception as e:
        raise AIUnavailable(str(e))
    for block in data.get("content", []):
        if block.get("type") == "text":
            return block.get("text", "") or ""
    return ""


async def claude_vision(prompt: str, images: list[tuple[str, str]], *, system: str = "",
                        model: Optional[str] = None, max_tokens: int = 8192,
                        timeout: float = 240) -> str:
    if not ANTHROPIC_API_KEY:
        raise AIUnavailable("ANTHROPIC_API_KEY saknas — kan inte använda Claude vision")
    content_blocks: list[dict] = []
    for image_b64, mime in images:
        content_blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime or "image/jpeg", "data": image_b64},
        })
    content_blocks.append({"type": "text", "text": prompt})
    payload = {
        "model": model or ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content_blocks}],
    }
    if system:
        payload["system"] = system
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{ANTHROPIC_API_URL}/messages", json=payload, headers=headers)
            if resp.status_code >= 400:
                raise AIUnavailable(f"HTTP {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
    except AIUnavailable:
        raise
    except Exception as e:
        raise AIUnavailable(str(e))
    for block in data.get("content", []):
        if block.get("type") == "text":
            return block.get("text", "") or ""
    return ""


def safe_parse_json(text: str) -> Optional[dict]:
    """Robustly extract a JSON object from a possibly-chatty model response."""
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    return None
