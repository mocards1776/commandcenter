from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from models import Base
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/commandcenter")

engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_session_direct() -> Session:
    return SessionLocal()

def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_habits()

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
