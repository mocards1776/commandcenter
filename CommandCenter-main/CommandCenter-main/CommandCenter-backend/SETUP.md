# CommandCenter Backend Setup Guide

## What You Get
- **FastAPI** REST backend with full CRUD for tasks, projects, habits, time entries, notes, etc.
- **PostgreSQL** database for persistent storage
- **User authentication** with JWT tokens
- **Docker Compose** for local dev + easy deployment
- Stats persist forever, even after code changes

## Quick Start (5 minutes)

### 1. Prerequisites
```bash
docker --version  # Need Docker + Docker Compose
```

### 2. Create Backend Structure
Create a `backend/` folder next to your `CommandCenter-main/` frontend:

```
.
├── CommandCenter-main/          (your React frontend)
└── backend/                      (new backend)
    ├── main.py
    ├── models.py
    ├── schemas.py
    ├── auth.py
    ├── db.py
    ├── requirements.txt
    ├── Dockerfile
    ├── docker-compose.yml
    └── alembic/                  (migrations, optional)
```

### 3. Install Requirements

Create `backend/requirements.txt`:
```
fastapi==0.104.1
uvicorn==0.24.0
sqlalchemy==2.0.23
psycopg2-binary==2.9.9
pydantic==2.5.0
pydantic-settings==2.1.0
python-jose==3.3.0
passlib==1.7.4
werkzeug==3.0.1
python-multipart==0.0.6
python-dotenv==1.0.0
```

### 4. Create Supporting Files

**db.py** - Database connection:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/commandcenter")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

def init_db():
    Base.metadata.create_all(bind=engine)
```

**auth.py** - JWT authentication:
```python
from datetime import datetime, timedelta
from jose import JWTError, jwt
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from models import User
from db import get_session
import os

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"

def create_access_token(user_id: str, expires_in_days: int = 30):
    expires = datetime.utcnow() + timedelta(days=expires_in_days)
    payload = {"sub": user_id, "exp": expires}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(
    authorization: str = None,
    session: Session = Depends(get_session)
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization[7:]
    user_id = verify_token(token)
    user = session.execute(select(User).where(User.id == user_id)).scalar()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

**schemas.py** - Pydantic schemas (detailed versions in full backend):
```python
from pydantic import BaseModel
from datetime import datetime, date
from typing import Optional, List

# User
class UserCreate(BaseModel):
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    class Config:
        from_attributes = True

# Task
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "inbox"
    priority: str = "medium"
    importance: int = 3
    difficulty: int = 3
    due_date: Optional[date] = None
    time_estimate_minutes: Optional[int] = None
    project_id: Optional[str] = None
    parent_id: Optional[str] = None
    tag_ids: List[str] = []
    show_in_daily: bool = True

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    importance: Optional[int] = None
    difficulty: Optional[int] = None
    due_date: Optional[date] = None
    time_estimate_minutes: Optional[int] = None
    class Config:
        from_attributes = True

class TaskResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    status: str
    priority: str
    importance: int
    difficulty: int
    focus_score: int
    due_date: Optional[date]
    created_at: datetime
    completed_at: Optional[datetime]
    class Config:
        from_attributes = True

# Add similar schemas for Project, Habit, TimeEntry, TimeBlock, Tag, Category, etc.
# See full backend implementation for complete schemas

class DashboardSummary(BaseModel):
    tasks_today: int
    completed_today: int
    focus_score_today: int
    time_tracked_seconds: int
    streak_days: int
```

### 5. Docker Setup

**Dockerfile**:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: commandcenter
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: .
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/commandcenter
      SECRET_KEY: dev-secret-key-change-in-prod
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - .:/app
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build:
      context: ../CommandCenter-main
      dockerfile: Dockerfile
    ports:
      - "80:80"
    environment:
      - VITE_API_BASE_URL=http://localhost:8000
    depends_on:
      - backend

volumes:
  postgres_data:
```

### 6. Update Frontend to Use Backend

In `src/lib/api.ts`, update baseURL:
```typescript
const api = axios.create({
  baseURL: process.env.VITE_API_BASE_URL || "http://localhost:8000/api",
  headers: { "Content-Type": "application/json" },
});

// Add auth token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

Update login handling in App.tsx or create an AuthContext:
```typescript
const token = localStorage.getItem("auth_token");
if (!token) {
  // Show login screen
} else {
  // Show app
}
```

### 7. Run Everything

```bash
# From the backend directory
cd backend

# Start services (postgres + backend + frontend)
docker-compose up

# Backend runs on http://localhost:8000
# Frontend runs on http://localhost:80
# Database: localhost:5432 (postgres/postgres)

# Check logs
docker-compose logs -f backend
docker-compose logs -f db
```

### 8. Create Test User

```bash
# Access the running backend
docker-compose exec backend python

# Then in Python shell:
from db import SessionLocal, init_db
from models import User

init_db()
session = SessionLocal()
user = User(email="test@example.com")
user.set_password("password123")
session.add(user)
session.commit()
session.refresh(user)
print(f"User ID: {user.id}")
```

### 9. Login from Frontend

Call `/api/auth/login`:
```typescript
const response = await axios.post("/api/auth/login", {
  email: "test@example.com",
  password: "password123",
});
localStorage.setItem("auth_token", response.data.access_token);
```

Now all your requests include the auth token, and data persists forever!

## File Structure Summary

```
backend/
├── main.py              (FastAPI app + routes)
├── models.py            (SQLAlchemy ORM models)
├── schemas.py           (Pydantic schemas)
├── auth.py              (JWT authentication)
├── db.py                (Database setup)
├── requirements.txt     (Python dependencies)
├── Dockerfile           (Container definition)
├── docker-compose.yml   (Services orchestration)
└── .env                 (Environment variables, .gitignore!)
```

## Deployment to Production

### Using Render (free tier available):
1. Push backend to GitHub
2. Create new Postgres database on Render
3. Create new Web Service pointing to your backend repo
4. Set environment variables:
   - `DATABASE_URL`: from Render Postgres
   - `SECRET_KEY`: strong random string
5. Deploy frontend to Netlify/Vercel with API URL pointing to Render

### Using Railway, Fly.io, or Heroku:
Similar process — all support Docker, just add env vars and deploy.

## Troubleshooting

**"Connection refused"** → Make sure Docker containers are running: `docker-compose ps`

**"Authentication failed"** → Check token is being sent in `Authorization: Bearer <token>` header

**"Database locked"** → Kill container and restart: `docker-compose down && docker-compose up`

**Migrations** → For schema changes, use Alembic:
```bash
pip install alembic
alembic init alembic
# Edit models
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Next Steps

- Add email verification for registration
- Implement refresh tokens (30-day expiration)
- Add password reset flow
- Set up automated backups for Postgres
- Add rate limiting to prevent abuse
- Create admin dashboard for stats
- Set up monitoring/logging (Sentry, etc.)

Everything is now persistent! 🎉
