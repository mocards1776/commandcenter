from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, func, cast, Numeric
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
@app.get("/tasks/{task_id}/", response_model=TaskResponse, include_in_schema=False)
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
@app.patch("/tasks/{task_id}/", response_model=TaskResponse, include_in_schema=False)
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
@app.delete("/tasks/{task_id}/", include_in_schema=False)
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
@app.get("/projects/{project_id}/", response_model=ProjectResponse, include_in_schema=False)
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
@app.patch("/projects/{project_id}/", response_model=ProjectResponse, include_in_schema=False)
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
@app.delete("/projects/{project_id}/", include_in_schema=False)
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
@app.patch("/habits/{habit_id}/", response_model=HabitResponse, include_in_schema=False)
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
@app.delete("/habits/{habit_id}/", include_in_schema=False)
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
@app.post("/habits/{habit_id}/complete/", include_in_schema=False)
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
@app.patch("/notes/{note_id}/", response_model=NoteResponse, include_in_schema=False)
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
@app.delete("/notes/{note_id}/", include_in_schema=False)
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
@app.patch("/crm/{person_id}/", response_model=CRMPersonResponse, include_in_schema=False)
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
@app.delete("/crm/{person_id}/", include_in_schema=False)
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

# ── Tags ─────────────────────────────────────────────────────────────────────

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

@app.delete("/tags/{tag_id}")
@app.delete("/tags/{tag_id}/", include_in_schema=False)
async def delete_tag(
    tag_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tag = session.execute(
        select(Tag).where(Tag.id == tag_id, Tag.user_id == user.id)
    ).scalar()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    session.delete(tag)
    session.commit()
    return {"detail": "deleted"}

# ── Categories ───────────────────────────────────────────────────────────────

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

@app.delete("/categories/{cat_id}")
@app.delete("/categories/{cat_id}/", include_in_schema=False)
async def delete_category(
    cat_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = session.execute(
        select(Category).where(Category.id == cat_id, Category.user_id == user.id)
    ).scalar()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    session.delete(cat)
    session.commit()
    return {"detail": "deleted"}

# ── Time Blocks ───────────────────────────────────────────────────────────────

@app.get("/time-blocks", response_model=List[TimeBlockResponse])
async def list_time_blocks(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(TimeBlock).where(TimeBlock.user_id == user.id).order_by(TimeBlock.start_time)
    ).scalars().all()
    return rows

@app.post("/time-blocks", response_model=TimeBlockResponse)
async def create_time_block(
    data: TimeBlockCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = TimeBlock(
        title=data.title, start_time=data.start_time, end_time=data.end_time,
        task_id=data.task_id, color=data.color or "#4A90D9", user_id=user.id,
    )
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.patch("/time-blocks/{block_id}", response_model=TimeBlockResponse)
@app.patch("/time-blocks/{block_id}/", response_model=TimeBlockResponse, include_in_schema=False)
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
        raise HTTPException(status_code=404, detail="TimeBlock not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(block, k, v)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/time-blocks/{block_id}")
@app.delete("/time-blocks/{block_id}/", include_in_schema=False)
async def delete_time_block(
    block_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(
        select(TimeBlock).where(TimeBlock.id == block_id, TimeBlock.user_id == user.id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404, detail="TimeBlock not found")
    session.delete(block)
    session.commit()
    return {"detail": "deleted"}

# ── Braindump ─────────────────────────────────────────────────────────────────

@app.get("/braindump", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(BraindumpEntry).where(BraindumpEntry.user_id == user.id)
        .order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()
    return rows

@app.post("/braindump", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = BraindumpEntry(content=data.content, user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.delete("/braindump/{entry_id}")
@app.delete("/braindump/{entry_id}/", include_in_schema=False)
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

# ── Favorite Sports Teams ─────────────────────────────────────────────────────

@app.get("/sports/favorites", response_model=List[FavoriteSportsTeamResponse])
async def list_favorite_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(FavoriteSportsTeam).where(FavoriteSportsTeam.user_id == user.id)
    ).scalars().all()
    return rows

@app.post("/sports/favorites", response_model=FavoriteSportsTeamResponse)
async def add_favorite_team(
    data: FavoriteSportsTeamCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = FavoriteSportsTeam(
        team_id=data.team_id, team_name=data.team_name,
        sport=data.sport, league=data.league,
        user_id=user.id,
    )
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

@app.delete("/sports/favorites/{team_id}")
@app.delete("/sports/favorites/{team_id}/", include_in_schema=False)
async def remove_favorite_team(
    team_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = session.execute(
        select(FavoriteSportsTeam).where(
            FavoriteSportsTeam.id == team_id, FavoriteSportsTeam.user_id == user.id
        )
    ).scalar()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    session.delete(team)
    session.commit()
    return {"detail": "deleted"}

# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/dashboard")
@app.get("/dashboard/", include_in_schema=False)
async def get_dashboard(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    midnight_utc = _ct_midnight_as_utc()

    today_tasks = session.execute(
        select(Task).where(
            Task.user_id == user.id,
            Task.status.in_(["today", "in_progress"]),
        )
    ).scalars().all()

    overdue_tasks = session.execute(
        select(Task).where(
            Task.user_id == user.id,
            Task.due_date < midnight_utc,
            Task.status.notin_(["done", "cancelled"]),
        )
    ).scalars().all()

    habits = session.execute(
        select(Habit).where(Habit.user_id == user.id)
    ).scalars().all()

    today_habit_data = []
    for h in habits:
        comp = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id == h.id,
                HabitCompletion.completed_date == today,
            )
        ).scalar()
        streak = _habit_streak(h.id, session, today)
        today_habit_data.append({
            "habit": {
                "id": h.id, "title": h.title, "color": h.color,
                "icon": h.icon, "streak": streak,
            },
            "completed": comp is not None,
        })

    active_projects = session.execute(
        select(Project).where(
            Project.user_id == user.id,
            Project.status == "active",
        ).order_by(Project.created_at.desc()).limit(5)
    ).scalars().all()

    project_summaries = []
    for p in active_projects:
        tasks = session.execute(
            select(Task).where(Task.project_id == p.id, Task.user_id == user.id)
        ).scalars().all()
        done = sum(1 for t in tasks if t.status == "done")
        project_summaries.append({
            "id": p.id, "title": p.title, "color": p.color,
            "task_count": len(tasks),
            "completion_percentage": int((done / len(tasks) * 100) if tasks else 0),
        })

    time_entries_today = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.started_at >= midnight_utc,
            TimeEntry.ended_at != None,  # noqa: E711
        )
    ).scalars().all()

    time_today = sum(
        int((e.ended_at - e.started_at).total_seconds())
        for e in time_entries_today
        if e.ended_at and e.started_at
    )

    total_tasks = session.execute(
        select(func.count(Task.id)).where(Task.user_id == user.id)
    ).scalar() or 0
    done_tasks = session.execute(
        select(func.count(Task.id)).where(Task.user_id == user.id, Task.status == "done")
    ).scalar() or 0

    return {
        "today_tasks": [_task_to_dict(t) for t in today_tasks],
        "overdue_tasks": [_task_to_dict(t) for t in overdue_tasks],
        "today_habits": today_habit_data,
        "active_projects": project_summaries,
        "time_tracked_today_seconds": time_today,
        "stats": {
            "total_tasks": total_tasks,
            "done_tasks": done_tasks,
            "completion_rate": round((done_tasks / total_tasks * 100) if total_tasks else 0, 1),
            "habits_completed_today": sum(1 for h in today_habit_data if h["completed"]),
            "habits_total": len(today_habit_data),
        },
    }

# ── Gamification ──────────────────────────────────────────────────────────────

@app.get("/gamification")
@app.get("/gamification/", include_in_schema=False)
async def get_gamification(
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    done_tasks = session.execute(
        select(func.count(Task.id)).where(Task.user_id == user.id, Task.status == "done")
    ).scalar() or 0

    total_completions = session.execute(
        select(func.count(HabitCompletion.id)).join(
            Habit, HabitCompletion.habit_id == Habit.id
        ).where(Habit.user_id == user.id)
    ).scalar() or 0

    xp = done_tasks * 10 + total_completions * 5
    level = max(1, xp // 100)

    recent_completions = session.execute(
        select(Task).where(Task.user_id == user.id, Task.status == "done")
        .order_by(Task.completed_at.desc()).limit(limit)
    ).scalars().all()

    return {
        "xp": xp,
        "level": level,
        "xp_to_next_level": (level + 1) * 100 - xp,
        "tasks_completed": done_tasks,
        "habits_completed": total_completions,
        "recent_completions": [_task_to_dict(t) for t in recent_completions],
        "badges": [],
    }

# ── Telegram Webhook ──────────────────────────────────────────────────────────

@app.post("/telegram/webhook")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    message = body.get("message") or body.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "").strip()
    if not chat_id or not text:
        return {"ok": True}

    if not text.lower().startswith("/task"):
        await telegram_send_message(chat_id, "Send /task <title> to create a task.")
        return {"ok": True}

    owner_id_str = TELEGRAM_OWNER_USER_ID.strip()
    if not owner_id_str:
        await telegram_send_message(chat_id, "Bot not configured (no owner user ID).")
        return {"ok": True}

    try:
        owner_db_id = int(owner_id_str)
    except ValueError:
        await telegram_send_message(chat_id, "Bot misconfigured.")
        return {"ok": True}

    user = session.execute(select(User).where(User.id == owner_db_id)).scalar()
    if not user:
        await telegram_send_message(chat_id, "Owner account not found.")
        return {"ok": True}

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
        show_in_daily=True,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    await telegram_send_message(
        chat_id,
        f"✅ Task created: \"{task.title}\" (priority: {task.priority}, status: {task.status})"
    )
    return {"ok": True}
