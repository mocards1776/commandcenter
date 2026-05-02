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

# CORS
# allow_origins=["*"] + allow_credentials=True is illegal — browsers reject it.
# Use an explicit list of allowed origins instead.
ALLOWED_ORIGINS = [
    "https://command-center-flax-gamma.vercel.app",
    "https://command-center-git-main-mocards1776s-projects.vercel.app",
    # Allow any Vercel preview deploy for this project
    "https://command-center-mocards1776s-projects.vercel.app",
    # Local dev
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

# Run schema migrations + ownership backfill on startup
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
    """Restrict a query to the current user's rows."""
    return query.where(model.user_id == user.id)

def _own_or_legacy(query, model, user: User):
    """
    For shared lookup tables (tags, categories) where legacy NULL-owner rows
    might still exist: return the user's rows OR rows with no owner.
    """
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
        "title": raw,
        "status": status,
        "priority": priority,
        "importance": importance,
        "difficulty": difficulty,
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
    # Reattach to session
    fresh = session.execute(select(User).where(User.id == user.id)).scalar()
    fresh.set_password(new)
    session.commit()
    # Issue a new token so the client can swap immediately
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
    for key, value in updates.items():
        setattr(task, key, value)
    if updates.get("status") == "done" and not task.completed_at:
        task.completed_at = datetime.utcnow()
    task.focus_score = calc_focus_score(task.importance, task.difficulty)
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
    session.query(TimeEntry).filter(TimeEntry.task_id == task_id).update({TimeEntry.task_id: None})
    children = session.execute(
        _own(select(Task), Task, user).where(Task.parent_id == task_id)
    ).scalars().all()
    for child in children:
        session.query(TimeEntry).filter(TimeEntry.task_id == child.id).update({TimeEntry.task_id: None})
        session.delete(child)
    session.delete(task)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete task: {e}")
    return {"ok": True}

@app.post("/tasks/{task_id}/complete", response_model=TaskResponse)
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

@app.post("/tasks/reorder")
async def reorder_tasks(
    ids: List[str],
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    for idx, task_id in enumerate(ids):
        task = session.execute(_own(select(Task), Task, user).where(Task.id == task_id)).scalar()
        if task:
            task.sort_order = idx
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
    projects = session.execute(query.order_by(Project.created_at.desc())).scalars().all()
    result = []
    for p in projects:
        proj_tasks = session.execute(
            _own(select(Task), Task, user).where(Task.project_id == p.id)
        ).scalars().all()
        total = len(proj_tasks)
        done = sum(1 for t in proj_tasks if t.status == "done")
        pct = int((done / total) * 100) if total else 0
        result.append({
            "id": p.id,
            "title": p.title,
            "description": p.description,
            "status": p.status,
            "color": p.color,
            "due_date": p.due_date,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in proj_tasks],
            "task_count": total,
            "completion_percentage": pct,
        })
    return result

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
    return {
        "id": project.id, "title": project.title, "description": project.description,
        "status": project.status, "color": project.color, "due_date": project.due_date,
        "created_at": project.created_at, "updated_at": project.updated_at,
        "tasks": [], "task_count": 0, "completion_percentage": 0,
    }

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(
        _own(select(Project), Project, user).where(Project.id == project_id)
    ).scalar()
    if not project:
        raise HTTPException(status_code=404)
    proj_tasks = session.execute(
        _own(select(Task), Task, user).where(Task.project_id == project_id)
    ).scalars().all()
    total = len(proj_tasks)
    done = sum(1 for t in proj_tasks if t.status == "done")
    pct = int((done / total) * 100) if total else 0
    return {
        "id": project.id, "title": project.title, "description": project.description,
        "status": project.status, "color": project.color, "due_date": project.due_date,
        "created_at": project.created_at, "updated_at": project.updated_at,
        "tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in proj_tasks],
        "task_count": total, "completion_percentage": pct,
    }

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(
        _own(select(Project), Project, user).where(Project.id == project_id)
    ).scalar()
    if not project:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(project, key, value)
    session.commit()
    session.refresh(project)
    proj_tasks = session.execute(
        _own(select(Task), Task, user).where(Task.project_id == project_id)
    ).scalars().all()
    total = len(proj_tasks)
    done = sum(1 for t in proj_tasks if t.status == "done")
    pct = int((done / total) * 100) if total else 0
    return {
        "id": project.id, "title": project.title, "description": project.description,
        "status": project.status, "color": project.color, "due_date": project.due_date,
        "created_at": project.created_at, "updated_at": project.updated_at,
        "tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in proj_tasks],
        "task_count": total, "completion_percentage": pct,
    }

@app.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(
        _own(select(Project), Project, user).where(Project.id == project_id)
    ).scalar()
    if not project:
        raise HTTPException(status_code=404)
    session.delete(project)
    session.commit()
    return {"ok": True}

# ─── Habits ──────────────────────────────────────────────────────────
def _serialize_habit(h: Habit, comps: List[HabitCompletion]) -> dict:
    return {
        "id": h.id, "name": h.title, "color": h.color,
        "icon": getattr(h, "icon", None), "frequency": h.frequency,
        "time_hour": getattr(h, "time_hour", None),
        "time_minute": getattr(h, "time_minute", None),
        "sort_order": getattr(h, "sort_order", 0),
        "is_active": getattr(h, "is_active", True),
        "completions": [
            {"id": c.id, "habit_id": c.habit_id,
             "completed_date": c.completed_date.isoformat() if c.completed_date else None,
             "created_at": c.created_at.isoformat() if c.created_at else None}
            for c in comps
        ],
        "description": getattr(h, "description", None),
        "custom_days": None,
        "target_minutes": getattr(h, "target_minutes", None),
        "created_at": h.created_at, "updated_at": h.updated_at,
    }

@app.get("/habits/")
async def list_habits(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habits = session.execute(
        _own(select(Habit), Habit, user).order_by(Habit.sort_order)
    ).scalars().all()
    result = []
    for h in habits:
        comps = session.execute(
            select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
        ).scalars().all()
        result.append(_serialize_habit(h, comps))
    return result

@app.post("/habits/")
async def create_habit(
    data: HabitCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    d = data.dict()
    habit = Habit(
        title=d["name"], color=d.get("color", "#e8a820"),
        icon=d.get("icon"), frequency=d.get("frequency", "daily"),
        time_hour=d.get("time_hour"), time_minute=d.get("time_minute"),
        sort_order=d.get("sort_order", 0), is_active=d.get("is_active", True),
    )
    habit.user_id = user.id
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return _serialize_habit(habit, [])

@app.patch("/habits/{habit_id}")
async def update_habit(
    habit_id: str,
    data: HabitUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        _own(select(Habit), Habit, user).where(Habit.id == habit_id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    if "name" in updates:
        habit.title = updates.pop("name")
    for key, value in updates.items():
        setattr(habit, key, value)
    session.commit()
    session.refresh(habit)
    comps = session.execute(
        select(HabitCompletion).where(HabitCompletion.habit_id == habit.id)
    ).scalars().all()
    return _serialize_habit(habit, comps)

@app.delete("/habits/{habit_id}")
async def delete_habit(
    habit_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        _own(select(Habit), Habit, user).where(Habit.id == habit_id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    session.query(HabitCompletion).filter(HabitCompletion.habit_id == habit_id).delete()
    session.delete(habit)
    session.commit()
    return {"ok": True}

@app.post("/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    # Confirm habit ownership
    habit = session.execute(
        _own(select(Habit), Habit, user).where(Habit.id == habit_id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    completed_date_str = data.get("completed_date")
    if not completed_date_str:
        raise HTTPException(status_code=400, detail="completed_date required")
    try:
        completed_date = datetime.fromisoformat(completed_date_str).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    existing = session.execute(
        select(HabitCompletion).where(
            (HabitCompletion.habit_id == habit_id) &
            (HabitCompletion.completed_date == completed_date)
        )
    ).scalar()
    if existing:
        return {"ok": True, "id": existing.id}
    completion = HabitCompletion(
        habit_id=habit_id, completed_date=completed_date, note=data.get("note"),
    )
    session.add(completion)
    session.commit()
    session.refresh(completion)
    return {"ok": True, "id": completion.id}

@app.delete("/habits/{habit_id}/complete/{completed_date}")
async def uncomplete_habit(
    habit_id: str,
    completed_date: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        _own(select(Habit), Habit, user).where(Habit.id == habit_id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    target_date = datetime.fromisoformat(completed_date).date()
    completion = session.execute(
        select(HabitCompletion).where(
            (HabitCompletion.habit_id == habit_id) &
            (HabitCompletion.completed_date == target_date)
        )
    ).scalar()
    if not completion:
        raise HTTPException(status_code=404)
    session.delete(completion)
    session.commit()
    return {"ok": True}

@app.get("/habits/{habit_id}/streak")
async def get_habit_streak(
    habit_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        _own(select(Habit), Habit, user).where(Habit.id == habit_id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    comps = session.execute(
        select(HabitCompletion)
        .where(HabitCompletion.habit_id == habit_id)
        .order_by(HabitCompletion.completed_date.desc())
    ).scalars().all()
    if not comps:
        return {"habit_id": habit_id, "streak": 0}
    dates = sorted({c.completed_date for c in comps}, reverse=True)
    streak = 0
    check = _today_ct()
    for d in dates:
        if d == check:
            streak += 1
            check -= timedelta(days=1)
        elif d == check - timedelta(days=1):
            check = d
            streak += 1
            check -= timedelta(days=1)
        else:
            break
    return {"habit_id": habit_id, "streak": streak}

# ─── Time Entries ───────────────────────────────────────────────
@app.get("/time-entries/", response_model=List[TimeEntryResponse])
async def list_time_entries(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entries = session.execute(
        _own(select(TimeEntry), TimeEntry, user).order_by(TimeEntry.started_at.desc())
    ).scalars().all()
    return entries

@app.get("/time-entries/active", response_model=Optional[TimeEntryResponse])
async def get_active_timer(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa
    ).scalar()
    return entry

@app.post("/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(
    data: TimeEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    # Stop any existing active timer first
    active = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa
    ).scalar()
    if active:
        active.ended_at = datetime.utcnow()
    entry = TimeEntry(**data.dict())
    entry.user_id = user.id
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/time-entries/{entry_id}/stop", response_model=TimeEntryResponse)
async def stop_timer(
    entry_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.id == entry_id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.ended_at = datetime.fromisoformat(data["ended_at"]) if isinstance(data["ended_at"], str) else data["ended_at"]
    if "note" in data:
        entry.note = data["note"]
    # Update actual_time_minutes on the task
    if entry.task_id:
        task = session.execute(
            _own(select(Task), Task, user).where(Task.id == entry.task_id)
        ).scalar()
        if task:
            delta = entry.ended_at - entry.started_at
            task.actual_time_minutes = (task.actual_time_minutes or 0) + int(delta.total_seconds() / 60)
    session.commit()
    session.refresh(entry)
    return entry

# ─── Notes ─────────────────────────────────────────────────────────────
@app.get("/notes/", response_model=List[NoteResponse])
async def list_notes(
    search: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(Note), Note, user)
    if search:
        query = query.where(Note.content.ilike(f"%{search}%") | Note.title.ilike(f"%{search}%"))
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
    note = session.execute(
        _own(select(Note), Note, user).where(Note.id == note_id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(note, key, value)
    session.commit()
    session.refresh(note)
    return note

@app.delete("/notes/{note_id}")
async def delete_note(
    note_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(
        _own(select(Note), Note, user).where(Note.id == note_id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404)
    session.delete(note)
    session.commit()
    return {"ok": True}

# ─── Tags ──────────────────────────────────────────────────────────────
@app.get("/tags/", response_model=List[TagResponse])
async def list_tags(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tags = session.execute(
        _own_or_legacy(select(Tag), Tag, user).order_by(Tag.name)
    ).scalars().all()
    return tags

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
    tag = session.execute(
        _own(select(Tag), Tag, user).where(Tag.id == tag_id)
    ).scalar()
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
    cats = session.execute(
        _own_or_legacy(select(Category), Category, user).order_by(Category.name)
    ).scalars().all()
    return cats

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

@app.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = session.execute(
        _own(select(Category), Category, user).where(Category.id == category_id)
    ).scalar()
    if not cat:
        raise HTTPException(status_code=404)
    session.delete(cat)
    session.commit()
    return {"ok": True}

# ─── CRM ───────────────────────────────────────────────────────────────
@app.get("/crm/", response_model=List[CRMPersonResponse])
async def list_crm(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    people = session.execute(
        _own(select(CRMPerson), CRMPerson, user).order_by(CRMPerson.name)
    ).scalars().all()
    return people

@app.post("/crm/", response_model=CRMPersonResponse)
async def create_crm(
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

@app.get("/crm/{person_id}", response_model=CRMPersonResponse)
async def get_crm(
    person_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        _own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404)
    return person

@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm(
    person_id: str,
    data: CRMPersonUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        _own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(person, key, value)
    session.commit()
    session.refresh(person)
    return person

@app.delete("/crm/{person_id}")
async def delete_crm(
    person_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        _own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404)
    session.delete(person)
    session.commit()
    return {"ok": True}

@app.post("/crm/{person_id}/contacted", response_model=CRMPersonResponse)
async def mark_contacted(
    person_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        _own(select(CRMPerson), CRMPerson, user).where(CRMPerson.id == person_id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404)
    person.last_contacted = datetime.utcnow()
    session.commit()
    session.refresh(person)
    return person

# ─── Time Blocks ───────────────────────────────────────────────────────
@app.get("/time-blocks/", response_model=List[TimeBlockResponse])
async def list_time_blocks(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    blocks = session.execute(
        _own(select(TimeBlock), TimeBlock, user).order_by(TimeBlock.start_time)
    ).scalars().all()
    return blocks

@app.post("/time-blocks/", response_model=TimeBlockResponse)
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
    block = session.execute(
        _own(select(TimeBlock), TimeBlock, user).where(TimeBlock.id == block_id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(block, key, value)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/time-blocks/{block_id}")
async def delete_time_block(
    block_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(
        _own(select(TimeBlock), TimeBlock, user).where(TimeBlock.id == block_id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404)
    session.delete(block)
    session.commit()
    return {"ok": True}

# ─── Braindump ─────────────────────────────────────────────────────────
@app.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entries = session.execute(
        _own(select(BraindumpEntry), BraindumpEntry, user).order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()
    return entries

@app.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = BraindumpEntry(raw_text=data.raw_text, processed=False)
    entry.user_id = user.id
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/braindump/{entry_id}/process", response_model=BraindumpEntryResponse)
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
    ct_midnight_utc = _ct_midnight_as_utc()

    today_tasks_q = session.execute(
        _own(select(Task), Task, user).where(
            Task.status.in_(["today", "in_progress"]) |
            ((Task.due_date != None) & (Task.due_date <= datetime.combine(today, datetime.max.time())) & (Task.status != "done"))  # noqa
        )
    ).scalars().all()

    completed_today = session.execute(
        _own(select(Task), Task, user).where(
            (Task.status == "done") &
            (Task.completed_at >= ct_midnight_utc)
        )
    ).scalars().all()

    focus_score_today = sum(t.focus_score for t in completed_today)

    active_timer = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa
    ).scalar()

    finished_entries = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(
            (TimeEntry.ended_at != None) &  # noqa
            (TimeEntry.started_at >= ct_midnight_utc)
        )
    ).scalars().all()

    time_tracked_seconds = sum(
        int((e.ended_at - e.started_at).total_seconds()) for e in finished_entries
    )

    # Streak: consecutive days with at least one completed task
    all_completed = session.execute(
        _own(select(Task), Task, user).where(Task.status == "done")
    ).scalars().all()
    completed_dates = {t.completed_at.date() for t in all_completed if t.completed_at}
    streak = 0
    check_day = today
    while check_day in completed_dates:
        streak += 1
        check_day -= timedelta(days=1)

    habits = session.execute(
        _own(select(Habit), Habit, user).where(Habit.is_active == True)  # noqa
    ).scalars().all()
    today_habits_data = []
    completed_habit_count = 0
    for h in habits:
        comp = session.execute(
            select(HabitCompletion).where(
                (HabitCompletion.habit_id == h.id) &
                (HabitCompletion.completed_date == today)
            )
        ).scalar()
        today_habits_data.append({"habit": _serialize_habit(h, [comp] if comp else []), "completed": bool(comp)})
        if comp:
            completed_habit_count += 1

    habit_completion_rate = (completed_habit_count / len(habits) * 100) if habits else 0

    overdue = session.execute(
        _own(select(Task), Task, user).where(
            (Task.due_date < datetime.combine(today, datetime.min.time())) &
            (Task.status != "done")
        )
    ).scalars().all()

    active_projects = session.execute(
        _own(select(Project), Project, user).where(Project.status == "active")
    ).scalars().all()

    return {
        "tasks_today": len(today_tasks_q),
        "completed_today": len(completed_today),
        "focus_score_today": focus_score_today,
        "time_tracked_seconds": time_tracked_seconds,
        "streak_days": streak,
        "today_tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in today_tasks_q],
        "overdue_tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in overdue],
        "today_habits": today_habits_data,
        "active_projects": [{"id": p.id, "title": p.title, "status": p.status, "color": p.color} for p in active_projects],
        "total_tasks_today": len(today_tasks_q),
        "completed_tasks_today": len(completed_today),
        "habit_completion_rate": habit_completion_rate,
        "gamification": None,
    }

# ─── Gamification ──────────────────────────────────────────────────────
@app.get("/gamification/")
async def gamification_history(
    limit: int = Query(30, ge=1, le=365),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    """Return per-day gamification stats for the last `limit` days."""
    today = _today_ct()
    result = []
    for i in range(limit - 1, -1, -1):
        day = today - timedelta(days=i)
        day_start = datetime.combine(day, datetime.min.time())
        day_end   = datetime.combine(day, datetime.max.time())
        completed = session.execute(
            _own(select(Task), Task, user).where(
                (Task.status == "done") &
                (Task.completed_at >= day_start) &
                (Task.completed_at <= day_end)
            )
        ).scalars().all()
        focus = sum(t.focus_score for t in completed)
        entries = session.execute(
            _own(select(TimeEntry), TimeEntry, user).where(
                (TimeEntry.ended_at != None) &  # noqa
                (TimeEntry.started_at >= day_start) &
                (TimeEntry.started_at <= day_end)
            )
        ).scalars().all()
        time_sec = sum(int((e.ended_at - e.started_at).total_seconds()) for e in entries)
        result.append({
            "date": day.isoformat(),
            "tasks_completed": len(completed),
            "focus_score": focus,
            "time_tracked_seconds": time_sec,
            "points": focus + len(completed) * 10,
        })
    return result

# ─── Sports ──────────────────────────────────────────────────────────
@app.get("/sports/favorites/", response_model=List[FavoriteSportsTeamResponse])
async def list_favorite_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    teams = session.execute(
        _own(select(FavoriteSportsTeam), FavoriteSportsTeam, user)
    ).scalars().all()
    return teams

@app.post("/sports/favorites/", response_model=FavoriteSportsTeamResponse)
async def add_favorite_team(
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
async def remove_favorite_team(
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

# ─── Telegram Webhook ────────────────────────────────────────────────
@app.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    session: Session = Depends(db.get_session),
):
    data = await request.json()
    message = data.get("message", {})
    text = message.get("text", "")
    chat_id = message.get("chat", {}).get("id")
    from_id = str(message.get("from", {}).get("id", ""))

    if not chat_id:
        return {"ok": True}

    # Security: only respond to the configured owner
    if TELEGRAM_OWNER_USER_ID and from_id != TELEGRAM_OWNER_USER_ID:
        await telegram_send_message(chat_id, "Unauthorized.")
        return {"ok": True}

    if not text:
        return {"ok": True}

    if text.lower() in ("/start", "/help"):
        await telegram_send_message(
            chat_id,
            f"CommandCenter Bot\n\nCommands:\n/task <title> — create a task\n!/task <title> — create urgent task"
        )
        return {"ok": True}

    if text.lower().startswith("/task"):
        # Find the user by telegram owner ID mapping — for now use the first user
        # (single-user deployment assumption)
        user = session.execute(select(User)).scalar()
        if not user:
            await telegram_send_message(chat_id, "No users found in the system.")
            return {"ok": True}
        try:
            task_data = parse_telegram_task(text)
            task_data["focus_score"] = calc_focus_score(task_data["importance"], task_data["difficulty"])
            task_data["tag_ids"] = ""
            task = Task(**task_data)
            task.user_id = user.id
            session.add(task)
            session.commit()
            await telegram_send_message(
                chat_id,
                f"✅ Task created: {task.title}\nPriority: {task.priority} | Status: {task.status}"
            )
        except ValueError as e:
            await telegram_send_message(chat_id, f"❌ {e}")
        return {"ok": True}

    await telegram_send_message(chat_id, f"Unknown command. Send /help for available commands.")
    return {"ok": True}
