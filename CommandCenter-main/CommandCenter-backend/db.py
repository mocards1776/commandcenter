from sqlalchemy import create_engine
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
