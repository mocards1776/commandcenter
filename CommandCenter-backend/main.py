from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, func
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
import os
import json
import httpx
from typing import Optional, List
import asyncio
from collections import defaultdict

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

# NOTE: Starlette applies middleware in REVERSE registration order (last-added = outermost).
# CredentialsCORSFixMiddleware must be added FIRST so it runs LAST (outermost wrap),
# meaning its header injection fires after CORSMiddleware and wins.

# Step 1: Add CORSMiddleware first (innermost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://command-center.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Step 2: Pure ASGI middleware that re-injects credentials header stripped by DO/Cloudflare proxy.
class CredentialsCORSFixMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        origin = ""
        for name, value in scope.get("headers", []):
            if name == b"origin":
                origin = value.decode("latin-1")
                break

        is_allowed = (
            origin in ALLOWED_ORIGINS
            or (origin.startswith("https://command-center") and origin.endswith(".vercel.app"))
        )

        if not is_allowed:
            await self.app(scope, receive, send)
            return

        inject = [
            (b"access-control-allow-origin", origin.encode("latin-1")),
            (b"access-control-allow-credentials", b"true"),
            (b"access-control-allow-methods", b"GET, POST, PUT, PATCH, DELETE, OPTIONS"),
            (b"access-control-allow-headers", b"Authorization, Content-Type, Accept"),
            (b"vary", b"Origin"),
        ]
        inject_keys = {k for k, _ in inject}

        async def patched_send(message):
            if message["type"] == "http.response.start":
                filtered = [
                    (k, v) for k, v in message.get("headers", [])
                    if k.lower() not in inject_keys
                ]
                message = {**message, "headers": filtered + inject}
            await send(message)

        await self.app(scope, receive, patched_send)

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

def _task_to_dict(task: Task) -> dict:
    tag_ids = task.tag_ids or ""
    if isinstance(tag_ids, str):
        s = tag_ids.strip()
        if not s:
            parsed_tags = []
        elif s.startswith("["):
            try:
                parsed_tags = json.loads(s)
            except Exception:
                parsed_tags = [i.strip() for i in s.split(",") if i.strip()]
        else:
            parsed_tags = [i.strip() for i in s.split(",") if i.strip()]
    elif isinstance(tag_ids, list):
        parsed_tags = tag_ids
    else:
        parsed_tags = []

    due_date = task.due_date
    if isinstance(due_date, date) and not isinstance(due_date, datetime):
        due_date = datetime(due_date.year, due_date.month, due_date.day)

    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "notes": task.notes,
        "status": task.status,
        "priority": task.priority,
        "importance": task.importance,
        "difficulty": task.difficulty,
        "focus_score": task.focus_score or 0,
        "due_date": due_date,
        "time_estimate_minutes": task.time_estimate_minutes,
        "project_id": task.project_id,
        "parent_id": task.parent_id,
        "category_id": task.category_id,
        "tag_ids": parsed_tags,
        "show_in_daily": task.show_in_daily if task.show_in_daily is not None else True,
        "actual_time_minutes": task.actual_time_minutes or 0,
        "sort_order": task.sort_order or 0,
        "subtasks": [],
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at,
    }

def _project_to_dict(project: Project) -> dict:
    due_date = project.due_date
    if isinstance(due_date, date) and not isinstance(due_date, datetime):
        due_date = datetime(due_date.year, due_date.month, due_date.day)

    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "color": project.color,
        "priority": project.priority or "medium",
        "due_date": due_date,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "tasks": [],
        "task_count": 0,
        "completion_percentage": 0,
    }

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

# ─── Time Blocks ───────────────────────────────────────────────────────
# Registered under BOTH /time-blocks/ AND /api/time-blocks/ so the
# frontend calling /api/time-blocks/?date=... gets a 200 instead of 404.
@app.get("/time-blocks/", response_model=List[TimeBlockResponse])
@app.get("/api/time-blocks/", response_model=List[TimeBlockResponse])
async def list_time_blocks(
    date: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(TimeBlock), TimeBlock, user)
    if date:
        query = query.where(TimeBlock.date == date)
    return session.execute(query.order_by(TimeBlock.start_time)).scalars().all()

@app.post("/time-blocks/", response_model=TimeBlockResponse)
@app.post("/api/time-blocks/", response_model=TimeBlockResponse)
async def create_time_block(
    data: TimeBlockCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = TimeBlock(**data.dict())
    block.user_id = user.id
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.patch("/time-blocks/{block_id}", response_model=TimeBlockResponse)
async def update_time_block(
    block_id: str,
    data: TimeBlockUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(_own(select(TimeBlock), TimeBlock, user).where(TimeBlock.id == block_id)).scalar()
    if not block:
        raise HTTPException(status_code=404)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(block, k, v)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/time-blocks/{block_id}")
async def delete_time_block(
    block_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(_own(select(TimeBlock), TimeBlock, user).where(TimeBlock.id == block_id)).scalar()
    if not block:
        raise HTTPException(status_code=404)
    session.delete(block)
    session.commit()
    return {"ok": True}

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
    midnight_utc = _ct_midnight_as_utc()

    try:
        tasks_today_rows = session.execute(
            _own(select(Task), Task, user).where(Task.status.in_(["today", "in_progress"]))
        ).scalars().all()

        tasks_done_today = session.execute(
            _own(select(Task), Task, user).where(
                Task.status == "done",
                Task.completed_at >= midnight_utc,
            )
        ).scalars().all()

        overdue_rows = session.execute(
            _own(select(Task), Task, user).where(
                Task.due_date < today,
                Task.status.notin_(["done"]),
            )
        ).scalars().all()

        habits = session.execute(
            _own(select(Habit), Habit, user).where(Habit.is_active == True)  # noqa: E712
        ).scalars().all()

        habit_completions_today = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id.in_([h.id for h in habits]),
                HabitCompletion.completed_date == str(today),
            )
        ).scalars().all() if habits else []
        completed_habit_ids = {c.habit_id for c in habit_completions_today}

        today_habits_list = [
            {
                "id": h.id,
                "name": h.name,
                "icon": h.icon,
                "color": h.color,
                "completed": h.id in completed_habit_ids,
            }
            for h in habits
        ]

        active_projects_orm = session.execute(
            _own(select(Project), Project, user).where(Project.status == "active")
        ).scalars().all()
        active_projects = [_project_to_dict(p) for p in active_projects_orm]

        time_entries_today = session.execute(
            _own(select(TimeEntry), TimeEntry, user).where(
                TimeEntry.started_at >= midnight_utc,
                TimeEntry.ended_at != None,  # noqa: E711
            )
        ).scalars().all()

        time_tracked_seconds = 0
        for entry in time_entries_today:
            if entry.ended_at and entry.started_at:
                started = entry.started_at if isinstance(entry.started_at, datetime) else datetime.fromisoformat(str(entry.started_at))
                ended = entry.ended_at if isinstance(entry.ended_at, datetime) else datetime.fromisoformat(str(entry.ended_at))
                delta = (ended - started).total_seconds()
                if delta > 0:
                    time_tracked_seconds += int(delta)

        focus_score_today = sum(t.focus_score or 0 for t in tasks_done_today)

        streak_days = 0
        check = today
        while True:
            day_start = datetime.combine(check, datetime.min.time())
            day_end = datetime.combine(check + timedelta(days=1), datetime.min.time())
            count = session.execute(
                _own(select(Task), Task, user).where(
                    Task.status == "done",
                    Task.completed_at >= day_start,
                    Task.completed_at < day_end,
                )
            ).scalars().first()
            if count is None:
                break
            streak_days += 1
            check -= timedelta(days=1)
            if streak_days > 365:
                break

        habit_completion_rate = (
            len(completed_habit_ids) / len(habits) if habits else 0.0
        )

        serialized_today_tasks = [_task_to_dict(t) for t in tasks_today_rows]
        serialized_overdue_tasks = [_task_to_dict(t) for t in overdue_rows]

        return DashboardSummary(
            tasks_today=len(tasks_today_rows),
            completed_today=len(tasks_done_today),
            focus_score_today=focus_score_today,
            time_tracked_seconds=time_tracked_seconds,
            streak_days=streak_days,
            today_tasks=serialized_today_tasks,
            overdue_tasks=serialized_overdue_tasks,
            today_habits=today_habits_list,
            active_projects=active_projects,
            total_tasks_today=len(tasks_today_rows),
            completed_tasks_today=len(tasks_done_today),
            habit_completion_rate=habit_completion_rate,
        )

    except Exception as e:
        print(f"Dashboard query error: {e}")
        return DashboardSummary(
            tasks_today=0,
            completed_today=0,
            focus_score_today=0,
            time_tracked_seconds=0,
            streak_days=0,
            today_tasks=[],
            overdue_tasks=[],
            today_habits=[],
            active_projects=[],
            total_tasks_today=0,
            completed_tasks_today=0,
            habit_completion_rate=0.0,
        )

# ─── Gamification ──────────────────────────────────────────────────────
@app.get("/gamification/")
async def gamification_history(
    limit: int = 30,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    window_start = datetime.combine(today - timedelta(days=limit - 1), datetime.min.time())
    window_end = datetime.combine(today + timedelta(days=1), datetime.min.time())

    all_tasks = session.execute(
        _own(select(Task), Task, user).where(
            Task.status == "done",
            Task.completed_at >= window_start,
            Task.completed_at < window_end,
        )
    ).scalars().all()
    tasks_by_date: dict = defaultdict(list)
    for t in all_tasks:
        if t.completed_at:
            completed_dt = t.completed_at if isinstance(t.completed_at, datetime) else datetime.fromisoformat(str(t.completed_at))
            tasks_by_date[completed_dt.date()].append(t)

    habit_ids = [
        h.id for h in session.execute(
            _own(select(Habit), Habit, user)
        ).scalars().all()
    ]

    completions_by_date: dict = defaultdict(int)
    if habit_ids:
        all_completions = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id.in_(habit_ids),
                HabitCompletion.completed_date >= str(today - timedelta(days=limit - 1)),
                HabitCompletion.completed_date <= str(today),
            )
        ).scalars().all()
        for c in all_completions:
            completions_by_date[c.completed_date] += 1

    results = []
    for i in range(limit):
        day = today - timedelta(days=i)
        tc = len(tasks_by_date.get(day, []))
        hc = completions_by_date.get(str(day), 0)
        results.append({
            "date": str(day),
            "tasks_completed": tc,
            "habits_completed": hc,
            "xp_earned": tc * 10 + hc * 5,
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

# ─── MLB Live Data (via MLB Stats API — no key required) ────────────────
# Proxies calls to statsapi.mlb.com so the frontend never touches it directly.
# Routes match exactly what the frontend requests:
#   GET /sports/mlb/{team_slug}                — today's game + standings
#   GET /sports/mlb/{team_slug}/projections    — probable pitchers / lineup

_MLB_TEAM_IDS = {
    "cardinals": 138, "cubs": 112, "brewers": 158, "reds": 113, "pirates": 134,
    "braves": 144, "mets": 121, "phillies": 143, "marlins": 146, "nationals": 120,
    "dodgers": 119, "giants": 137, "padres": 135, "rockies": 115, "diamondbacks": 109,
    "yankees": 147, "redsox": 111, "bluejays": 141, "orioles": 110, "rays": 139,
    "astros": 117, "athletics": 133, "mariners": 136, "angels": 108, "rangers": 140,
    "twins": 142, "whitesox": 145, "guardians": 114, "tigers": 116, "royals": 118,
}

_MLB_BASE = "https://statsapi.mlb.com/api/v1"

async def _mlb_get(path: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{_MLB_BASE}{path}")
        r.raise_for_status()
        return r.json()

@app.get("/sports/mlb/{team_slug}")
async def mlb_team_today(
    team_slug: str,
    user: User = Depends(get_current_user),
):
    """Return today's game (score/status) + NL Central standings for the team."""
    team_id = _MLB_TEAM_IDS.get(team_slug.lower())
    if not team_id:
        raise HTTPException(status_code=404, detail=f"Unknown team slug: {team_slug}")

    today_str = datetime.now(_CT).strftime("%Y-%m-%d")

    try:
        # Fetch today's schedule for this team
        schedule = await _mlb_get(
            f"/schedule?sportId=1&teamId={team_id}&date={today_str}"
            f"&hydrate=linescore,probablePitcher"
        )
        games = []
        for date_entry in schedule.get("dates", []):
            for g in date_entry.get("games", []):
                linescore = g.get("linescore", {})
                games.append({
                    "game_pk": g.get("gamePk"),
                    "status": g.get("status", {}).get("detailedState"),
                    "away_team": g.get("teams", {}).get("away", {}).get("team", {}).get("name"),
                    "home_team": g.get("teams", {}).get("home", {}).get("team", {}).get("name"),
                    "away_score": g.get("teams", {}).get("away", {}).get("score"),
                    "home_score": g.get("teams", {}).get("home", {}).get("score"),
                    "inning": linescore.get("currentInning"),
                    "inning_half": linescore.get("inningHalf"),
                    "start_time": g.get("gameDate"),
                    "venue": g.get("venue", {}).get("name"),
                })

        # Fetch NL Central standings (league 104 = NL, division 205 = NL Central)
        standings_data = await _mlb_get("/standings?leagueId=104&season=2026&standingsTypes=regularSeason")
        division_records = []
        for record in standings_data.get("records", []):
            div = record.get("division", {})
            if div.get("id") == 205:  # NL Central
                for tr in record.get("teamRecords", []):
                    division_records.append({
                        "team": tr.get("team", {}).get("name"),
                        "team_id": tr.get("team", {}).get("id"),
                        "wins": tr.get("wins"),
                        "losses": tr.get("losses"),
                        "pct": tr.get("winningPercentage"),
                        "gb": tr.get("gamesBack"),
                        "streak": tr.get("streak", {}).get("streakCode"),
                        "last10": tr.get("records", {}).get("splitRecords", [{}])[0].get("wins", ""),
                    })
                break

        return {
            "team_id": team_id,
            "team_slug": team_slug,
            "date": today_str,
            "games": games,
            "standings": division_records,
        }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MLB API error: {e}")

@app.get("/sports/mlb/{team_slug}/projections")
async def mlb_team_projections(
    team_slug: str,
    user: User = Depends(get_current_user),
):
    """Return probable pitchers and next game info for the team."""
    team_id = _MLB_TEAM_IDS.get(team_slug.lower())
    if not team_id:
        raise HTTPException(status_code=404, detail=f"Unknown team slug: {team_slug}")

    today_str = datetime.now(_CT).strftime("%Y-%m-%d")
    # Look ahead 7 days for next scheduled game
    end_str = (datetime.now(_CT) + timedelta(days=7)).strftime("%Y-%m-%d")

    try:
        schedule = await _mlb_get(
            f"/schedule?sportId=1&teamId={team_id}"
            f"&startDate={today_str}&endDate={end_str}"
            f"&hydrate=probablePitcher,lineups"
        )

        games = []
        for date_entry in schedule.get("dates", []):
            for g in date_entry.get("games", []):
                away = g.get("teams", {}).get("away", {})
                home = g.get("teams", {}).get("home", {})
                away_pitcher = away.get("probablePitcher", {}) or {}
                home_pitcher = home.get("probablePitcher", {}) or {}
                games.append({
                    "game_pk": g.get("gamePk"),
                    "game_date": g.get("gameDate"),
                    "status": g.get("status", {}).get("detailedState"),
                    "away_team": away.get("team", {}).get("name"),
                    "home_team": home.get("team", {}).get("name"),
                    "away_probable_pitcher": away_pitcher.get("fullName"),
                    "home_probable_pitcher": home_pitcher.get("fullName"),
                    "venue": g.get("venue", {}).get("name"),
                })

        return {
            "team_id": team_id,
            "team_slug": team_slug,
            "window_start": today_str,
            "window_end": end_str,
            "upcoming_games": games,
        }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MLB API error: {e}")

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
            lines = [f"\u2022 {t.title} [{t.priority}]" for t in tasks]
            await telegram_send_message(chat_id, "Today's tasks:\n" + "\n".join(lines))
    elif text.lower() == "/help":
        await telegram_send_message(
            chat_id,
            "/task <title> \u2014 create a task\n/tasks \u2014 list today's tasks\n/help \u2014 show commands",
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
