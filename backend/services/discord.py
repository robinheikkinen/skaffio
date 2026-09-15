"""Discord webhook notifier för security/admin events.

Aktiveras genom att sätta DISCORD_WEBHOOK_URL i .env. Lämna tom = inaktiverad
(appen fungerar lika bra utan). Fail-soft — alla fel sväljs så app aldrig
kraschar pga Discord-trubbel.

Webhook URL skapas i Discord:
  Server Settings → Integrations → Webhooks → New Webhook → kopiera URL
"""

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("skaffio.discord")

WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "").strip()

# Emoji-prefix per kategori — gör Discord-flödet skannbart
LEVELS = {
    "info":     "ℹ️",
    "success":  "✅",
    "warning":  "⚠️",
    "error":    "🚨",
    "security": "🔒",
}


async def notify(
    message: str,
    *,
    level: str = "info",
    username: str = "Skaffio",
    embed_title: Optional[str] = None,
    embed_fields: Optional[list[dict]] = None,
) -> bool:
    """Skicka ett meddelande till Discord-kanalen.

    Returnerar True om levererat. Aldrig raise — fail-soft.
    """
    if not WEBHOOK_URL:
        return False

    emoji = LEVELS.get(level, "")
    payload: dict = {
        "username": username,
        "content": f"{emoji} {message}" if not embed_title else None,
    }

    # Embed för rikare meddelanden (security events, deploys)
    if embed_title:
        color_map = {
            "info":     0x3498db,
            "success":  0x2ecc71,
            "warning":  0xe67e22,
            "error":    0xe74c3c,
            "security": 0x9b59b6,
        }
        payload["embeds"] = [{
            "title": f"{emoji} {embed_title}",
            "description": message,
            "color": color_map.get(level, 0x7289da),
            "fields": embed_fields or [],
        }]
        payload["content"] = None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(WEBHOOK_URL, json=payload)
            return 200 <= resp.status_code < 300
    except Exception as e:
        logger.warning("Discord notify failed: %s", e)
        return False


def is_configured() -> bool:
    return bool(WEBHOOK_URL)
