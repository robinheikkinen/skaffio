"""Authentication primitives — JWT + bcrypt, no third-party SSO.

Token flow:
  POST /api/auth/login → JWT signed with JWT_SECRET (HS256, 30-day exp).
  Frontend stores it in localStorage and sends as `Authorization: Bearer <jwt>`.

Bootstrap:
  First registered user is automatically promoted to role="admin".
  Subsequent registrations require ALLOW_REGISTRATION=true OR an admin-initiated
  /api/auth/users POST.
"""

import logging
import os
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlmodel import Session, select

from database import get_session
from models import User

# ─── Cookie-konfiguration ────────────────────────────────────────────────────
COOKIE_NAME = "skaffio_token"
# Sätt COOKIE_SECURE=true i .env om appen nås via HTTPS (CF Tunnel-produktion).
# False = fungerar lokalt på HTTP.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes")


def set_auth_cookie(response, token: str) -> None:
    """Sätt HttpOnly-sessionscookie — skyddar mot XSS-stöld."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=JWT_EXPIRE_DAYS * 24 * 3600,
        httponly=True,          # JS kan inte läsa cookien
        samesite="lax",         # Skyddar mot CSRF
        secure=COOKIE_SECURE,
        path="/",
    )


def clear_auth_cookie(response) -> None:
    """Ta bort auth-cookien vid logout."""
    response.delete_cookie(key=COOKIE_NAME, path="/")

logger = logging.getLogger("skaffio.auth")

JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 7  # CF Access auto-login gör re-auth osynlig — kort livstid begränsar stulna tokens

# JWT_SECRET handling: prefer env var, otherwise generate-and-persist
# a 32-byte secret in /data/.jwt-secret so tokens survive container restarts.
def _load_secret() -> str:
    env_secret = os.getenv("JWT_SECRET", "").strip()
    if env_secret:
        return env_secret
    path = Path("/data/.jwt-secret")
    if path.exists():
        return path.read_text().strip()
    new_secret = secrets.token_urlsafe(32)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new_secret)
        path.chmod(0o600)
        logger.warning("Genererade nytt JWT_SECRET i %s (sätt JWT_SECRET i .env för att kontrollera)", path)
    except Exception as e:
        logger.error("Kunde inte spara JWT_SECRET: %s", e)
    return new_secret

JWT_SECRET = _load_secret()
# Default false — admin måste explicit sätta ALLOW_REGISTRATION=true i .env vid bootstrap,
# sedan stänga av den igen för att förhindra oinbjudna registreringar.
ALLOW_REGISTRATION = os.getenv("ALLOW_REGISTRATION", "false").lower() in ("1", "true", "yes")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "exp": int((datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _decode(token: str) -> Optional[int]:
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    skaffio_token: Optional[str] = Cookie(default=None),
    session: Session = Depends(get_session),
) -> User:
    """Required-auth dependency — föredrar HttpOnly-cookie (XSS-säker) framför Bearer-header."""
    token = skaffio_token  # Cookie har prioritet
    if not token:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inloggning krävs")
        token = authorization.split(" ", 1)[1].strip()
    user_id = _decode(token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ogiltig token")
    user = session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Användaren existerar inte")
    return user


def get_optional_user(
    authorization: Optional[str] = Header(default=None),
    skaffio_token: Optional[str] = Cookie(default=None),
    session: Session = Depends(get_session),
) -> Optional[User]:
    """For audit logging on routes that have optional auth (e.g. shared endpoints)."""
    token = skaffio_token
    if not token:
        if not authorization or not authorization.lower().startswith("bearer "):
            return None
        token = authorization.split(" ", 1)[1].strip()
    user_id = _decode(token)
    if user_id is None:
        return None
    user = session.get(User, user_id)
    if not user or not user.is_active:
        return None
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin krävs")
    return user


def count_users(session: Session) -> int:
    return len(session.exec(select(User.id)).all())
