"""Auth routes — register, login, me, audit log, user admin, TOTP 2FA."""

import asyncio
import base64
import io
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import (
    AuditLog, Collection, Favorite, FreezerPortion, Household, InboxRecipe,
    Invite, MealPlanEntry, PantryItem, Recipe, RecipeCollection, RecipeImage,
    ShoppingList, User,
)
from services.audit import log_audit
from services.auth import (
    ALLOW_REGISTRATION, count_users, create_token, clear_auth_cookie,
    get_current_user, hash_password, require_admin, set_auth_cookie, verify_password,
)
from services.cf_access import extract_email as cf_extract_email
from services.discord import notify as discord_notify
from services.login_tracking import track_login
from services.ratelimit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])

# Account lockout efter N failed login attempts
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION = timedelta(minutes=15)


def _create_household(session: Session, name: str = "Familjen") -> Household:
    """Skapar ett nytt hushåll med unik inbjudningskod och returnerar det (flush men ej commit)."""
    h = Household(name=name, invite_code=_secrets.token_urlsafe(8))
    session.add(h)
    session.flush()
    return h


# ─── Schemas ────────────────────────────────────────────────────────

class RegisterIn(BaseModel):
    email: str
    name: str
    password: str


class LoginIn(BaseModel):
    """Behållen för bakåt-kompat — använd LoginIn2 för 2FA-stöd."""
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None
    totp_enabled: bool = False


def _serialize_user(u: User) -> UserOut:
    return UserOut(
        id=u.id, email=u.email, name=u.name, role=u.role,
        is_active=u.is_active, created_at=u.created_at, last_login_at=u.last_login_at,
        totp_enabled=bool(u.totp_enabled),
    )


# ─── Public status (used by frontend to pick login vs register view) ─

@router.get("/status")
def auth_status(session: Session = Depends(get_session)):
    return {
        "has_users": count_users(session) > 0,
        "allow_registration": ALLOW_REGISTRATION,
    }


# ─── Register ───────────────────────────────────────────────────────

@router.post("/register")
@limiter.limit("5/hour")
async def register(request: Request, response: Response, data: RegisterIn, session: Session = Depends(get_session)):
    has_users = count_users(session) > 0
    # First user is always allowed and becomes admin; rest gated by ALLOW_REGISTRATION
    if has_users and not ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registrering är avstängd. Be admin skapa kontot.")

    if len(data.password) < 12:
        raise HTTPException(status_code=400, detail="Lösenord måste vara minst 12 tecken")

    existing = session.exec(select(User).where(User.email == data.email.lower())).first()
    if existing:
        raise HTTPException(status_code=400, detail="E-postadressen är redan registrerad")

    household = _create_household(session)
    user = User(
        email=data.email.lower(),
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        role="admin" if not has_users else "member",
        household_id=household.id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    log_audit(session, user, "user.register", entity_type="user", entity_id=user.id,
              details={"role": user.role, "bootstrap": not has_users})

    # Notifiera admin/Discord vid ny registrering (bootstrap är OK, övriga = alert)
    if has_users:
        asyncio.create_task(discord_notify(
            f"Nytt konto registrerat: **{user.email}** ({user.name})",
            level="security",
            embed_title="Ny registrering",
            embed_fields=[
                {"name": "Roll", "value": user.role, "inline": True},
                {"name": "IP", "value": request.client.host if request.client else "?", "inline": True},
            ],
        ))

    token = create_token(user.id)
    set_auth_cookie(response, token)
    return {"token": token, "user": _serialize_user(user)}


# ─── Login ──────────────────────────────────────────────────────────

class LoginIn2(BaseModel):
    email: str
    password: str
    totp_code: Optional[str] = None    # 6-siffrig kod om 2FA aktiverat


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, response: Response, data: LoginIn2, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == data.email.lower())).first()

    # 1. Account lockout-koll
    # locked_until läses tillbaka utan tzinfo från SQLite (naive) — måste normaliseras
    # innan jämförelse mot en tz-aware "now", annars TypeError.
    locked_until = user.locked_until if user else None
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if user and locked_until and locked_until > datetime.now(timezone.utc):
        mins = int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
        raise HTTPException(status_code=423,
            detail=f"Kontot är låst i {mins} min pga upprepade felaktiga inloggningar")

    # 2. Verifiera credentials
    if not user or not verify_password(data.password, user.password_hash):
        if user:
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            if user.failed_login_attempts >= LOCKOUT_THRESHOLD:
                user.locked_until = datetime.now(timezone.utc) + LOCKOUT_DURATION
                session.commit()
                # Discord-alert vid lockout
                asyncio.create_task(discord_notify(
                    f"Konto låst: **{user.email}** ({user.failed_login_attempts} failed) — låst i 15 min",
                    level="security",
                    embed_title="Account lockout",
                    embed_fields=[
                        {"name": "IP", "value": request.client.host if request.client else "?", "inline": True},
                        {"name": "User", "value": user.email, "inline": True},
                    ],
                ))
            else:
                session.commit()
        raise HTTPException(status_code=401, detail="Fel e-post eller lösenord")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Kontot är inaktiverat")

    # 3. TOTP-koll om 2FA aktiverat
    if user.totp_enabled and user.totp_secret:
        if not data.totp_code:
            raise HTTPException(status_code=401, detail="2FA-kod krävs", headers={"X-Auth-Step": "totp-required"})
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(data.totp_code, valid_window=1):
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            session.commit()
            raise HTTPException(status_code=401, detail="Ogiltig 2FA-kod")

    # 4. Lyckad login — nollställ lockout-räknaren
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = datetime.now(timezone.utc)
    session.commit()

    log_audit(session, user, "user.login", entity_type="user", entity_id=user.id)
    asyncio.create_task(track_login(request, user, session, via="password"))
    token = create_token(user.id)
    set_auth_cookie(response, token)
    return {"token": token, "user": _serialize_user(user)}


# ─── Cloudflare Access auto-login (Google SSO) ──────────────────────

@router.post("/cf-login")
async def cf_login(request: Request, response: Response, session: Session = Depends(get_session)):
    """Auto-login via CF Access. Klienten anropar denna vid sidladdning —
    om CF-headers finns och email är aktiv → returnera token utan lösenord.

    Säkerhetsmodell:
    - CF Access har redan gate:at användaren mot Google SSO + allow-list
    - Vi litar på Cf-Access-Authenticated-User-Email-headern
    - Direktåtkomst LAN bypassar detta (då används vanlig login)
    """
    email = cf_extract_email(request)
    if not email:
        # Inte via CF — låt klienten falla tillbaka till vanlig login
        raise HTTPException(status_code=401, detail="Ingen CF Access-identitet")

    user = session.exec(select(User).where(User.email == email)).first()

    # Auto-skapa user om CF Access släppte igenom + email finns i invite-listan
    # (eller om det är förste användaren — bootstrap)
    if not user:
        has_users = count_users(session) > 0
        invite = None
        if has_users:
            # Måste finnas giltig invite (oanvänd)
            invite = session.exec(
                select(Invite).where(Invite.email == email).where(Invite.used_at == None)  # noqa: E711
            ).first()
            if not invite:
                raise HTTPException(
                    status_code=403,
                    detail=f"Inte inbjuden. Be admin lägga till {email} i invite-listan.",
                )

        role = "admin" if not has_users else (invite.role if invite else "member")
        household = _create_household(session)
        user = User(
            email=email,
            name=email.split("@")[0].replace(".", " ").title(),
            password_hash="",  # ingen lokal password — bara CF-auth
            role=role,
            household_id=household.id,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        # Markera invite som använd
        if invite:
            invite.used_at = datetime.now(timezone.utc)
            invite.used_by_user_id = user.id
            session.commit()

        log_audit(session, user, "user.cf_autocreate",
                  entity_type="user", entity_id=user.id,
                  details={"email": email, "via": "cf-access", "invite_used": bool(invite)})
        asyncio.create_task(discord_notify(
            f"Nytt CF-Access-konto auto-skapat: **{user.email}** ({user.role})",
            level="security", embed_title="Ny användare via Google SSO",
        ))

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Kontot är inaktiverat")

    # Nollställ lockout (CF gav grönt ljus)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = datetime.now(timezone.utc)
    session.commit()

    log_audit(session, user, "user.cf_login", entity_type="user", entity_id=user.id)
    asyncio.create_task(track_login(request, user, session, via="cf-access"))
    token = create_token(user.id)
    set_auth_cookie(response, token)
    return {"token": token, "user": _serialize_user(user), "via": "cf-access"}


# ─── TOTP 2FA ───────────────────────────────────────────────────────

@router.post("/totp/setup")
def totp_setup(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Generera nytt TOTP-secret + QR-kod för Authenticator-app.
    Hemligheten sparas provisoriskt i totp_secret_pending tills /totp/enable verifierar den.
    Ingen risk för fastlåst konfig om setup avbryts — pending-fältet skrivs inte på totp_secret."""
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA är redan aktiverat")
    secret = pyotp.random_base32()
    # Spara provisoriskt — aktiveras inte förrän /totp/enable bekräftar med rätt kod
    user.totp_secret_pending = secret
    session.commit()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Skaffio")
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "secret": secret,
        "uri": uri,
        "qr_png_base64": qr_b64,
    }


class TotpCode(BaseModel):
    code: str


@router.post("/totp/enable")
def totp_enable(data: TotpCode, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Aktivera 2FA: verifiera koden mot pending-hemligheten, flytta sedan till totp_secret."""
    pending = user.totp_secret_pending
    if not pending:
        raise HTTPException(status_code=400, detail="Kör /totp/setup först")
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="Redan aktiverat")
    totp = pyotp.TOTP(pending)
    if not totp.verify(data.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Fel kod — försök igen")
    # Verifierat — aktivera
    user.totp_secret = pending
    user.totp_secret_pending = None
    user.totp_enabled = True
    session.commit()
    log_audit(session, user, "user.totp_enable", entity_type="user", entity_id=user.id)
    return {"ok": True}


@router.post("/totp/disable")
def totp_disable(data: TotpCode, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Stäng av 2FA. Kräver att man bekräftar med en TOTP-kod (så ingen annan kan göra det)."""
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA är inte aktiverat")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(data.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Fel kod")
    user.totp_enabled = False
    user.totp_secret = None
    session.commit()
    log_audit(session, user, "user.totp_disable", entity_type="user", entity_id=user.id)
    return {"ok": True}


# ─── Logout ─────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(response: Response):
    """Rensar HttpOnly auth-cookie. Kräver ingen inloggning (cookie kan vara utgången)."""
    clear_auth_cookie(response)
    return {"ok": True}


# ─── Me ─────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _serialize_user(user)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/password")
@limiter.limit("5/hour")
async def change_own_password(
    request: Request,
    data: ChangePasswordIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Self-service lösenordsbyte — kräver nuvarande lösenord som bekräftelse."""
    # 400 (inte 401) — 401 tolkas av frontend som utgången session och loggar ut användaren.
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Fel nuvarande lösenord")
    if len(data.new_password) < 12:
        raise HTTPException(status_code=400, detail="Nytt lösenord måste vara minst 12 tecken")
    user.password_hash = hash_password(data.new_password)
    session.commit()
    log_audit(session, user, "user.password_change", entity_type="user", entity_id=user.id)
    return {"ok": True}


@router.get("/me/export")
def export_my_data(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GDPR: Export all data associated with this account as a JSON file."""
    import json
    from fastapi.responses import Response as _Response

    hh_id = user.household_id

    def _recipe(r):
        return {
            "id": r.id, "title": r.title, "description": r.description,
            "ingredients": r.ingredients, "instructions": r.instructions,
            "servings": r.servings, "visibility": r.visibility,
            "prep_time": r.prep_time, "cook_time": r.cook_time,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }

    recipes = session.exec(
        select(Recipe).where(Recipe.household_id == hh_id)
    ).all() if hh_id else []

    pantry = session.exec(
        select(PantryItem).where(PantryItem.household_id == hh_id)
    ).all() if hh_id else []

    shopping = session.exec(
        select(ShoppingList).where(ShoppingList.household_id == hh_id)
    ).all() if hh_id else []

    mealplan = session.exec(
        select(MealPlanEntry).where(MealPlanEntry.household_id == hh_id)
    ).all() if hh_id else []

    collections = session.exec(
        select(Collection).where(Collection.household_id == hh_id)
    ).all() if hh_id else []

    freezer = session.exec(
        select(FreezerPortion).where(FreezerPortion.household_id == hh_id)
    ).all() if hh_id else []

    inbox = session.exec(
        select(InboxRecipe).where(InboxRecipe.household_id == hh_id)
    ).all() if hh_id else []

    favorites = session.exec(
        select(Favorite).where(Favorite.user_id == user.id)
    ).all()

    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "recipes": [_recipe(r) for r in recipes],
        "pantry": [
            {"name": p.name, "amount": p.amount, "unit": p.unit,
             "location": p.location, "expiry_date": str(p.expiry_date) if p.expiry_date else None}
            for p in pantry
        ],
        "shopping_lists": [
            {"name": s.name, "items": s.items} for s in shopping
        ],
        "meal_plan": [
            {"recipe_id": e.recipe_id, "date": str(e.date), "meal_type": e.meal_type,
             "servings": e.servings, "notes": e.notes}
            for e in mealplan
        ],
        "collections": [
            {"name": c.name, "description": c.description, "icon": c.icon}
            for c in collections
        ],
        "freezer": [
            {"label": f.label, "portions": f.portions, "location": f.location,
             "portion_type": f.portion_type, "notes": f.notes}
            for f in freezer
        ],
        "inbox": [
            {"url": i.url, "title": i.title, "status": i.status}
            for i in inbox
        ],
        "favorite_recipe_ids": [f.recipe_id for f in favorites],
    }

    log_audit(session, user, "user.export_data", entity_type="user", entity_id=user.id)
    session.commit()

    payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    safe_email = user.email.replace("@", "_at_").replace(".", "_")
    return _Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="skaffio-export-{safe_email}.json"'},
    )


@router.delete("/me")
def delete_own_account(
    response: Response,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GDPR: Permanently delete own account and all associated data."""
    import os

    hh_id = user.household_id

    # Count active household members to decide if we delete the household too
    other_members = session.exec(
        select(User).where(User.household_id == hh_id, User.id != user.id)
    ).all() if hh_id else []

    if hh_id and not other_members:
        # Last member — wipe everything the household owns
        recipes = session.exec(select(Recipe).where(Recipe.household_id == hh_id)).all()
        for recipe in recipes:
            for img in session.exec(select(RecipeImage).where(RecipeImage.recipe_id == recipe.id)).all():
                for path in [f"/data/uploads/{img.filename}", f"/data/uploads/thumb_{img.filename}"]:
                    try:
                        os.remove(path)
                    except FileNotFoundError:
                        pass
                session.delete(img)
            for junc in session.exec(select(RecipeCollection).where(RecipeCollection.recipe_id == recipe.id)).all():
                session.delete(junc)
            session.delete(recipe)

        for model, field in [
            (PantryItem, PantryItem.household_id),
            (ShoppingList, ShoppingList.household_id),
            (MealPlanEntry, MealPlanEntry.household_id),
            (Collection, Collection.household_id),
            (FreezerPortion, FreezerPortion.household_id),
            (InboxRecipe, InboxRecipe.household_id),
        ]:
            for obj in session.exec(select(model).where(field == hh_id)).all():
                session.delete(obj)

        household = session.get(Household, hh_id)
        if household:
            session.delete(household)
    else:
        # Shared household — keep household data, just nullify personal references
        for item in session.exec(select(PantryItem).where(PantryItem.added_by_user_id == user.id)).all():
            item.added_by_user_id = None

    # Always: delete personal data
    for fav in session.exec(select(Favorite).where(Favorite.user_id == user.id)).all():
        session.delete(fav)

    # Anonymize audit entries (preserve history, remove identity)
    for entry in session.exec(select(AuditLog).where(AuditLog.user_id == user.id)).all():
        entry.user_id = None

    log_audit(session, user, "user.self_delete", entity_type="user", entity_id=user.id)
    session.delete(user)
    session.commit()

    clear_auth_cookie(response)
    return {"ok": True, "message": "Konto och all data raderad"}


# ─── Invites (admin only) ───────────────────────────────────────────

class InviteIn(BaseModel):
    email: str
    role: str = "member"
    note: Optional[str] = None


@router.get("/invites")
def list_invites(admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    invites = session.exec(select(Invite).order_by(Invite.created_at.desc())).all()
    return [
        {
            "id": i.id,
            "email": i.email,
            "role": i.role,
            "note": i.note,
            "used": i.used_at is not None,
            "used_at": i.used_at,
            "created_at": i.created_at,
        }
        for i in invites
    ]


@router.post("/invites")
async def create_invite(
    data: InviteIn,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    email = data.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Ogiltig email")

    # Hoppa om user redan finns
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=400, detail="Användaren finns redan")

    # Hoppa om invite redan finns (oanvänd)
    existing = session.exec(
        select(Invite).where(Invite.email == email).where(Invite.used_at == None)  # noqa: E711
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Invite finns redan för denna email")

    invite = Invite(
        email=email,
        role=data.role if data.role in ("admin", "member") else "member",
        note=(data.note or "").strip() or None,
        invited_by_user_id=admin.id,
    )
    session.add(invite)
    session.commit()
    session.refresh(invite)

    log_audit(session, admin, "user.invite_create",
              entity_type="invite", entity_id=invite.id,
              details={"email": email, "role": invite.role})

    asyncio.create_task(discord_notify(
        f"Invite skapad: **{email}** ({invite.role}) av {admin.email}\n"
        f"⚠️ Kom ihåg att lägga till email i Cloudflare Access allow-list!",
        level="info",
        embed_title="Ny invite",
    ))

    return {
        "id": invite.id,
        "email": invite.email,
        "role": invite.role,
        "note": invite.note,
        "created_at": invite.created_at,
    }


@router.delete("/invites/{invite_id}")
def revoke_invite(
    invite_id: int,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    invite = session.get(Invite, invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Hittades inte")
    if invite.used_at:
        raise HTTPException(status_code=400, detail="Invite är redan använd — radera kontot istället")
    session.delete(invite)
    session.commit()
    log_audit(session, admin, "user.invite_revoke",
              entity_type="invite", entity_id=invite_id,
              details={"email": invite.email})
    return {"ok": True}


# ─── User admin (admin only) ────────────────────────────────────────

class CreateUserIn(BaseModel):
    email: str
    name: str
    password: str
    role: str = "member"


@router.get("/users")
def list_users(_: User = Depends(require_admin), session: Session = Depends(get_session)):
    users = session.exec(select(User).order_by(User.created_at.desc())).all()
    return [_serialize_user(u) for u in users]


@router.post("/users")
def admin_create_user(
    data: CreateUserIn,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if session.exec(select(User).where(User.email == data.email.lower())).first():
        raise HTTPException(status_code=400, detail="E-postadressen finns redan")
    if data.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="Ogiltig roll")
    household = _create_household(session)
    user = User(
        email=data.email.lower(),
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        role=data.role,
        household_id=household.id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    log_audit(session, admin, "user.create", entity_type="user", entity_id=user.id,
              details={"created_by_admin": True, "role": user.role})
    return _serialize_user(user)


class UpdateUserIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@router.put("/users/{user_id}")
def admin_update_user(
    user_id: int,
    data: UpdateUserIn,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    if data.name is not None: target.name = data.name.strip()
    if data.role is not None and data.role in ("admin", "member"): target.role = data.role
    if data.is_active is not None: target.is_active = data.is_active
    if data.password:
        if len(data.password) < 12:
            raise HTTPException(status_code=400, detail="Lösenord måste vara minst 12 tecken")
        target.password_hash = hash_password(data.password)
    session.commit()
    log_audit(session, admin, "user.update", entity_type="user", entity_id=user_id,
              details=data.model_dump(exclude_none=True, exclude={"password"}))
    return _serialize_user(target)


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Du kan inte radera ditt eget konto")
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    session.delete(target)
    session.commit()
    log_audit(session, admin, "user.delete", entity_type="user", entity_id=user_id)
    return {"ok": True}


# ─── Backups (admin only) ───────────────────────────────────────────

@router.get("/backups")
def list_backups_endpoint(_: User = Depends(require_admin)):
    """Lista befintliga db-backups (skapas automatiskt varje dygn)."""
    from services.backup import list_backups
    return list_backups()


@router.post("/backups/run")
def trigger_backup(_: User = Depends(require_admin)):
    """Tvinga en backup nu (utöver det dagliga schemat)."""
    from services.backup import _do_backup
    result = _do_backup()
    if result is None:
        raise HTTPException(status_code=500, detail="Backup misslyckades")
    return {"ok": True, "file": result.name}


# ─── Audit log ──────────────────────────────────────────────────────

@router.get("/audit")
def audit_log(
    user: User = Depends(get_current_user),
    limit: int = Query(default=100, le=500),
    session: Session = Depends(get_session),
):
    """Members see their own activity; admins see everyone's."""
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if user.role != "admin":
        query = query.where(AuditLog.user_id == user.id)
    entries = session.exec(query).all()

    # Join user name for display
    user_lookup = {}
    ids = {e.user_id for e in entries if e.user_id}
    if ids:
        for u in session.exec(select(User).where(User.id.in_(ids))).all():
            user_lookup[u.id] = u.name

    return [
        {
            **e.model_dump(),
            "user_name": user_lookup.get(e.user_id),
        }
        for e in entries
    ]
