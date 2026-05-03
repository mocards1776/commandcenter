from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from models import Base
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/commandcenter")

# Fix legacy "postgres://" scheme emitted by some DigitalOcean connection strings.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SSL: DigitalOcean Managed Databases require sslmode=require.
_connect_args = {}
if "localhost" not in DATABASE_URL and "127.0.0.1" not in DATABASE_URL:
    _connect_args = {"sslmode": "require"}

# Pool sizing:
# DO Managed DB basic plan allows ~22 connections total.
# With auth.py now using get_session (yield-based, properly closed),
# each request uses exactly 1 connection shared via FastAPI's dependency
# injection — auth and the endpoint handler share the SAME session.
# pool_size=5 + max_overflow=5 = 10 max, well under DO's 22 limit.
# pool_timeout=10 gives a bit more breathing room.
# pool_recycle=300 drops stale connections every 5 min.
engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    pool_timeout=10,
    pool_recycle=300,
    connect_args=_connect_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_session_direct() -> Session:
    """Direct session — caller is responsible for closing. Avoid in request handlers."""
    return SessionLocal()

def get_session():
    """Yield-based dependency for FastAPI. Session is always closed after the request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_habits()
    _backfill_user_ownership()


# Tables that have a user_id column and need legacy-row backfill.
_OWNED_TABLES = (
    "tasks", "projects", "habits", "time_entries", "notes",
    "tags", "categories", "crm_people", "time_blocks",
    "braindump_entries", "favorite_sports_teams",
)

def _backfill_user_ownership():
    """
    One-time backfill: assign all rows with NULL user_id to a default owner.
    Runs every boot but is idempotent (no-op once nothing is NULL).
    """
    target_email = os.getenv("BACKFILL_OWNER_EMAIL", "").strip().lower()
    with engine.connect() as conn:
        try:
            if target_email:
                row = conn.execute(
                    text("SELECT id FROM users WHERE LOWER(email) = :e LIMIT 1"),
                    {"e": target_email},
                ).fetchone()
            else:
                row = conn.execute(
                    text("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
                ).fetchone()
            if not row:
                return
            owner_id = row[0]

            for tbl in _OWNED_TABLES:
                try:
                    conn.execute(
                        text(f"UPDATE {tbl} SET user_id = :uid WHERE user_id IS NULL"),
                        {"uid": owner_id},
                    )
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    print(f"Backfill warning for {tbl}: {e}")
        except Exception as e:
            print(f"Backfill skipped: {e}")

def _migrate_habits():
    """Add new columns to habits table if they don't exist yet."""
    new_columns = [
        ("icon",          "VARCHAR(100)"),
        ("custom_days",   "TEXT"),
        ("target_minutes","INTEGER"),
        ("time_hour",     "INTEGER"),
        ("time_minute",   "INTEGER"),
        ("sort_order",    "INTEGER DEFAULT 0"),
        ("is_active",     "BOOLEAN DEFAULT TRUE"),
    ]
    with engine.connect() as conn:
        for col, col_def in new_columns:
            try:
                conn.execute(text(f"ALTER TABLE habits ADD COLUMN IF NOT EXISTS {col} {col_def}"))
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"Migration warning for habits.{col}: {e}")
