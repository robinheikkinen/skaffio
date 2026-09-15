"""Lightweight audit logging — call from routes to track who did what."""

import json
import logging
from typing import Optional

from sqlmodel import Session

from models import AuditLog, User

logger = logging.getLogger("skaffio.audit")


def log_audit(
    session: Session,
    user: Optional[User],
    action: str,
    *,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    details: Optional[dict] = None,
    commit: bool = True,
) -> None:
    """Append an audit entry. Fail-soft: never raises into the route handler."""
    try:
        entry = AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=json.dumps(details, ensure_ascii=False) if details else None,
        )
        session.add(entry)
        if commit:
            session.commit()
    except Exception as e:
        logger.warning("audit-log misslyckades (%s): %s", action, e)
        try:
            session.rollback()
        except Exception:
            pass
