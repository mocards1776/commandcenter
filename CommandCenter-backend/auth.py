from datetime import datetime, timedelta
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import select
from models import User
import db
import os

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

def create_access_token(user_id: str, expires_in_days: int = ACCESS_TOKEN_EXPIRE_DAYS):
    expire = datetime.utcnow() + timedelta(days=expires_in_days)
    to_encode = {"sub": user_id, "exp": expire}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(token: str) -> str:
    """Decode and validate a JWT. Returns user_id str. Pure CPU — no DB hit."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# CRITICAL: use get_session (yield-based) so the session is ALWAYS closed
# after the request completes. The old get_session_direct() was a raw
# SessionLocal() with no cleanup — every request leaked a connection into
# the pool until it exhausted at QueuePool limit.
async def get_current_user(
    authorization: str = Header(None),
    session: Session = Depends(db.get_session),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization[7:]
    user_id = verify_token(token)

    user = session.execute(select(User).where(User.id == user_id)).scalar()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user
