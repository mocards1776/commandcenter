from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, or_
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
import os
import json
import httpx
from typing import Optional, List
import asyncio

import db
from models import (
    Task, Project, Habit, HabitCompletion, TimeEntry, Note, CRMPerson,
    TimeBlock, Tag, Category, BraindumpEntry, User, FavoriteSportsTeam,
)
from schemas import (
    TaskCreate, TaskUpdate, TaskResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    HabitCreate, HabitUpdate, HabitResponse,
    TimeEntryCreate, TimeEntryResponse,
    NoteCreate, NoteUpdate, NoteResponse,
    CRMPersonCreate, CRMPersonUpdate, CRMPersonResponse,
    TimeBlockCreate, TimeBlockUpdate, TimeBlockResponse,
    TagCreate, TagResponse,
    CategoryCreate, CategoryResponse,
    BraindumpEntryCreate, BraindumpEntryResponse,
    DashboardSummary,
    UserCreate, UserResponse, UserLogin,
    FavoriteSportsTeamCreate, FavoriteSportsTeamResponse,
)
from auth import get_current_user, create_access_token, verify_token

app = FastAPI(title="CommandCenter API")

# CORS — allow_origins=["*"] + allow_credentials=True is illegal; use explicit list.
ALLOWED_ORIGINS = [
    "https://command-center-flax-gamma.vercel.app",
    "https://command-center-git-main-mocards1776s-projects.vercel.app",
    "https://command-center-mocards1776s-projects.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://command-center.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DigitalOcean/Cloudflare proxy strips Access-Control-Allow-Credentials.
# This middleware re-injects it so the browser doesn't block credentialed requests.
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

class CredentialsCORSFixMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        origin = request.headers.get("origin", "")
        is_allowed = (
            origin in ALLOWED_ORIGINS
            or (origin.startswith("https://command-center") and origin.endswith(".vercel.app"))
        )
        if is_allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept"
            response.headers["Vary"] = "Origin"
        return response

app.add_middleware(CredentialsCORSFixMiddleware)

@app.on_event("startup")
def _on_startup():
    try:
        db.init_db()
    except Exception as e:
        print(f"Startup init_db warning: {e}")

# ─── Timezone Helpers ────────────────────────────────────────────────
_CT = ZoneInfo("America/Chicago")
_UTC = ZoneInfo("UTC")

def _today_ct() -> date:
    return datetime.now(_CT).date()

def _ct_midnight_as_utc() -> datetime:
    midnight_ct = datetime.now(_CT).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_ct.astimezone(_UTC).replace(tzinfo=None)

# ─── Helpers ─────────────────────────────────────────────────────────
def tags_to_str(tag_ids) -> str:
    if tag_ids is None:
        return ""
    if isinstance(tag_ids, list):
        return ",".join(str(t) for t in tag_ids)
    return str(tag_ids)

def calc_focus_score(importance: int, difficulty: int) -> int:
    return importance * difficulty

def _own(query, model, user: User):
    return query.where(model.user_id == user.id)

def _own_or_legacy(query, model, user: User):
    return query.where(or_(model.user_id == user.id, model.user_id == None))  # noqa: E711

# ─── Telegram Bot ────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "RUWT_bot")
TELEGRAM_OWNER_USER_ID = os.getenv("TELEGRAM_OWNER_USER_ID", "")
PUBLIC_BACKEND_URL = os.getenv("PUBLIC_BACKEND_URL", "")

async def telegram_send_message(chat_id: int, text: str):
    if not TELEGRAM_BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    async with httpx.AsyncClient(timeout=15.0) as client:
        await client.post(url, json={"chat_id": chat_id, "text": text})

def parse_telegram_task(text: str) -> dict:
    raw = text.strip()
    if raw.lower().startswith("/task "):
        raw = raw[6:].strip()
    elif raw.lower() == "/task":
        raw = ""
    if not raw:
        raise ValueError("Usage: /task Your task title here")
    priority = "medium"
    status = "today"
    importance = 3
    difficulty = 3
    if raw.startswith("!"):
        priority = "high"
        importance = 5
        raw = raw[1:].strip()
    if raw.lower().startswith("today "):
        status = "today"
        raw = raw[6:].strip()
    if not raw:
        raise ValueError("Task title cannot be empty after prefix")
    return {
        "title": raw, "status": status, "priority": priority,
        "importance": importance, "difficulty": difficulty,
        "notes": "Created via Telegram bot",
    }

# ─── Auth ────────────────────────────────────────────────────────────
@app.post("/auth/register", response_model=UserResponse)
async def register(data: UserCreate, session: Session = Depends(db.get_session)):
    existing = session.execute(select(User).where(User.email == data.email)).scalar()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(email=data.email)
    user.set_password(data.password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@app.post("/auth/login")
async def login(data: UserLogin, session: Session = Depends(db.get_session)):
    user = session.execute(select(User).where(User.email == data.email)).scalar()
    if not user or not user.check_password(data.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}

@app.get("/auth/me", response_model=UserResponse)
async def whoami(user: User = Depends(get_current_user)):
    return user

@app.post("/auth/change-password")
async def change_password(
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    current = data.get("current_password")
    new = data.get("new_password")
    if not current or not new:
        raise HTTPException(status_code=400, detail="current_password and new_password required")
    if not user.check_password(current):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(new) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    fresh = session.execute(select(User).where(User.id == user.id)).scalar()
    fresh.set_password(new)
    session.commit()
    token = create_access_token(fresh.id)
    return {"ok": True, "access_token": token, "token_type": "bearer"}

# ─── Tasks ────────────────────────────────────────────────────────────
@app.get("/tasks/", response_model=List[TaskResponse])
async def list_tasks(
    status: Optional[str] = None,
    search: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(Task), Task, user)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            query = query.where(Task.status == statuses[0])
        else:
            query = query.where(Task.status.in_(statuses))
    if search:
        query = query.where(Task.title.ilike(f"%{search}%"))
    return session.execute(query.order_by(Task.created_at.desc())).scalars().all()

@app.get("/tasks/today", response_model=List[TaskResponse])
async def today_tasks(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    query = _own(select(Task), Task, user).where(
        Task.status.in_(["today", "in_progress"]) |
        ((Task.due_date == today) & (Task.status != "done"))
    )
    return session.execute(query.order_by(Task.sort_order)).scalars().all()

@app.post("/tasks/", response_model=TaskResponse)
async def create_task(
    data: TaskCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    d = data.dict()
    d["tag_ids"] = tags_to_str(d.get("tag_ids", []))
    d["focus_score"] = calc_focus_score(d.get("importance", 3), d.get("difficulty", 3))
    task = Task(**d)
    task.user_id = user.id
    session.add(task)
    session.commit()
    session.refresh(task)
    return task

@app.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(_own(select(Task), Task, user).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    return task

@app.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(_own(select(Task), Task, user).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    if "tag_ids" in updates:
        updates["tag_ids"] = tags_to_str(updates["tag_ids"])
    if "importance" in updates or "difficulty" in updates:
        imp = updates.get("importance", task.importance)
        diff = updates.get("difficulty", task.difficulty)
        updates["focus_score"] = calc_focus_score(imp, diff)
    for k, v in updates.items():
        setattr(task, k, v)
    session.commit()
    session.refresh(task)
    return task

@app.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(_own(select(Task), Task, user).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    session.delete(task)
    session.commit()
    return {"ok": True}

@app.post("/tasks/{task_id}/complete/", response_model=TaskResponse)
async def complete_task(
    task_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(_own(select(Task), Task, user).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    task.status = "done"
    task.completed_at = datetime.utcnow()
    session.commit()
    session.refresh(task)
    return task

@app.post("/tasks/reorder/")
async def reorder_tasks(
    ids: List[str],
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    for i, task_id in enumerate(ids):
        task = session.execute(_own(select(Task), Task, user).where(Task.id == task_id)).scalar()
        if task:
            task.sort_order = i
    session.commit()
    return {"ok": True}

# ─── Projects ─────────────────────────────────────────────────────────
@app.get("/projects/", response_model=List[ProjectResponse])
async def list_projects(
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(Project), Project, user)
    if status:
        query = query.where(Project.status == status)
    return session.execute(query.order_by(Project.created_at.desc())).scalars().all()

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(_own(select(Project), Project, user).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    return project

@app.post("/projects/", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = Project(**data.dict())
    project.user_id = user.id
    session.add(project)
    session.commit()
    session.refresh(project)
    return project

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(_own(select(Project), Project, user).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(project, k, v)
    session.commit()
    session.refresh(project)
    return project

@app.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(_own(select(Project), Project, user).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    session.delete(project)
    session.commit()
    return {"ok": True}

# ─── Habits ────────────────────────────────────────────────────────────
@app.get("/habits/", response_model=List[HabitResponse])
async def list_habits(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(Habit), Habit, user)
    return session.execute(query.order_by(Habit.created_at.desc())).scalars().all()

@app.get("/habits/{habit_id}", response_model=HabitResponse)
async def get_habit(
    habit_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(_own(select(Habit), Habit, user).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    return habit

@app.post("/habits/", response_model=HabitResponse)
async def create_habit(
    data: HabitCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = Habit(**data.dict())
    habit.user_id = user.id
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@app.patch("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit(
    habit_id: str,
    data: HabitUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(_own(select(Habit), Habit, user).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(habit, k, v)
    session.commit()
    session.refresh(habit)
    return habit

@app.delete("/habits/{habit_id}")
async def delete_habit(
    habit_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(_own(select(Habit), Habit, user).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    session.delete(habit)
    session.commit()
    return {"ok": True}

@app.post("/habits/{habit_id}/complete/")
async def complete_habit(
    habit_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(_own(select(Habit), Habit, user).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    completed_date = data.get("completed_date", str(_today_ct()))
    note = data.get("note", "")
    existing = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == completed_date,
        )
    ).scalar()
    if existing:
        return existing
    completion = HabitCompletion(habit_id=habit_id, completed_date=completed_date, note=note)
    session.add(completion)
    session.commit()
    session.refresh(completion)
    return completion

@app.delete("/habits/{habit_id}/complete/{completed_date}")
async def uncomplete_habit(
    habit_id: str,
    completed_date: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(_own(select(Habit), Habit, user).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    completion = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == completed_date,
        )
    ).scalar()
    if completion:
        session.delete(completion)
        session.commit()
    return {"ok": True}

@app.get("/habits/{habit_id}/streak/")
async def habit_streak(
    habit_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(_own(select(Habit), Habit, user).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    completions = session.execute(
        select(HabitCompletion)
        .where(HabitCompletion.habit_id == habit_id)
        .order_by(HabitCompletion.completed_date.desc())
    ).scalars().all()
    streak = 0
    check_date = _today_ct()
    completion_dates = {c.completed_date for c in completions}
    while str(check_date) in completion_dates:
        streak += 1
        check_date = check_date - timedelta(days=1)
    return {"habit_id": habit_id, "streak": streak}

# ─── Time Entries ──────────────────────────────────────────────────────
@app.get("/time-entries/active/")
async def active_timer(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa: E711
    ).scalar()
    return entry

@app.post("/time-entries/start/", response_model=TimeEntryResponse)
async def start_timer(
    data: TimeEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    active = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa: E711
    ).scalar()
    if active:
        raise HTTPException(status_code=400, detail="A timer is already running")
    entry = TimeEntry(**data.dict())
    entry.user_id = user.id
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/time-entries/{entry_id}/stop/", response_model=TimeEntryResponse)
async def stop_timer(
    entry_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(_own(select(TimeEntry), TimeEntry, user).where(TimeEntry.id == entry_id)).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.ended_at = data.get("ended_at", datetime.utcnow().isoformat())
    if data.get("note"):
        entry.note = data["note"]
    session.commit()
    session.refresh(entry)
    return entry

@app.get("/time-entries/", response_model=List[TimeEntryResponse])
async def list_time_entries(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(
        _own(select(TimeEntry), TimeEntry, user).order_by(TimeEntry.started_at.desc())
    ).scalars().all()

# ─── Notes ────────────────────────────────────────────────────────────
@app.get("/notes/", response_model=List[NoteResponse])
async def list_notes(
    search: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(Note), Note, user)
    if search:
        query = query.where(Note.title.ilike(f"%{search}%") | Note.content.ilike(f"%{search}%"))
    return session.execute(query.order_by(Note.updated_at.desc())).scalars().all()

@app.post("/notes/", response_model=NoteResponse)
async def create_note(
    data: NoteCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = Note(**data.dict())
    note.user_id = user.id
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@app.patch("/notes/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: str,
    data: NoteUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(_own(select(Note), Note, user).where(Note.id == note_id)).scalar()
    if not note:
        raise HTTPException(status_code=404)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(note, k, v)
    note.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(note)
    return note

@app.delete("/notes/{note_id}")
async def delete_note(
    note_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(_own(select(Note), Note, user).where(Note.id == note_id)).scalar()
    if not note:
        raise HTTPException(status_code=404)
    session.delete(note)
    session.commit()
    return {"ok": True}

# ─── CRM ──────────────────────────────────────────────────────────────
@app.get("/crm/", response_model=List[CRMPersonResponse])
async def list_crm(
    search: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(CRMPerson), CRMPerson, user)
    if search:
        query = query.where(CRMPerson.name.ilike(f"%{search}%"))
    return session.execute(query.order_by(CRMPerson.name)).scalars().all()

@app.get("/crm/{person_id}", response_model=CRMPersonResponse)
async def get_crm_person(
    person_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(_own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    return person

@app.post("/crm/", response_model=CRMPersonResponse)
async def create_crm_person(
    data: CRMPersonCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = CRMPerson(**data.dict())
    person.user_id = user.id
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm_person(
    person_id: str,
    data: CRMPersonUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(_own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(person, k, v)
    session.commit()
    session.refresh(person)
    return person

@app.delete("/crm/{person_id}")
async def delete_crm_person(
    person_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(_own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    session.delete(person)
    session.commit()
    return {"ok": True}

@app.post("/crm/{person_id}/contacted/", response_model=CRMPersonResponse)
async def mark_contacted(
    person_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(_own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    person.last_contacted = datetime.utcnow().date()
    session.commit()
    session.refresh(person)
    return person

# ─── Tags ──────────────────────────────────────────────────────────────
@app.get("/tags/", response_model=List[TagResponse])
async def list_tags(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(_own(select(Tag), Tag, user).order_by(Tag.name)).scalars().all()

@app.post("/tags/", response_model=TagResponse)
async def create_tag(
    data: TagCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tag = Tag(**data.dict())
    tag.user_id = user.id
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@app.delete("/tags/{tag_id}")
async def delete_tag(
    tag_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tag = session.execute(_own(select(Tag), Tag, user).where(Tag.id == tag_id)).scalar()
    if not tag:
        raise HTTPException(status_code=404)
    session.delete(tag)
    session.commit()
    return {"ok": True}

# ─── Categories ────────────────────────────────────────────────────────
@app.get("/categories/", response_model=List[CategoryResponse])
async def list_categories(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(_own(select(Category), Category, user).order_by(Category.name)).scalars().all()

@app.post("/categories/", response_model=CategoryResponse)
async def create_category(
    data: CategoryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = Category(**data.dict())
    cat.user_id = user.id
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat

@app.delete("/categories/{cat_id}")
async def delete_category(
    cat_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = session.execute(_own(select(Category), Category, user).where(Category.id == cat_id)).scalar()
    if not cat:
        raise HTTPException(status_code=404)
    session.delete(cat)
    session.commit()
    return {"ok": True}

# ─── Braindump ─────────────────────────────────────────────────────────
@app.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(
        _own(select(BraindumpEntry), BraindumpEntry, user).order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()

@app.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = BraindumpEntry(**data.dict())
    entry.user_id = user.id
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/braindump/{entry_id}/process/", response_model=BraindumpEntryResponse)
async def process_braindump(
    entry_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        _own(select(BraindumpEntry), BraindumpEntry, user).where(BraindumpEntry.id == entry_id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.processed = True
    session.commit()
    session.refresh(entry)
    return entry

# ─── Dashboard ─────────────────────────────────────────────────────────
@app.get("/dashboard/", response_model=DashboardSummary)
async def dashboard(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    tasks_today = session.execute(
        _own(select(Task), Task, user).where(Task.status.in_(["today", "in_progress"]))
    ).scalars().all()
    tasks_done_today = session.execute(
        _own(select(Task), Task, user).where(
            Task.status == "done",
            Task.completed_at >= _ct_midnight_as_utc(),
        )
    ).scalars().all()
    habits = session.execute(_own(select(Habit), Habit, user)).scalars().all()
    habit_completions_today = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id.in_([h.id for h in habits]),
            HabitCompletion.completed_date == str(today),
        )
    ).scalars().all()
    completed_habit_ids = {c.habit_id for c in habit_completions_today}
    active_timer = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa: E711
    ).scalar()
    projects = session.execute(
        _own(select(Project), Project, user).where(Project.status == "active")
    ).scalars().all()
    return DashboardSummary(
        tasks_today=len(tasks_today),
        tasks_done_today=len(tasks_done_today),
        habits_total=len(habits),
        habits_done_today=len(completed_habit_ids),
        active_timer=active_timer is not None,
        active_projects=len(projects),
    )

# ─── Gamification ──────────────────────────────────────────────────────
@app.get("/gamification/")
async def gamification_history(
    limit: int = 30,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    results = []
    for i in range(limit):
        day = today - timedelta(days=i)
        tasks_done = session.execute(
            _own(select(Task), Task, user).where(
                Task.status == "done",
                Task.completed_at >= datetime.combine(day, datetime.min.time()),
                Task.completed_at < datetime.combine(day + timedelta(days=1), datetime.min.time()),
            )
        ).scalars().all()
        habits_done = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.completed_date == str(day),
                HabitCompletion.habit_id.in_(
                    [h.id for h in session.execute(_own(select(Habit), Habit, user)).scalars().all()]
                ),
            )
        ).scalars().all()
        xp = len(tasks_done) * 10 + len(habits_done) * 5
        results.append({
            "date": str(day),
            "tasks_completed": len(tasks_done),
            "habits_completed": len(habits_done),
            "xp_earned": xp,
        })
    return results

# ─── Sports ────────────────────────────────────────────────────────────
@app.get("/sports/favorites/")
async def list_favorites(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(
        _own(select(FavoriteSportsTeam), FavoriteSportsTeam, user)
    ).scalars().all()

@app.post("/sports/favorites/")
async def add_favorite(
    data: FavoriteSportsTeamCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = FavoriteSportsTeam(**data.dict())
    team.user_id = user.id
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

@app.delete("/sports/favorites/{team_id}")
async def remove_favorite(
    team_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = session.execute(
        _own(select(FavoriteSportsTeam), FavoriteSportsTeam, user).where(FavoriteSportsTeam.id == team_id)
    ).scalar()
    if not team:
        raise HTTPException(status_code=404)
    session.delete(team)
    session.commit()
    return {"ok": True}

# ─── Telegram Webhook ──────────────────────────────────────────────────
@app.post("/telegram/webhook/")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    message = body.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "").strip()
    tg_user_id = str(message.get("from", {}).get("id", ""))
    if not chat_id or not text:
        return {"ok": True}
    owner_id = TELEGRAM_OWNER_USER_ID.strip()
    if owner_id and tg_user_id != owner_id:
        await telegram_send_message(chat_id, "Unauthorized.")
        return {"ok": True}
    if text.lower().startswith("/task"):
        try:
            task_data = parse_telegram_task(text)
        except ValueError as e:
            await telegram_send_message(chat_id, str(e))
            return {"ok": True}
        user = session.execute(select(User).order_by(User.id)).scalar()
        if not user:
            await telegram_send_message(chat_id, "No user found in system.")
            return {"ok": True}
        task_data["tag_ids"] = ""
        task_data["focus_score"] = calc_focus_score(task_data["importance"], task_data["difficulty"])
        task = Task(**task_data)
        task.user_id = user.id
        session.add(task)
        session.commit()
        await telegram_send_message(chat_id, f"Task created: {task.title}")
    elif text.lower() == "/tasks":
        user = session.execute(select(User).order_by(User.id)).scalar()
        if not user:
            await telegram_send_message(chat_id, "No user found.")
            return {"ok": True}
        tasks = session.execute(
            _own(select(Task), Task, user).where(Task.status.in_(["today", "in_progress"]))
            .order_by(Task.sort_order)
        ).scalars().all()
        if not tasks:
            await telegram_send_message(chat_id, "No tasks for today.")
        else:
            lines = [f"• {t.title} [{t.priority}]" for t in tasks]
            await telegram_send_message(chat_id, "Today's tasks:\n" + "\n".join(lines))
    elif text.lower() == "/help":
        await telegram_send_message(
            chat_id,
            "/task <title> — create a task\n/tasks — list today's tasks\n/help — show commands",
        )
    else:
        await telegram_send_message(chat_id, "Unknown command. Try /help")
    return {"ok": True}

@app.get("/telegram/setup/")
async def telegram_setup():
    if not TELEGRAM_BOT_TOKEN or not PUBLIC_BACKEND_URL:
        return {"error": "TELEGRAM_BOT_TOKEN or PUBLIC_BACKEND_URL not set"}
    webhook_url = f"{PUBLIC_BACKEND_URL.rstrip('/')}/telegram/webhook/"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
            json={"url": webhook_url},
        )
    return r.json()
