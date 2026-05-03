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

app = FastAPI(title="CommandCenter API", redirect_slashes=False)

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

_CT = ZoneInfo("America/Chicago")
_UTC = ZoneInfo("UTC")

def _today_ct() -> date:
    return datetime.now(_CT).date()

def _ct_midnight_as_utc() -> datetime:
    midnight_ct = datetime.now(_CT).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_ct.astimezone(_UTC).replace(tzinfo=None)

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
    old_pw = data.get("old_password", "")
    new_pw = data.get("new_password", "")
    if not user.check_password(old_pw):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    user.set_password(new_pw)
    session.add(user)
    session.commit()
    return {"detail": "Password updated"}

@app.get("/")
async def root():
    return {"status": "CommandCenter API running"}

@app.get("/health")
async def health():
    return {"status": "ok"}

# ── Tasks ────────────────────────────────────────────────────────────────────

@app.get("/tasks", response_model=List[TaskResponse])
@app.get("/tasks/", response_model=List[TaskResponse], include_in_schema=False)
async def list_tasks(
    status: Optional[str] = None,
    project_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(Task).where(Task.user_id == user.id)
    if status:
        statuses = [s.strip() for s in status.split(",")]
        if len(statuses) == 1:
            q = q.where(Task.status == statuses[0])
        else:
            q = q.where(Task.status.in_(statuses))
    if project_id:
        q = q.where(Task.project_id == project_id)
    q = q.order_by(Task.sort_order.asc(), Task.created_at.desc())
    rows = session.execute(q).scalars().all()
    return [_task_to_dict(t) for t in rows]

@app.post("/tasks", response_model=TaskResponse)
@app.post("/tasks/", response_model=TaskResponse, include_in_schema=False)
async def create_task(
    data: TaskCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    fs = calc_focus_score(data.importance or 3, data.difficulty or 3)
    task = Task(
        title=data.title, description=data.description, notes=data.notes,
        status=data.status or "backlog", priority=data.priority or "medium",
        importance=data.importance or 3, difficulty=data.difficulty or 3,
        focus_score=fs, due_date=data.due_date,
        time_estimate_minutes=data.time_estimate_minutes,
        project_id=data.project_id, parent_id=data.parent_id,
        category_id=data.category_id, tag_ids=tags_to_str(data.tag_ids),
        show_in_daily=data.show_in_daily if data.show_in_daily is not None else True,
        user_id=user.id,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    ).scalar()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_dict(task)

@app.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: int,
    data: TaskUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    ).scalar()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    patch = data.model_dump(exclude_unset=True)
    if "tag_ids" in patch:
        patch["tag_ids"] = tags_to_str(patch["tag_ids"])
    if "importance" in patch or "difficulty" in patch:
        imp = patch.get("importance", task.importance) or 3
        dif = patch.get("difficulty", task.difficulty) or 3
        patch["focus_score"] = calc_focus_score(imp, dif)
    if patch.get("status") == "done" and not task.completed_at:
        patch["completed_at"] = datetime.utcnow()
    elif patch.get("status") != "done":
        patch["completed_at"] = None
    for k, v in patch.items():
        setattr(task, k, v)
    task.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.delete("/tasks/{task_id}")
async def delete_task(
    task_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    ).scalar()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
    session.commit()
    return {"detail": "deleted"}

@app.post("/tasks/reorder")
async def reorder_tasks(
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    order: list = data.get("order", [])
    for idx, task_id in enumerate(order):
        task = session.execute(
            select(Task).where(Task.id == task_id, Task.user_id == user.id)
        ).scalar()
        if task:
            task.sort_order = idx
    session.commit()
    return {"detail": "reordered"}

# ── Projects ─────────────────────────────────────────────────────────────────

@app.get("/projects", response_model=List[ProjectResponse])
@app.get("/projects/", response_model=List[ProjectResponse], include_in_schema=False)
async def list_projects(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Project).where(Project.user_id == user.id).order_by(Project.created_at.desc())
    ).scalars().all()
    result = []
    for p in rows:
        d = _project_to_dict(p)
        tasks = session.execute(
            select(Task).where(Task.project_id == p.id, Task.user_id == user.id)
        ).scalars().all()
        d["tasks"] = [_task_to_dict(t) for t in tasks]
        d["task_count"] = len(tasks)
        done = sum(1 for t in tasks if t.status == "done")
        d["completion_percentage"] = int((done / len(tasks) * 100) if tasks else 0)
        result.append(d)
    return result

@app.post("/projects", response_model=ProjectResponse)
@app.post("/projects/", response_model=ProjectResponse, include_in_schema=False)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    proj = Project(
        title=data.title, description=data.description,
        status=data.status or "active", color=data.color or "#4A90D9",
        priority=data.priority or "medium", due_date=data.due_date,
        user_id=user.id,
    )
    session.add(proj)
    session.commit()
    session.refresh(proj)
    return _project_to_dict(proj)

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    proj = session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    ).scalar()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    d = _project_to_dict(proj)
    tasks = session.execute(
        select(Task).where(Task.project_id == project_id, Task.user_id == user.id)
    ).scalars().all()
    d["tasks"] = [_task_to_dict(t) for t in tasks]
    d["task_count"] = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    d["completion_percentage"] = int((done / len(tasks) * 100) if tasks else 0)
    return d

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    proj = session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    ).scalar()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(proj, k, v)
    proj.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(proj)
    return _project_to_dict(proj)

@app.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    proj = session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    ).scalar()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    session.delete(proj)
    session.commit()
    return {"detail": "deleted"}

# ── Habits ───────────────────────────────────────────────────────────────────

@app.get("/habits", response_model=List[HabitResponse])
async def list_habits(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Habit).where(Habit.user_id == user.id).order_by(Habit.created_at)
    ).scalars().all()
    result = []
    today = _today_ct()
    for h in rows:
        # HabitCompletion has no user_id — filter by habit_id + completed_date
        comp_today = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id == h.id,
                HabitCompletion.completed_date == today,
            )
        ).scalar()
        streak = _habit_streak(h.id, session, today)
        total = session.execute(
            select(func.count(HabitCompletion.id)).where(HabitCompletion.habit_id == h.id)
        ).scalar() or 0
        result.append({
            "id": h.id, "title": h.title, "description": h.description,
            "frequency": h.frequency, "target_count": 1,
            "color": h.color, "icon": h.icon,
            "streak": streak, "total_completions": total,
            "completed_today": comp_today is not None,
            "created_at": h.created_at, "updated_at": h.updated_at,
        })
    return result

def _habit_streak(habit_id: str, session: Session, today: date) -> int:
    streak = 0
    check_day = today
    for _ in range(365):
        has = session.execute(
            select(func.count(HabitCompletion.id)).where(
                HabitCompletion.habit_id == habit_id,
                HabitCompletion.completed_date == check_day,
            )
        ).scalar() or 0
        if has:
            streak += 1
            check_day = check_day - timedelta(days=1)
        else:
            break
    return streak

@app.post("/habits", response_model=HabitResponse)
async def create_habit(
    data: HabitCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = Habit(
        title=data.title, description=data.description,
        frequency=data.frequency or "daily",
        color=data.color or "#4A90D9", icon=data.icon or "check",
        user_id=user.id,
    )
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return {
        "id": habit.id, "title": habit.title, "description": habit.description,
        "frequency": habit.frequency, "target_count": 1,
        "color": habit.color, "icon": habit.icon,
        "streak": 0, "total_completions": 0, "completed_today": False,
        "created_at": habit.created_at, "updated_at": habit.updated_at,
    }

@app.patch("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit(
    habit_id: int,
    data: HabitUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(habit, k, v)
    habit.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(habit)
    today = _today_ct()
    comp_today = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit.id,
            HabitCompletion.completed_date == today,
        )
    ).scalar()
    streak = _habit_streak(habit.id, session, today)
    total = session.execute(
        select(func.count(HabitCompletion.id)).where(HabitCompletion.habit_id == habit.id)
    ).scalar() or 0
    return {
        "id": habit.id, "title": habit.title, "description": habit.description,
        "frequency": habit.frequency, "target_count": 1,
        "color": habit.color, "icon": habit.icon,
        "streak": streak, "total_completions": total,
        "completed_today": comp_today is not None,
        "created_at": habit.created_at, "updated_at": habit.updated_at,
    }

@app.delete("/habits/{habit_id}")
async def delete_habit(
    habit_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    session.delete(habit)
    session.commit()
    return {"detail": "deleted"}

@app.post("/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    today = _today_ct()
    existing = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == today,
        )
    ).scalar()
    if existing:
        session.delete(existing)
        session.commit()
        return {"completed": False}
    comp = HabitCompletion(habit_id=habit_id, completed_date=today)
    session.add(comp)
    session.commit()
    streak = _habit_streak(habit_id, session, today)
    return {"completed": True, "streak": streak}

# ── Time Entries ─────────────────────────────────────────────────────────────
# Real columns: id, user_id, task_id, habit_id, started_at, ended_at, note, created_at
# duration_seconds is a @property — NOT a DB column

def _time_entry_to_dict(e: TimeEntry) -> dict:
    duration_secs = e.duration_seconds if e.ended_at else None
    return {
        "id": e.id,
        "task_id": e.task_id,
        "habit_id": e.habit_id,
        "description": e.note,
        "started_at": e.started_at,
        "ended_at": e.ended_at,
        "duration_minutes": round(duration_secs / 60) if duration_secs else None,
        "duration_seconds": duration_secs,
        "user_id": e.user_id,
        "created_at": e.created_at,
    }

@app.get("/time-entries", response_model=List[TimeEntryResponse])
@app.get("/time-entries/", response_model=List[TimeEntryResponse], include_in_schema=False)
async def list_time_entries(
    task_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(TimeEntry).where(TimeEntry.user_id == user.id)
    if task_id:
        q = q.where(TimeEntry.task_id == task_id)
    q = q.order_by(TimeEntry.started_at.desc())
    rows = session.execute(q).scalars().all()
    return [_time_entry_to_dict(e) for e in rows]

@app.get("/time-entries/active")
@app.get("/time-entries/active/", include_in_schema=False)
async def get_active_time_entry(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.ended_at == None,  # noqa: E711
        ).order_by(TimeEntry.started_at.desc())
    ).scalar()
    if not entry:
        return {"active": None}
    return {"active": _time_entry_to_dict(entry)}

@app.post("/time-entries", response_model=TimeEntryResponse)
@app.post("/time-entries/", response_model=TimeEntryResponse, include_in_schema=False)
async def create_time_entry(
    data: TimeEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = TimeEntry(
        task_id=data.task_id,
        note=getattr(data, "description", None) or getattr(data, "note", None),
        started_at=data.started_at or datetime.utcnow(),
        ended_at=data.ended_at,
        user_id=user.id,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _time_entry_to_dict(entry)

# ── Notes ────────────────────────────────────────────────────────────────────
# Real columns: id, user_id, title, content, tags, created_at, updated_at
# Note: NO pinned or color columns in this model

@app.get("/notes", response_model=List[NoteResponse])
async def list_notes(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Note).where(Note.user_id == user.id).order_by(Note.updated_at.desc())
    ).scalars().all()
    return rows

@app.post("/notes", response_model=NoteResponse)
async def create_note(
    data: NoteCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = Note(
        title=data.title,
        content=data.content,
        tags=getattr(data, "tags", None),
        user_id=user.id,
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@app.patch("/notes/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: int,
    data: NoteUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    patch = data.model_dump(exclude_unset=True)
    # drop keys that don't exist on the model
    for k in list(patch.keys()):
        if not hasattr(note, k):
            del patch[k]
    for k, v in patch.items():
        setattr(note, k, v)
    note.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(note)
    return note

@app.delete("/notes/{note_id}")
async def delete_note(
    note_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    session.delete(note)
    session.commit()
    return {"detail": "deleted"}

# ── CRM ──────────────────────────────────────────────────────────────────────
# Real columns: id, user_id, name, email, phone, company, notes,
#               last_contacted, created_at, updated_at
# NO role / relationship_type / tags columns

@app.get("/crm", response_model=List[CRMPersonResponse])
async def list_crm(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(CRMPerson).where(CRMPerson.user_id == user.id).order_by(CRMPerson.name)
    ).scalars().all()
    return rows

@app.post("/crm", response_model=CRMPersonResponse)
async def create_crm(
    data: CRMPersonCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = CRMPerson(
        name=data.name, email=data.email, phone=data.phone,
        company=data.company,
        notes=data.notes,
        user_id=user.id,
    )
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm(
    person_id: int,
    data: CRMPersonUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        select(CRMPerson).where(CRMPerson.id == person_id, CRMPerson.user_id == user.id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    patch = data.model_dump(exclude_unset=True)
    for k in list(patch.keys()):
        if not hasattr(person, k):
            del patch[k]
    for k, v in patch.items():
        setattr(person, k, v)
    person.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(person)
    return person

@app.delete("/crm/{person_id}")
async def delete_crm(
    person_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        select(CRMPerson).where(CRMPerson.id == person_id, CRMPerson.user_id == user.id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    session.delete(person)
    session.commit()
    return {"detail": "deleted"}

# ── Time Blocks ───────────────────────────────────────────────────────────────
# Real columns: id, user_id, title, start_time (DateTime), end_time (DateTime),
#               color, created_at, updated_at
# NO date column — derive from start_time

@app.get("/time-blocks")
@app.get("/time-blocks/", include_in_schema=False)
async def list_time_blocks(
    date: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(TimeBlock).where(TimeBlock.user_id == user.id)
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").date()
            day_start = datetime(day.year, day.month, day.day, 0, 0, 0)
            day_end = datetime(day.year, day.month, day.day, 23, 59, 59)
            q = q.where(TimeBlock.start_time >= day_start, TimeBlock.start_time <= day_end)
        except ValueError:
            pass
    q = q.order_by(TimeBlock.start_time)
    rows = session.execute(q).scalars().all()
    result = []
    for b in rows:
        result.append({
            "id": b.id,
            "title": b.title,
            "date": b.start_time.strftime("%Y-%m-%d") if b.start_time else None,
            "start_time": b.start_time.strftime("%H:%M") if b.start_time else None,
            "end_time": b.end_time.strftime("%H:%M") if b.end_time else None,
            "color": b.color,
            "task_id": None,
            "user_id": b.user_id,
            "created_at": b.created_at,
            "updated_at": b.updated_at,
        })
    return result

@app.post("/time-blocks")
@app.post("/time-blocks/", include_in_schema=False)
async def create_time_block(
    data: TimeBlockCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    # Accept either DateTime objects or "HH:MM" strings combined with a date field
    def _parse_dt(dt_val, date_str, fallback_date):
        if isinstance(dt_val, datetime):
            return dt_val
        if isinstance(dt_val, str):
            try:
                return datetime.fromisoformat(dt_val)
            except ValueError:
                # "HH:MM" + date
                d = date_str or fallback_date
                if isinstance(d, str):
                    d = datetime.strptime(d, "%Y-%m-%d").date()
                h, m = int(dt_val.split(":")[0]), int(dt_val.split(":")[1])
                return datetime(d.year, d.month, d.day, h, m)
        return datetime.utcnow()

    today_str = _today_ct().isoformat()
    date_hint = getattr(data, "date", today_str)
    start = _parse_dt(data.start_time, date_hint, today_str)
    end = _parse_dt(data.end_time, date_hint, today_str)

    block = TimeBlock(
        title=data.title,
        start_time=start,
        end_time=end,
        color=data.color or "#4A90D9",
        user_id=user.id,
    )
    session.add(block)
    session.commit()
    session.refresh(block)
    return {
        "id": block.id, "title": block.title,
        "date": block.start_time.strftime("%Y-%m-%d"),
        "start_time": block.start_time.strftime("%H:%M"),
        "end_time": block.end_time.strftime("%H:%M"),
        "color": block.color, "task_id": None,
        "user_id": block.user_id,
        "created_at": block.created_at, "updated_at": block.updated_at,
    }

@app.patch("/time-blocks/{block_id}")
async def update_time_block(
    block_id: int,
    data: TimeBlockUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(
        select(TimeBlock).where(TimeBlock.id == block_id, TimeBlock.user_id == user.id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404, detail="Time block not found")
    patch = data.model_dump(exclude_unset=True)
    for k in list(patch.keys()):
        if not hasattr(block, k):
            del patch[k]
    for k, v in patch.items():
        setattr(block, k, v)
    session.commit()
    session.refresh(block)
    return {
        "id": block.id, "title": block.title,
        "date": block.start_time.strftime("%Y-%m-%d") if block.start_time else None,
        "start_time": block.start_time.strftime("%H:%M") if block.start_time else None,
        "end_time": block.end_time.strftime("%H:%M") if block.end_time else None,
        "color": block.color, "task_id": None,
        "user_id": block.user_id,
        "created_at": block.created_at, "updated_at": block.updated_at,
    }

@app.delete("/time-blocks/{block_id}")
async def delete_time_block(
    block_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(
        select(TimeBlock).where(TimeBlock.id == block_id, TimeBlock.user_id == user.id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404, detail="Time block not found")
    session.delete(block)
    session.commit()
    return {"detail": "deleted"}

# ── Tags & Categories ─────────────────────────────────────────────────────────

@app.get("/tags", response_model=List[TagResponse])
@app.get("/tags/", response_model=List[TagResponse], include_in_schema=False)
async def list_tags(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Tag).where(Tag.user_id == user.id).order_by(Tag.name)
    ).scalars().all()
    return rows

@app.post("/tags", response_model=TagResponse)
async def create_tag(
    data: TagCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tag = Tag(name=data.name, color=data.color or "#4A90D9", user_id=user.id)
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@app.get("/categories", response_model=List[CategoryResponse])
@app.get("/categories/", response_model=List[CategoryResponse], include_in_schema=False)
async def list_categories(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Category).where(Category.user_id == user.id).order_by(Category.name)
    ).scalars().all()
    return rows

@app.post("/categories", response_model=CategoryResponse)
async def create_category(
    data: CategoryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = Category(name=data.name, color=data.color or "#4A90D9", user_id=user.id)
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat

# ── Braindump ─────────────────────────────────────────────────────────────────
# Real column: raw_text (NOT content)

@app.get("/braindump", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(BraindumpEntry).where(BraindumpEntry.user_id == user.id)
        .order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()
    # Normalize: expose raw_text as content for frontend compatibility
    result = []
    for e in rows:
        result.append({
            "id": e.id,
            "content": e.raw_text,
            "raw_text": e.raw_text,
            "processed": e.processed,
            "user_id": e.user_id,
            "created_at": e.created_at,
        })
    return result

@app.post("/braindump", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    raw = getattr(data, "content", None) or getattr(data, "raw_text", "")
    entry = BraindumpEntry(raw_text=raw, processed=False, user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return {
        "id": entry.id, "content": entry.raw_text, "raw_text": entry.raw_text,
        "processed": entry.processed, "user_id": entry.user_id,
        "created_at": entry.created_at,
    }

@app.patch("/braindump/{entry_id}", response_model=BraindumpEntryResponse)
async def update_braindump(
    entry_id: int,
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        select(BraindumpEntry).where(BraindumpEntry.id == entry_id, BraindumpEntry.user_id == user.id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if "content" in data:
        entry.raw_text = data["content"]
    if "processed" in data:
        entry.processed = data["processed"]
    session.commit()
    session.refresh(entry)
    return {
        "id": entry.id, "content": entry.raw_text, "raw_text": entry.raw_text,
        "processed": entry.processed, "user_id": entry.user_id,
        "created_at": entry.created_at,
    }

@app.delete("/braindump/{entry_id}")
async def delete_braindump(
    entry_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        select(BraindumpEntry).where(BraindumpEntry.id == entry_id, BraindumpEntry.user_id == user.id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    session.delete(entry)
    session.commit()
    return {"detail": "deleted"}

# ── Dashboard ─────────────────────────────────────────────────────────────────

async def _dashboard_data(user: User, session: Session) -> dict:
    today = _today_ct()
    midnight_utc = _ct_midnight_as_utc()

    total_tasks = session.execute(
        select(func.count(Task.id)).where(Task.user_id == user.id)
    ).scalar() or 0

    completed_today = session.execute(
        select(func.count(Task.id)).where(
            Task.user_id == user.id,
            Task.status == "done",
            Task.completed_at >= midnight_utc,
        )
    ).scalar() or 0

    overdue = session.execute(
        select(func.count(Task.id)).where(
            Task.user_id == user.id,
            Task.status != "done",
            Task.due_date < datetime.utcnow(),
            Task.due_date != None,  # noqa: E711
        )
    ).scalar() or 0

    active_projects = session.execute(
        select(func.count(Project.id)).where(
            Project.user_id == user.id, Project.status == "active"
        )
    ).scalar() or 0

    # Habits — HabitCompletion has no user_id; join through Habit
    habits = session.execute(
        select(Habit).where(Habit.user_id == user.id)
    ).scalars().all()

    habit_completions_today = sum(
        1 for h in habits
        if session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id == h.id,
                HabitCompletion.completed_date == today,
            )
        ).scalar() is not None
    )

    # TimeEntry has no duration_minutes column — compute from duration_seconds property
    time_entries_today = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.started_at >= midnight_utc,
        )
    ).scalars().all()
    minutes_logged = sum(
        round(e.duration_seconds / 60) for e in time_entries_today if e.ended_at
    )

    return {
        "total_tasks": total_tasks,
        "completed_today": completed_today,
        "overdue_tasks": overdue,
        "active_projects": active_projects,
        "habits_completed_today": habit_completions_today,
        "total_habits": len(habits),
        "minutes_logged_today": minutes_logged,
    }

@app.get("/dashboard/summary")
async def dashboard_summary(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return await _dashboard_data(user, session)

@app.get("/dashboard")
@app.get("/dashboard/", include_in_schema=False)
async def dashboard_root(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return await _dashboard_data(user, session)

# ── Gamification ──────────────────────────────────────────────────────────────
# HabitCompletion has no user_id — must join through Habit

@app.get("/gamification")
@app.get("/gamification/", include_in_schema=False)
async def gamification(
    limit: int = 90,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    done_tasks = session.execute(
        select(Task).where(Task.user_id == user.id, Task.status == "done")
        .order_by(Task.completed_at.desc())
        .limit(limit)
    ).scalars().all()

    task_xp = sum(max(t.focus_score or 1, 1) for t in done_tasks)

    # Get user's habit IDs first, then query completions
    habit_ids = session.execute(
        select(Habit.id).where(Habit.user_id == user.id)
    ).scalars().all()

    habit_completions_count = 0
    if habit_ids:
        habit_completions_count = session.execute(
            select(func.count(HabitCompletion.id)).where(
                HabitCompletion.habit_id.in_(habit_ids)
            )
        ).scalar() or 0

    habit_xp = habit_completions_count * 10
    total_xp = task_xp + habit_xp

    level = 1
    xp_remaining = total_xp
    while xp_remaining >= level * 100:
        xp_remaining -= level * 100
        level += 1
    xp_for_next = level * 100
    xp_progress = xp_remaining

    # Streak: consecutive days with task completions
    today = _today_ct()
    streak = 0
    check_day = today
    for _ in range(365):
        has_activity = session.execute(
            select(func.count(Task.id)).where(
                Task.user_id == user.id,
                Task.status == "done",
                func.date(Task.completed_at) == check_day,
            )
        ).scalar() or 0
        if not has_activity and habit_ids:
            has_activity = session.execute(
                select(func.count(HabitCompletion.id)).where(
                    HabitCompletion.habit_id.in_(habit_ids),
                    HabitCompletion.completed_date == check_day,
                )
            ).scalar() or 0
        if has_activity:
            streak += 1
            check_day = check_day - timedelta(days=1)
        else:
            break

    recent = [
        {
            "type": "task",
            "title": t.title,
            "xp": max(t.focus_score or 1, 1),
            "completed_at": t.completed_at,
        }
        for t in done_tasks[:10]
    ]

    return {
        "total_xp": total_xp,
        "level": level,
        "xp_progress": xp_progress,
        "xp_for_next": xp_for_next,
        "streak_days": streak,
        "tasks_completed": len(done_tasks),
        "habits_completed": habit_completions_count,
        "recent": recent,
    }

# ── Favorite Teams ────────────────────────────────────────────────────────────

@app.get("/favorite-teams", response_model=List[FavoriteSportsTeamResponse])
async def list_favorite_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(FavoriteSportsTeam).where(FavoriteSportsTeam.user_id == user.id)
    ).scalars().all()
    return rows

@app.post("/favorite-teams", response_model=FavoriteSportsTeamResponse)
async def add_favorite_team(
    data: FavoriteSportsTeamCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = FavoriteSportsTeam(
        sport=data.sport, team_name=data.team_name,
        team_id=getattr(data, "team_id", None), league=data.league,
        user_id=user.id,
    )
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

# ─── MLB Live Data ────────────────────────────────────────────────────────────

_MLB_TEAM_IDS: dict[str, int] = {
    "cardinals": 138, "cubs": 112, "brewers": 158, "reds": 113, "pirates": 134,
    "braves": 144, "mets": 121, "phillies": 143, "marlins": 146, "nationals": 120,
    "dodgers": 119, "giants": 137, "padres": 135, "rockies": 115, "diamondbacks": 109,
    "yankees": 147, "redsox": 111, "bluejays": 141, "orioles": 110, "rays": 139,
    "astros": 117, "athletics": 133, "mariners": 136, "angels": 108, "rangers": 140,
    "twins": 142, "whitesox": 145, "guardians": 114, "tigers": 116, "royals": 118,
}

_TEAM_META: dict[int, tuple] = {
    138: ("STL","St. Louis"),  112: ("CHC","Chicago"),    158: ("MIL","Milwaukee"),
    113: ("CIN","Cincinnati"), 134: ("PIT","Pittsburgh"), 144: ("ATL","Atlanta"),
    121: ("NYM","New York"),   143: ("PHI","Philadelphia"),146:("MIA","Miami"),
    120: ("WSH","Washington"), 119: ("LAD","Los Angeles"),137: ("SF","San Francisco"),
    135: ("SD","San Diego"),   115: ("COL","Denver"),     109: ("ARI","Phoenix"),
    147: ("NYY","New York"),   111: ("BOS","Boston"),     141: ("TOR","Toronto"),
    110: ("BAL","Baltimore"),  139: ("TB","Tampa Bay"),   117: ("HOU","Houston"),
    133: ("OAK","Oakland"),    136: ("SEA","Seattle"),    108: ("LAA","Anaheim"),
    140: ("TEX","Arlington"),  145: ("CHW","Chicago"),    114: ("CLE","Cleveland"),
    116: ("DET","Detroit"),    118: ("KC","Kansas City"), 142: ("MIN","Minneapolis"),
}

_MLB_BASE = "https://statsapi.mlb.com/api/v1"

async def _mlb_get(path: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{_MLB_BASE}{path}")
        r.raise_for_status()
        return r.json()

def _shape_game(g: dict, team_id: int) -> dict:
    away = g.get("teams", {}).get("away", {})
    home = g.get("teams", {}).get("home", {})
    linescore = g.get("linescore", {})
    is_home  = home.get("team", {}).get("id") == team_id
    stl_side = home if is_home else away
    opp_side = away if is_home else home
    opp_id   = opp_side.get("team", {}).get("id", 0)
    opp_abbr, opp_city = _TEAM_META.get(opp_id, ("???", ""))
    abstract = g.get("status", {}).get("abstractGameState", "")
    if abstract == "Final":
        status = "Final"
    elif abstract == "Live":
        status = "Live"
    else:
        status = g.get("status", {}).get("detailedState", "")
    game_date_utc = g.get("gameDate", "")
    game_time_ct = ""
    if game_date_utc:
        try:
            utc_dt = datetime.fromisoformat(game_date_utc.replace("Z", "+00:00"))
            ct_dt  = utc_dt.astimezone(_CT)
            game_time_ct = ct_dt.strftime("%-I:%M %p CT")
        except Exception:
            game_time_ct = game_date_utc
    away_pp = (away.get("probablePitcher") or {}).get("fullName")
    home_pp = (home.get("probablePitcher") or {}).get("fullName")
    return {
        "game_pk":     g.get("gamePk"),
        "status":      status,
        "is_home":     is_home,
        "opp_name":    opp_side.get("team", {}).get("name", ""),
        "opp_abbr":    opp_abbr,
        "city":        opp_city,
        "stl_score":   stl_side.get("score"),
        "opp_score":   opp_side.get("score"),
        "inning":      linescore.get("currentInning"),
        "inning_half": linescore.get("inningHalf"),
        "outs":        linescore.get("outs"),
        "balls":       linescore.get("balls"),
        "strikes":     linescore.get("strikes"),
        "stl_pitcher": home_pp if is_home else away_pp,
        "opp_pitcher": away_pp if is_home else home_pp,
        "game_time":   game_time_ct,
        "venue":       g.get("venue", {}).get("name", ""),
        "date_label":  (g.get("officialDate") or game_date_utc[:10]),
    }

@app.get("/sports/mlb/{team_slug}")
async def mlb_team_today(
    team_slug: str,
    user: User = Depends(get_current_user),
):
    team_id = _MLB_TEAM_IDS.get(team_slug.lower())
    if not team_id:
        raise HTTPException(status_code=404, detail=f"Unknown team slug: {team_slug}")
    today_str  = datetime.now(_CT).strftime("%Y-%m-%d")
    window_end = (datetime.now(_CT) + timedelta(days=7)).strftime("%Y-%m-%d")
    try:
        sched = await _mlb_get(
            f"/schedule?sportId=1&teamId={team_id}"
            f"&startDate={today_str}&endDate={window_end}"
            f"&hydrate=linescore,probablePitcher"
        )
        today_games, future_games = [], []
        for date_entry in sched.get("dates", []):
            for g in date_entry.get("games", []):
                shaped = _shape_game(g, team_id)
                if date_entry.get("date") == today_str:
                    today_games.append(shaped)
                else:
                    future_games.append(shaped)
        current_game = next(
            (g for g in today_games if g["status"] in ("Live", "Final")),
            today_games[0] if today_games else None
        )
        next_game = future_games[0] if future_games else None
        standings_data = await _mlb_get(
            "/standings?leagueId=104&season=2026&standingsTypes=regularSeason"
        )
        nl_central = []
        for record in standings_data.get("records", []):
            if record.get("division", {}).get("id") == 205:
                for tr in record.get("teamRecords", []):
                    tid  = tr.get("team", {}).get("id", 0)
                    abbr, _ = _TEAM_META.get(tid, ("???", ""))
                    splits  = tr.get("records", {}).get("splitRecords", [])
                    last10  = next(
                        (f"{s['wins']}-{s['losses']}" for s in splits if s.get("type") == "lastTen"),
                        ""
                    )
                    nl_central.append({
                        "team_id":  tid,
                        "abbr":     abbr,
                        "full":     tr.get("team", {}).get("name", ""),
                        "teamName": tr.get("team", {}).get("name", ""),
                        "wl":       f"{tr.get('wins',0)}-{tr.get('losses',0)}",
                        "pct":      tr.get("winningPercentage", ".000"),
                        "gb":       str(tr.get("gamesBack", "0")),
                        "strk":     tr.get("streak", {}).get("streakCode", ""),
                        "l10":      last10,
                        "cards":    tid == 138,
                    })
                break
        return {
            "team_id":      team_id,
            "team_slug":    team_slug,
            "date":         today_str,
            "current_game": current_game,
            "next_game":    next_game,
            "nl_central":   nl_central,
        }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MLB API error: {e}")

@app.get("/sports/mlb/{team_slug}/projections")
async def mlb_team_projections(
    team_slug: str,
    user: User = Depends(get_current_user),
):
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            r = await client.get(
                "https://www.fangraphs.com/api/playoff-odds/odds"
                "?dateEnd=yesterday&dateDelta=0&odds=div,wc,league,world&teamIds=",
                headers={"Accept": "application/json"}
            )
            r.raise_for_status()
            rows = r.json()
        team_row = next(
            (row for row in (rows if isinstance(rows, list) else [])
             if row.get("Abbreviation") in {"STL", "Cardinals"}
             or "Cardinals" in str(row.get("Team", ""))),
            None
        )
        if team_row:
            def pct(v):
                try:
                    f = float(v)
                    return round(f * 100, 1) if f <= 1.0 else round(f, 1)
                except Exception:
                    return None
            wins   = team_row.get("W") or team_row.get("Wins")
            losses = team_row.get("L") or team_row.get("Losses")
            return {
                "proj_wins":   round(float(wins)) if wins else None,
                "playoff_pct": pct(team_row.get("Playoffs") or team_row.get("PlayoffOdds")),
                "div_pct":     pct(team_row.get("Division")),
                "wc_pct":      pct(team_row.get("WildCard") or team_row.get("WC")),
                "ws_pct":      pct(team_row.get("WorldSeries") or team_row.get("WS")),
                "best":        f"{int(wins)}-{int(losses)}" if wins and losses else None,
                "record":      f"{int(wins)}-{int(losses)}" if wins and losses else None,
            }
    except Exception:
        pass
    return {"proj_wins": None, "playoff_pct": None, "div_pct": None,
            "wc_pct": None, "ws_pct": None, "best": None, "record": None}

# ─── Telegram Webhook ────────────────────────────────────────────────────────
@app.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram not configured")
    body = await request.json()
    message = body.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    text    = message.get("text", "")
    user_id_tg = str(message.get("from", {}).get("id", ""))
    if not chat_id or not text:
        return {"ok": True}
    if TELEGRAM_OWNER_USER_ID and user_id_tg != TELEGRAM_OWNER_USER_ID:
        await telegram_send_message(chat_id, "Unauthorized.")
        return {"ok": True}
    if text.strip().lower().startswith("/task"):
        async with db.get_session_context() as session:
            users = session.execute(select(User)).scalars().all()
            if not users:
                await telegram_send_message(chat_id, "No users found in the system.")
                return {"ok": True}
            user = users[0]
            try:
                task_data = parse_telegram_task(text)
            except ValueError as e:
                await telegram_send_message(chat_id, str(e))
                return {"ok": True}
            fs = calc_focus_score(task_data["importance"], task_data["difficulty"])
            task = Task(
                title=task_data["title"], status=task_data["status"],
                priority=task_data["priority"], importance=task_data["importance"],
                difficulty=task_data["difficulty"], focus_score=fs,
                notes=task_data["notes"], user_id=user.id,
            )
            session.add(task)
            session.commit()
            await telegram_send_message(chat_id, f"Task created: {task_data['title']}")
    elif text.strip().lower() == "/tasks":
        async with db.get_session_context() as session:
            users = session.execute(select(User)).scalars().all()
            if not users:
                await telegram_send_message(chat_id, "No users found.")
                return {"ok": True}
            user = users[0]
            tasks = session.execute(
                select(Task).where(Task.user_id == user.id, Task.status == "today")
                .order_by(Task.sort_order, Task.created_at.desc()).limit(10)
            ).scalars().all()
            if not tasks:
                await telegram_send_message(chat_id, "No tasks for today.")
            else:
                lines = [f"{t.id}. {t.title} [{t.priority}]" for t in tasks]
                await telegram_send_message(chat_id, "Today's tasks:\n" + "\n".join(lines))
    else:
        await telegram_send_message(chat_id, "Commands: /task <title>, /tasks")
    return {"ok": True}

@app.get("/telegram/set-webhook")
async def set_telegram_webhook(user: User = Depends(get_current_user)):
    if not TELEGRAM_BOT_TOKEN or not PUBLIC_BACKEND_URL:
        raise HTTPException(status_code=503, detail="Telegram or PUBLIC_BACKEND_URL not configured")
    webhook_url = f"{PUBLIC_BACKEND_URL}/telegram/webhook"
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
            json={"url": webhook_url},
        )
    return r.json()
