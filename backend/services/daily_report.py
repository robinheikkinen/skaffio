"""Daglig morgon-rapport till Discord kl 08:00 lokal tid.

Samlar:
- Backup-status (senaste fil, storlek, integrity)
- Disk-utrymme på /data
- Antal users + senast aktiva
- Audit-events senaste 24h (logins, errors)
- AI-modell + status

Skickas en gång per dag. Schemaläggs via asyncio från lifespan.
"""

import asyncio
import logging
import os
import shutil
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from database import engine
from models import AuditLog, Recipe, User
from services.backup import _verify_backup, BACKUP_DIR
from services.discord import notify as discord_notify

logger = logging.getLogger("skaffio.daily_report")

# Lokal tid (Sverige UTC+1/+2). Tar UTC+2 som approx — exakt sommartid-hantering
# är overkill för en daglig rapport.
REPORT_HOUR_LOCAL = 8  # 08:00
LOCAL_TZ_OFFSET = 2    # CEST


def _next_report_time() -> datetime:
    """Returnera UTC-tid för nästa kl 08:00 lokalt."""
    now = datetime.now(timezone.utc)
    target_utc_hour = (REPORT_HOUR_LOCAL - LOCAL_TZ_OFFSET) % 24
    next_run = now.replace(hour=target_utc_hour, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return next_run


def _disk_usage_pct(path: str = "/data") -> int:
    try:
        usage = shutil.disk_usage(path)
        return int(100 * usage.used / usage.total)
    except Exception:
        return 0


def _gather_report() -> dict:
    """Samla all data — körs i tråd så DB-anrop blockar inte event-loop."""
    # Backup-status
    latest_backup = None
    backup_status = "✗ Ingen backup hittad"
    backup_size_kb = 0
    if BACKUP_DIR.exists():
        backups = sorted(BACKUP_DIR.glob("backup-*.sqlite"), reverse=True)
        if backups:
            latest_backup = backups[0]
            ok, detail = _verify_backup(latest_backup)
            backup_size_kb = latest_backup.stat().st_size // 1024
            mtime = datetime.utcfromtimestamp(latest_backup.stat().st_mtime)
            age_h = int((datetime.now(timezone.utc) - mtime).total_seconds() / 3600)
            backup_status = (
                f"✓ {latest_backup.name} ({backup_size_kb} KB, {age_h}h gammal)"
                if ok else f"✗ KORRUPT: {latest_backup.name} — {detail}"
            )

    # DB-stats
    with Session(engine) as s:
        total_users = len(s.exec(select(User)).all())
        active_users = len(s.exec(select(User).where(User.is_active == True)).all())  # noqa: E712
        total_recipes = len(s.exec(select(Recipe)).all())

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        recent_audit = s.exec(
            select(AuditLog).where(AuditLog.created_at >= cutoff)
        ).all()
        recent_logins = sum(1 for a in recent_audit if a.action and "login" in a.action)
        recent_lockouts = sum(1 for a in recent_audit if a.action == "user.lockout")

    disk_pct = _disk_usage_pct("/data")

    # Aktiva AI-providers (de som har nyckel i .env) + senast använd motor.
    try:
        from services.ai import PROVIDERS, last_provider
        active = [name for name, p in PROVIDERS.items() if p.get("key") and p.get("url")]
        ai_providers = ", ".join(active) if active else "ingen konfigurerad"
        ai_last = last_provider() or "—"
    except Exception:
        ai_providers, ai_last = "okänd", "—"

    return {
        "backup_status": backup_status,
        "backup_ok": "✓" in backup_status,
        "disk_pct": disk_pct,
        "total_users": total_users,
        "active_users": active_users,
        "total_recipes": total_recipes,
        "recent_logins_24h": recent_logins,
        "recent_lockouts_24h": recent_lockouts,
        "ai_providers": ai_providers,
        "ai_last": ai_last,
    }


async def send_daily_report():
    """Bygg och skicka dagsrapporten."""
    try:
        data = await asyncio.to_thread(_gather_report)
    except Exception as e:
        logger.error("Daily report gather fel: %s", e)
        return

    # Sammanställ nivå
    level = "success"
    if not data["backup_ok"] or data["disk_pct"] > 85:
        level = "warning"
    if data["disk_pct"] > 95 or data["recent_lockouts_24h"] > 0:
        level = "warning"

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await discord_notify(
        f"Morgonrapport för {today}",
        level=level,
        embed_title=f"☀️ Daglig säkerhetsrapport — {today}",
        embed_fields=[
            {"name": "Backup", "value": data["backup_status"], "inline": False},
            {"name": "Disk /data", "value": f"{data['disk_pct']}% använt", "inline": True},
            {"name": "Användare", "value": f"{data['active_users']}/{data['total_users']} aktiva", "inline": True},
            {"name": "Recept", "value": str(data["total_recipes"]), "inline": True},
            {"name": "Loginer 24h", "value": str(data["recent_logins_24h"]), "inline": True},
            {"name": "Lockouts 24h", "value": str(data["recent_lockouts_24h"]), "inline": True},
            {"name": "AI-providers", "value": data["ai_providers"], "inline": True},
            {"name": "Senast använd AI", "value": data["ai_last"], "inline": True},
        ],
    )
    logger.info("Daglig rapport skickad")


async def daily_report_loop():
    """Async loop som skickar rapport kl 08:00 lokal tid varje dag."""
    while True:
        try:
            next_run = _next_report_time()
            sleep_seconds = (next_run - datetime.now(timezone.utc)).total_seconds()
            sleep_seconds = max(60, sleep_seconds)  # minst 1 min
            logger.info("Daily report sleep %d sec (next: %s UTC)", int(sleep_seconds), next_run)
            await asyncio.sleep(sleep_seconds)
            await send_daily_report()
            # Tilläggs-sleep så vi inte trippelfirar om send tar < 1 sek
            await asyncio.sleep(60)
        except Exception as e:
            logger.error("daily_report_loop fel: %s", e)
            await asyncio.sleep(3600)  # retry om 1h
