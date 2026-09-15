from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from database import get_session
from models import Tag, User
from services.audit import log_audit
from services.auth import get_current_user

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("")
def list_tags(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    return session.exec(select(Tag)).all()


@router.post("", response_model=Tag)
def create_tag(
    tag: Tag,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    existing = session.exec(select(Tag).where(Tag.name == tag.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")
    session.add(tag)
    session.commit()
    session.refresh(tag)
    log_audit(session, user, "tag.create", entity_type="tag", entity_id=tag.id,
              details={"name": tag.name})
    return tag


@router.put("/{tag_id}", response_model=Tag)
def update_tag(
    tag_id: int,
    tag_data: Tag,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag.name = tag_data.name
    tag.color = tag_data.color
    session.commit()
    session.refresh(tag)
    log_audit(session, user, "tag.update", entity_type="tag", entity_id=tag_id,
              details={"name": tag.name})
    return tag


@router.delete("/{tag_id}")
def delete_tag(
    tag_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    name = tag.name
    session.delete(tag)
    session.commit()
    log_audit(session, user, "tag.delete", entity_type="tag", entity_id=tag_id,
              details={"name": name})
    return {"ok": True}
