"""Cloudflare Access integration — auto-login via Google SSO vid edge.

Säkerhetsmodell:
- Om CF_ACCESS_TEAM + CF_ACCESS_AUD är satta: verifiera Cf-Access-Jwt-Assertion
  mot Cloudflares publika nycklar (JWKS). Säkert mot header-spoofing.
- Om INTE satta: lita på Cf-Access-Authenticated-User-Email direkt (legacy).
  OK när port 8007 är bunden till 127.0.0.1 och endast CF Tunnel når den.
"""

import logging
import os
import time
from typing import Optional

import httpx
import jwt
from fastapi import Request

logger = logging.getLogger("skaffio.cf_access")

CF_TRUST_HEADERS = os.getenv("CF_TRUST_HEADERS", "true").lower() == "true"
CF_ACCESS_TEAM   = os.getenv("CF_ACCESS_TEAM", "").strip()
CF_ACCESS_AUD    = os.getenv("CF_ACCESS_AUD", "").strip()

# JWKS-cache — hämtas från Cloudflare en gång per timme
_jwks_cache: dict = {"keys": [], "fetched_at": 0.0}
_JWKS_TTL = 3600  # sekunder


def _fetch_public_keys() -> list:
    """Hämtar + cachar Cloudflares publika RSA-nycklar."""
    now = time.time()
    if _jwks_cache["keys"] and now - _jwks_cache["fetched_at"] < _JWKS_TTL:
        return _jwks_cache["keys"]
    try:
        url = f"https://{CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs"
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        from jwt.algorithms import RSAAlgorithm
        keys = [RSAAlgorithm.from_jwk(k) for k in resp.json().get("keys", [])]
        _jwks_cache["keys"] = keys
        _jwks_cache["fetched_at"] = now
        logger.info("CF Access: hämtade %d publika nycklar", len(keys))
        return keys
    except Exception as e:
        logger.error("CF Access: kunde inte hämta JWKS: %s", e)
        return _jwks_cache["keys"]  # Använd gamla nycklar om fetch felar


def _verify_jwt(token: str) -> Optional[str]:
    """Verifiera CF Access JWT. Returnerar email om giltig, annars None."""
    keys = _fetch_public_keys()
    if not keys:
        return None
    for key in keys:
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=CF_ACCESS_AUD,
            )
            email = payload.get("email", "").strip().lower()
            return email if "@" in email else None
        except jwt.InvalidTokenError:
            continue
    return None


def extract_email(request: Request) -> Optional[str]:
    """Returnerar verifierad email från CF Access, eller None."""
    if not CF_TRUST_HEADERS:
        return None

    # JWT-verifiering (säkert) om team + aud är konfigurerade
    if CF_ACCESS_TEAM and CF_ACCESS_AUD:
        # Hämta JWT från header (non-bypassed paths) ELLER CF_Authorization-cookie
        # (bypassed paths som api* får inte header-injection men cookien skickas alltid)
        jwt_assertion = (
            request.headers.get("cf-access-jwt-assertion", "")
            or request.cookies.get("CF_Authorization", "")
        )
        logger.info("CF Access: JWT %s", "finns" if jwt_assertion else "SAKNAS (varken header eller cookie)")
        if jwt_assertion:
            email = _verify_jwt(jwt_assertion)
            if email:
                logger.info("CF Access JWT verifierad: %s", email)
                return email
            logger.warning("CF Access JWT-verifiering misslyckades (fel token/aud/keys)")
            return None
        logger.info("CF Access: ingen JWT — ej via CF Tunnel")
        return None

    # Fallback: lita på email-header direkt (OK med 127.0.0.1-bindning)
    email = request.headers.get("cf-access-authenticated-user-email", "").strip().lower()
    return email if "@" in email else None


def is_via_cloudflare(request: Request) -> bool:
    """True om denna request kommer via Cloudflare Tunnel + Access."""
    return bool(
        request.headers.get("cf-access-authenticated-user-email")
        or request.headers.get("cf-access-jwt-assertion")
    )
