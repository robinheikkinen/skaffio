"""Daglig automatisk SQLite-backup.

Körs som async task från FastAPI:s lifespan. Använder SQLite:s online-backup
API (sqlite3.Connection.backup) som är atomisk och säker att köra medan
appen aktivt skriver — ingen lock-tid.

Lagrar backups i /data/backups/backup-YYYY-MM-DD.sqlite, behåller 30 dagar.
"""

import asyncio
import logging
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

logger = logging.getLogger("skaffio.backup")

BACKUP_DIR = Path("/data/backups")
DB_PATH = Path("/data/db.sqlite")
KEEP_DAYS = 30
INTERVAL_HOURS = 24


def _do_backup() -> Path | None:
    """Synchron SQLite backup. Returns path on success, None on failure."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        logger.warning("backup: db.sqlite saknas — hoppar över")
        return None

    dest = BACKUP_DIR / f"backup-{datetime.now(timezone.utc):%Y-%m-%d}.sqlite"
    try:
        src = sqlite3.connect(str(DB_PATH))
        dst = sqlite3.connect(str(dest))
        with dst:
            src.backup(dst)
        dst.close()
        src.close()
        size_kb = dest.stat().st_size // 1024
        logger.info("backup: %s (%d KB) skapad", dest.name, size_kb)
        return dest
    except Exception as e:
        logger.error("backup misslyckades: %s", e)
        return None


def _verify_backup(path: Path) -> tuple[bool, str]:
    """Öppnar backup-filen och kör PRAGMA integrity_check.
    Returns (ok: bool, detail: str)."""
    if not path or not path.exists():
        return False, "Filen saknas"
    try:
        conn = sqlite3.connect(str(path))
        cur = conn.cursor()
        cur.execute("PRAGMA integrity_check")
        result = cur.fetchone()
        # Verifiera även att vi kan läsa data
        cur.execute("SELECT COUNT(*) FROM sqlite_master")
        table_count = cur.fetchone()[0]
        conn.close()
        if result and result[0] == "ok":
            return True, f"{table_count} tabeller, integrity OK"
        return False, f"integrity_check: {result[0] if result else 'inget svar'}"
    except Exception as e:
        return False, f"Kunde inte öppna: {e}"


def _cleanup_old():
    """Ta bort backups äldre än KEEP_DAYS."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    for path in BACKUP_DIR.glob("backup-*.sqlite"):
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                path.unlink()
                logger.info("backup: tog bort gammal %s", path.name)
        except Exception as e:
            logger.warning("backup cleanup misslyckades för %s: %s", path.name, e)


async def backup_loop():
    """Async loop som tar + verifierar backup varje 24h. Körs från lifespan.
    Skickar Discord-alert om backup failar eller är korrupt."""
    from services.discord import notify
    await asyncio.sleep(60)  # vänta så uvicorn hinner starta klart
    while True:
        try:
            dest = _do_backup()
            _cleanup_old()
            # Verifiera + alert
            if dest:
                ok, detail = _verify_backup(dest)
                size_kb = dest.stat().st_size // 1024 if dest.exists() else 0
                if not ok:
                    await notify(
                        f"⚠️ Backup KORRUPT: `{dest.name}` — {detail}",
                        level="error",
                        embed_title="Backup-verifiering misslyckades",
                        embed_fields=[
                            {"name": "Fil", "value": dest.name, "inline": True},
                            {"name": "Storlek", "value": f"{size_kb} KB", "inline": True},
                            {"name": "Detalj", "value": detail, "inline": False},
                        ],
                    )
                    logger.error("backup verifiering FAILED: %s", detail)
                else:
                    logger.info("backup verifierad OK: %s (%s)", dest.name, detail)
            else:
                await notify(
                    "⚠️ Backup-jobbet misslyckades — ingen fil skapad",
                    level="error",
                    embed_title="Backup misslyckades",
                )
        except Exception as e:
            logger.error("backup_loop fel: %s", e)
            try:
                await notify(f"⚠️ Backup-loop kraschade: {e}", level="error")
            except Exception:
                pass
        await asyncio.sleep(INTERVAL_HOURS * 3600)


def list_backups() -> list[dict]:
    """Returnera info om alla backups (för admin-UI)."""
    if not BACKUP_DIR.exists():
        return []
    items = []
    for path in sorted(BACKUP_DIR.glob("backup-*.sqlite"), reverse=True):
        try:
            stat = path.stat()
            items.append({
                "name": path.name,
                "size_kb": stat.st_size // 1024,
                "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
        except Exception:
            continue
    return items
