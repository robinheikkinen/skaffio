import logging
from sqlalchemy import event
from sqlmodel import SQLModel, create_engine, Session, text

logger = logging.getLogger("skaffio.db")

DATABASE_URL = "sqlite:////data/db.sqlite"

engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})


# SQLite-härdning för samtidiga skrivningar (FastAPI = flera requests parallellt):
#   WAL          — läsare blockerar inte skrivare och vice versa (persistent per DB-fil)
#   busy_timeout — vänta 5s på lås istället för att direkt kasta "database is locked"
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


# Lightweight migrations — SQLite supports ADD COLUMN but not DROP, and SQLModel's
# create_all() never touches existing tables. So we explicitly check + ALTER on startup.
MIGRATIONS = {
    "recipe": [
        ("calories",     "INTEGER"),
        ("protein",      "REAL"),
        ("carbs",        "REAL"),
        ("fat",          "REAL"),
        ("rating",         "INTEGER"),
        ("times_cooked",   "INTEGER DEFAULT 0"),
        ("last_cooked_at", "DATETIME"),
        ("share_token",    "VARCHAR"),
        ("notes",          "TEXT"),
        ("visibility",     "VARCHAR DEFAULT 'private'"),
        ("household_id",   "INTEGER"),
    ],
    "shoppinglist": [
        ("share_token", "VARCHAR"),
        ("household_id", "INTEGER"),
    ],
    "mealplanentry": [
        ("household_id", "INTEGER"),
    ],
    "collection": [
        ("household_id", "INTEGER"),
    ],
    "pantryitem": [
        ("is_staple", "BOOLEAN DEFAULT 0"),
        ("household_id", "INTEGER"),
    ],
    "freezerportion": [
        ("household_id", "INTEGER"),
    ],
    "inboxrecipe": [
        ("household_id", "INTEGER"),
    ],
    "user": [
        ("failed_login_attempts",  "INTEGER DEFAULT 0"),
        ("locked_until",           "DATETIME"),
        ("totp_secret",            "VARCHAR"),
        ("totp_secret_pending",    "VARCHAR"),
        ("totp_enabled",           "BOOLEAN DEFAULT 0"),
        ("known_ips",              "TEXT"),
        ("ical_token",             "VARCHAR"),
        ("household_id",           "INTEGER"),
    ],
    "household": [
        ("school_menu_url",     "TEXT"),
        ("school_display_name", "TEXT"),
    ],
}


def _migrate_schema():
    """Fail-loud: en misslyckad ALTER stoppar appstarten hellre än att appen
    kör vidare mot ett schema den tror att den har."""
    with engine.connect() as conn:
        for table, cols in MIGRATIONS.items():
            # PRAGMA table_info ger tom lista för saknad tabell — create_all() skapar den
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
            if not existing:
                continue
            for name, decl in cols:
                if name not in existing:
                    logger.info("migrating %s: adding column %s %s", table, name, decl)
                    try:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {decl}"))
                    except Exception as e:
                        raise RuntimeError(
                            f"Migration misslyckades: ALTER TABLE {table} ADD COLUMN {name} {decl} — {e}"
                        ) from e
        conn.commit()


def _seed_household():
    """Ensure a default Household exists and all legacy users/recipes are assigned to it."""
    import secrets as _secrets
    from sqlmodel import Session
    with Session(engine) as session:
        # Import here to avoid circular imports at module level
        from models import Household, User, Recipe

        household = session.exec(
            __import__("sqlmodel", fromlist=["select"]).select(Household)
        ).first()
        if not household:
            household = Household(
                name="Familjen",
                invite_code=_secrets.token_urlsafe(8),
            )
            session.add(household)
            session.commit()
            session.refresh(household)
            logger.info("Skapade standard-hushåll id=%d invite_code=%s", household.id, household.invite_code)

        hid = household.id

        # Assign all existing records without a household to the default one
        from sqlalchemy import text as _text
        with engine.connect() as conn:
            for tbl in ("user", "recipe", "shoppinglist", "mealplanentry",
                        "collection", "pantryitem", "freezerportion", "inboxrecipe"):
                conn.execute(_text(f"UPDATE {tbl} SET household_id = {hid} WHERE household_id IS NULL"))
            conn.execute(_text(f"UPDATE recipe SET visibility = 'private' WHERE visibility IS NULL"))
            conn.commit()


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _migrate_schema()
    _seed_household()


def get_session():
    with Session(engine) as session:
        yield session
