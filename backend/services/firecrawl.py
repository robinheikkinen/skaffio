"""Firecrawl integration — konverterar URL till Markdown för AI-parsning.

Konfiguration: FIRECRAWL_URL i .env, t.ex. http://firecrawl:3002
Om inte konfigurerat returnerar scrape_url() None och anroparen faller tillbaka
till befintlig BeautifulSoup-skrapning.

Docker-nätverk: Om Firecrawl körs som separat container på Unraid, ange
container-namn eller host-IP istället för localhost.
"""

import logging
import os
import re

import httpx

logger = logging.getLogger("skaffio.firecrawl")

FIRECRAWL_URL = os.getenv("FIRECRAWL_URL", "").rstrip("/")


def is_configured() -> bool:
    return bool(FIRECRAWL_URL)


async def scrape_url(url: str) -> dict | None:
    """Skrapa URL via Firecrawl och returnera {markdown, metadata, images}.

    Returnerar None om Firecrawl inte är konfigurerat eller om anropet misslyckas.
    """
    if not FIRECRAWL_URL:
        return None

    payload = {"url": url, "formats": ["markdown"]}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{FIRECRAWL_URL}/v1/scrape", json=payload)
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success"):
                logger.warning("Firecrawl: success=false for %s", url)
                return None
            return data.get("data") or {}
    except Exception as e:
        logger.warning("Firecrawl failed for %s: %s", url, e)
        return None


async def scrape_links(url: str, wait_ms: int = 5000) -> list[str]:
    """Hämta alla länkar från en sida via Firecrawl med waitFor för lazy loading.

    Returnerar tom lista om Firecrawl inte är konfigurerat eller anropet misslyckas.
    """
    if not FIRECRAWL_URL:
        return []

    payload = {"url": url, "formats": ["links"], "waitFor": wait_ms}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{FIRECRAWL_URL}/v1/scrape", json=payload)
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success"):
                logger.warning("Firecrawl links: success=false for %s", url)
                return []
            return (data.get("data") or {}).get("links") or []
    except Exception as e:
        logger.warning("Firecrawl links failed for %s: %s", url, e)
        return []


def extract_image_urls(markdown: str) -> list[str]:
    """Plocka ut alla bild-URL:er ur Markdown (![alt](url))."""
    return re.findall(r"!\[[^\]]*\]\(([^)]+)\)", markdown or "")


def pick_best_image(markdown: str, metadata: dict | None = None) -> str | None:
    """Välj bästa bilden: og:image från metadata, annars första Markdown-bilden."""
    og = (metadata or {}).get("ogImage") or (metadata or {}).get("og:image") or ""
    if og:
        return og.strip()
    images = extract_image_urls(markdown)
    return images[0] if images else None
