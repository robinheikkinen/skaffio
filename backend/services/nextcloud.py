"""Valfri Nextcloud WebDAV-integration — laddar upp receptbilder till Nextcloud.

Konfiguration i .env:
  NEXTCLOUD_WEBDAV_URL=https://nextcloud.example.com/remote.php/dav/files/USERNAME/Recipes/
  NEXTCLOUD_USER=username
  NEXTCLOUD_PASS=app-password

Om ej konfigurerat, returnerar upload() False och bilden sparas bara lokalt.
"""

import logging
import os

import httpx

logger = logging.getLogger("skaffio.nextcloud")

NEXTCLOUD_WEBDAV_URL = os.getenv("NEXTCLOUD_WEBDAV_URL", "").rstrip("/")
NEXTCLOUD_USER = os.getenv("NEXTCLOUD_USER", "")
NEXTCLOUD_PASS = os.getenv("NEXTCLOUD_PASS", "")


def is_configured() -> bool:
    return bool(NEXTCLOUD_WEBDAV_URL and NEXTCLOUD_USER and NEXTCLOUD_PASS)


async def upload_image(filename: str, data: bytes, content_type: str = "image/jpeg") -> bool:
    """Ladda upp bildfil till Nextcloud via WebDAV.

    Returnerar True vid lyckad uppladdning, False annars.
    """
    if not is_configured():
        return False

    dest_url = f"{NEXTCLOUD_WEBDAV_URL}/{filename}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.put(
                dest_url,
                content=data,
                auth=(NEXTCLOUD_USER, NEXTCLOUD_PASS),
                headers={"Content-Type": content_type},
            )
            if resp.status_code in (200, 201, 204):
                logger.info("Nextcloud: uploaded %s", filename)
                return True
            logger.warning("Nextcloud: upload failed %s → HTTP %d", filename, resp.status_code)
            return False
    except Exception as e:
        logger.warning("Nextcloud upload error for %s: %s", filename, e)
        return False
