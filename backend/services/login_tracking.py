"""IP-tracking för login-anomalier. Skickar Discord-notis om user
loggar in från en IP de aldrig använt tidigare."""

import json
import logging
from typing import Optional

from fastapi import Request
from sqlmodel import Session

from models import User
from services.discord import notify as discord_notify

logger = logging.getLogger("skaffio.login_tracking")

# Max IPs vi sparar per user — äldsta tas bort
MAX_KNOWN_IPS = 10


def _client_ip(request: Request) -> str:
    """Hämtar bästa-gissning IP från request, prefer CF/X-Forwarded-For
    om bakom Cloudflare/nginx."""
    for header in ("cf-connecting-ip", "x-real-ip", "x-forwarded-for"):
        val = request.headers.get(header, "")
        if val:
            # X-Forwarded-For kan vara komma-separerad — ta första
            return val.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


async def track_login(
    request: Request,
    user: User,
    session: Session,
    *,
    via: str = "password",
):
    """Registrera IP. Om ny — skicka Discord-alert."""
    ip = _client_ip(request)
    if ip == "unknown" or not ip:
        return

    try:
        known = json.loads(user.known_ips or "[]")
        if not isinstance(known, list):
            known = []
    except Exception:
        known = []

    is_new = ip not in known

    if is_new:
        # Lägg till + rotera (max 10)
        known.append(ip)
        if len(known) > MAX_KNOWN_IPS:
            known = known[-MAX_KNOWN_IPS:]
        user.known_ips = json.dumps(known)
        session.commit()

        # Bara alert om hen har loggat in tidigare (skip första gången)
        if len(known) > 1:
            await discord_notify(
                f"⚠️ Ny IP: **{user.email}** loggade in från `{ip}` (via {via})",
                level="security",
                embed_title="Login från okänd IP",
                embed_fields=[
                    {"name": "User", "value": user.email, "inline": True},
                    {"name": "IP", "value": ip, "inline": True},
                    {"name": "Via", "value": via, "inline": True},
                    {"name": "Kända IPs", "value": str(len(known)), "inline": True},
                ],
            )
            logger.info("Ny IP-login: user=%s ip=%s via=%s", user.email, ip, via)
