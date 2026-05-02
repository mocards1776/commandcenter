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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

# ─── Time Entries ─────────────────────────────────────────────────────
@app.get("/time-entries/active", response_model=Optional[TimeEntryResponse])
async def get_active_timer(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(
        _own(select(TimeEntry), TimeEntry, user)
        .where(TimeEntry.ended_at == None)  # noqa: E711
        .order_by(TimeEntry.started_at.desc())
    ).scalar()

@app.post("/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(
    data: TimeEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    existing = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.ended_at == None)  # noqa: E711
    ).scalar()
    if existing:
        existing.ended_at = datetime.utcnow()
        session.commit()
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
    entry.ended_at = datetime.fromisoformat(data["ended_at"])
    if "note" in data:
        entry.note = data["note"]
    session.commit()
    session.refresh(entry)
    return entry

@app.get("/time-entries/", response_model=List[TimeEntryResponse])
async def list_time_entries(
    task_id: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(TimeEntry), TimeEntry, user)
    if task_id:
        query = query.where(TimeEntry.task_id == task_id)
    return session.execute(query.order_by(TimeEntry.started_at.desc())).scalars().all()

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
    for key, value in data.dict(exclude_unset=True).items():
        setattr(note, key, value)
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
    person.last_contacted = datetime.utcnow().date()
    session.commit()
    session.refresh(person)
    return person

# ─── Time Blocks ──────────────────────────────────────────────────────
@app.get("/time-blocks/", response_model=List[TimeBlockResponse])
async def list_time_blocks(
    date: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    query = _own(select(TimeBlock), TimeBlock, user)
    return session.execute(query.order_by(TimeBlock.start_time)).scalars().all()

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

# ─── Braindump ────────────────────────────────────────────────────────
@app.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(
        _own(select(BraindumpEntry), BraindumpEntry, user)
        .order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()

@app.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = BraindumpEntry(raw_text=data.raw_text)
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

# ─── Dashboard ────────────────────────────────────────────────────────
@app.get("/dashboard/")
async def get_dashboard(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    ct_midnight = _ct_midnight_as_utc()

    today_tasks = session.execute(
        _own(select(Task), Task, user).where(Task.status.in_(["today", "in_progress"]))
    ).scalars().all()

    completed_today = session.execute(
        _own(select(Task), Task, user).where(
            (Task.status == "done") & (Task.completed_at >= ct_midnight)
        )
    ).scalars().all()

    time_entries = session.execute(
        _own(select(TimeEntry), TimeEntry, user).where(TimeEntry.started_at >= ct_midnight)
    ).scalars().all()

    total_seconds = 0
    for entry in time_entries:
        end = entry.ended_at or datetime.utcnow()
        total_seconds += int((end - entry.started_at).total_seconds())

    focus_score_today = sum(t.focus_score for t in completed_today if t.focus_score)

    overdue_tasks = session.execute(
        _own(select(Task), Task, user).where(
            (Task.due_date != None) &  # noqa: E711
            (Task.due_date < today) &
            (~Task.status.in_(["done", "cancelled"]))
        )
    ).scalars().all()

    active_projects_rows = session.execute(
        _own(select(Project), Project, user).where(Project.status == "active")
    ).scalars().all()
    active_projects = []
    for p in active_projects_rows:
        proj_tasks = session.execute(
            _own(select(Task), Task, user).where(Task.project_id == p.id)
        ).scalars().all()
        total = len(proj_tasks)
        done = sum(1 for t in proj_tasks if t.status == "done")
        active_projects.append({
            "id": p.id, "title": p.title, "task_count": total,
            "completion_percentage": int((done / total) * 100) if total else 0,
        })

    habits_rows = session.execute(_own(select(Habit), Habit, user)).scalars().all()
    today_habits = []
    for h in habits_rows:
        comps = session.execute(
            select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
        ).scalars().all()
        today_habits.append({
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
        })

    all_today_tasks = list(today_tasks) + list(completed_today)
    today_tasks_serialized = [json.loads(TaskResponse.from_orm(t).json()) for t in all_today_tasks]
    overdue_tasks_serialized = [json.loads(TaskResponse.from_orm(t).json()) for t in overdue_tasks]

    return DashboardSummary(
        tasks_today=len(today_tasks),
        completed_today=len(completed_today),
        focus_score_today=focus_score_today,
        time_tracked_seconds=total_seconds,
        streak_days=0,
        today_tasks=today_tasks_serialized,
        overdue_tasks=overdue_tasks_serialized,
        today_habits=today_habits,
        active_projects=active_projects,
        total_tasks_today=len(today_tasks) + len(completed_today),
        completed_tasks_today=len(completed_today),
        habit_completion_rate=0.0,
        gamification={
            "tasks_completed": len(completed_today),
            "tasks_attempted": len(today_tasks) + len(completed_today),
            "batting_average": len(completed_today) / (len(today_tasks) + len(completed_today)) if (len(today_tasks) + len(completed_today)) > 0 else 0.0,
            "hits": len(completed_today),
            "home_runs": sum(1 for t in completed_today if t.priority == "critical"),
            "total_focus_minutes": round(total_seconds / 60),
        },
    )

# ─── Tags & Categories ──────────────────────────────────────────────
# These are user-scoped; legacy NULL-owner rows are also visible for backwards
# compat (the backfill on startup will eventually claim them all).
@app.get("/tags/", response_model=List[TagResponse])
async def list_tags(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(_own_or_legacy(select(Tag), Tag, user)).scalars().all()

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

@app.get("/categories/", response_model=List[CategoryResponse])
async def list_categories(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(_own_or_legacy(select(Category), Category, user)).scalars().all()

@app.post("/categories/", response_model=CategoryResponse)
async def create_category(
    data: CategoryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    category = Category(**data.dict())
    category.user_id = user.id
    session.add(category)
    session.commit()
    session.refresh(category)
    return category

@app.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    category = session.execute(
        _own(select(Category), Category, user).where(Category.id == category_id)
    ).scalar()
    if not category:
        raise HTTPException(status_code=404)
    session.delete(category)
    session.commit()
    return {"ok": True}

# ─── Sports favorites (user-owned) ─────────────────────────────
@app.get("/sports/favorites/", response_model=List[FavoriteSportsTeamResponse])
async def list_favorite_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    return session.execute(
        _own(select(FavoriteSportsTeam), FavoriteSportsTeam, user)
    ).scalars().all()

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
        _own(select(FavoriteSportsTeam), FavoriteSportsTeam, user)
        .where(FavoriteSportsTeam.id == team_id)
    ).scalar()
    if not team:
        raise HTTPException(status_code=404)
    session.delete(team)
    session.commit()
    return {"ok": True}

# ─── Gamification (user-scoped) ────────────────────────────────
@app.get("/gamification/", response_model=List[dict])
async def get_gamification_history(
    limit: int = 30,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    ct_now = datetime.now(_CT)
    results = []

    for days_back in range(limit):
        day = (ct_now - timedelta(days=days_back)).date()
        day_start_utc = datetime(day.year, day.month, day.day, 0, 0, 0,
                                 tzinfo=_CT).astimezone(_UTC).replace(tzinfo=None)
        day_end_utc = day_start_utc + timedelta(days=1)

        completed = session.execute(
            _own(select(Task), Task, user).where(
                (Task.status == "done") &
                (Task.completed_at >= day_start_utc) &
                (Task.completed_at < day_end_utc)
            )
        ).scalars().all()

        if days_back == 0:
            attempted = session.execute(
                _own(select(Task), Task, user).where(Task.status.in_(["today", "in_progress"]))
            ).scalars().all()
            attempted_count = len(attempted) + len(completed)
        else:
            attempted_count = len(completed)

        time_entries_day = session.execute(
            _own(select(TimeEntry), TimeEntry, user).where(
                (TimeEntry.started_at >= day_start_utc) &
                (TimeEntry.started_at < day_end_utc)
            )
        ).scalars().all()

        total_secs = 0
        for e in time_entries_day:
            end = e.ended_at or day_end_utc
            total_secs += int((end - e.started_at).total_seconds())

        habits_completed_day = session.execute(
            select(HabitCompletion).join(Habit, Habit.id == HabitCompletion.habit_id)
            .where(Habit.user_id == user.id)
            .where(HabitCompletion.completed_date == day)
        ).scalars().all()

        hits = len(completed)
        home_runs = sum(1 for t in completed if t.priority == "critical")
        strikeouts = max(0, attempted_count - hits)
        ba = hits / attempted_count if attempted_count > 0 else 0.0

        results.append({
            "stat_date": day.isoformat(),
            "tasks_completed": hits,
            "tasks_attempted": attempted_count,
            "habits_completed": len(habits_completed_day),
            "total_focus_minutes": round(total_secs / 60),
            "home_runs": home_runs,
            "hits": hits,
            "strikeouts": strikeouts,
            "batting_average": round(ba, 3),
            "hitting_streak": 0,
        })

    return results

# ─── Telegram Webhook (no bearer auth — Telegram can't send one) ──────
# Tasks created via Telegram are assigned to TELEGRAM_OWNER_USER_ID (env var).
# If unset, falls back to the oldest user in the DB.
@app.post("/telegram/webhook")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "Invalid JSON"}

    message = body.get("message") or body.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message.get("chat", {}).get("id")
    text_in = (message.get("text") or "").strip()

    if not text_in or not chat_id:
        return {"ok": True}

    # Resolve owner for this Telegram-created task
    owner_id = TELEGRAM_OWNER_USER_ID.strip() or None
    if not owner_id:
        first_user = session.execute(
            select(User).order_by(User.created_at.asc())
        ).scalar()
        if first_user:
            owner_id = first_user.id
    if not owner_id:
        await telegram_send_message(chat_id, "No user account configured on the server.")
        return {"ok": True}

    # Resolve sender → tag (scoped to the owner)
    sender_first = (message.get("from") or {}).get("first_name", "").strip()
    sender_tag_id = ""
    if sender_first:
        tag_name = sender_first.capitalize()
        existing_tag = session.execute(
            select(Tag).where((Tag.name == tag_name) & (Tag.user_id == owner_id))
        ).scalar()
        if existing_tag:
            sender_tag_id = existing_tag.id
        else:
            new_tag = Tag(name=tag_name, color="#4f98a3", user_id=owner_id)
            session.add(new_tag)
            session.commit()
            session.refresh(new_tag)
            sender_tag_id = new_tag.id

    try:
        task_data = parse_telegram_task(text_in)
    except ValueError as e:
        await telegram_send_message(chat_id, str(e))
        return {"ok": True}

    task_data["tag_ids"] = sender_tag_id
    task_data["focus_score"] = calc_focus_score(
        task_data.get("importance", 3),
        task_data.get("difficulty", 3),
    )
    task = Task(**task_data)
    task.user_id = owner_id
    session.add(task)
    session.commit()
    session.refresh(task)

    tag_note = f" [tagged: {sender_first}]" if sender_first else ""
    await telegram_send_message(
        chat_id,
        f"✅ Task created: \"{task.title}\" (priority: {task.priority}){tag_note}"
    )
    return {"ok": True}

@app.get("/telegram/set-webhook")
async def set_telegram_webhook(user: User = Depends(get_current_user)):
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN not set"}
    if not PUBLIC_BACKEND_URL:
        return {"ok": False, "error": "PUBLIC_BACKEND_URL not set"}

    webhook_url = f"{PUBLIC_BACKEND_URL.rstrip('/')}/telegram/webhook"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
            json={"url": webhook_url},
        )
    return resp.json()

@app.get("/telegram/webhook-info")
async def get_webhook_info(user: User = Depends(get_current_user)):
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN not set"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getWebhookInfo"
        )
    return resp.json()

# ─── MLB Live Data — Cardinals (public, no auth) ─────────────────────
@app.get("/sports/mlb/cardinals")
async def get_cardinals_data():
    CT = ZoneInfo("America/Chicago")
    now_ct = datetime.now(CT)
    STL_TEAM_ID = 138

    async with httpx.AsyncClient(timeout=15.0) as client:
        standings_resp = await client.get(
            "https://statsapi.mlb.com/api/v1/standings",
            params={"leagueId": "104", "season": str(now_ct.year),
                    "standingsTypes": "regularSeason", "hydrate": "team"},
        )
        nl_central = []
        for division in standings_resp.json().get("records", []):
            if division.get("division", {}).get("id") == 205:
                for tr in division.get("teamRecords", []):
                    team = tr.get("team", {})
                    wins = tr.get("wins", 0)
                    losses = tr.get("losses", 0)
                    pct_raw = tr.get("winningPercentage", "0")
                    gb_raw = tr.get("gamesBack", "-")
                    strk = tr.get("streak", {}).get("streakCode", "")
                    l10_rec = tr.get("records", {}).get("splitRecords", [])
                    l10 = next((f"{r['wins']}-{r['losses']}" for r in l10_rec if r.get("type") == "lastTen"), "")
                    try:
                        pct_fmt = f".{int(float(pct_raw) * 1000):03d}"
                    except Exception:
                        pct_fmt = ".000"
                    nl_central.append({
                        "abbr": team.get("abbreviation", ""),
                        "full": team.get("name", ""),
                        "team_id": team.get("id"),
                        "wl": f"{wins}-{losses}",
                        "pct": pct_fmt,
                        "gb": "—" if str(gb_raw) in ["-", "0.0", "0"] else str(gb_raw),
                        "strk": strk,
                        "l10": l10,
                        "cards": team.get("id") == STL_TEAM_ID,
                    })

        if now_ct.hour < 10:
            current_date = (now_ct - timedelta(days=1)).date()
            next_date = now_ct.date()
        else:
            current_date = now_ct.date()
            next_date = (now_ct + timedelta(days=1)).date()

        async def fetch_games(game_date: date):
            r = await client.get(
                "https://statsapi.mlb.com/api/v1/schedule",
                params={"sportId": "1", "teamId": STL_TEAM_ID,
                        "date": game_date.strftime("%Y-%m-%d"),
                        "hydrate": "linescore,team"},
            )
            return r.json().get("dates", [{}])[0].get("games", [])

        current_games, next_games = await asyncio.gather(
            fetch_games(current_date), fetch_games(next_date)
        )

        def parse_game(game, label: str):
            if not game:
                return None
            away = game.get("teams", {}).get("away", {})
            home = game.get("teams", {}).get("home", {})
            stl_is_home = home.get("team", {}).get("id") == STL_TEAM_ID
            opp_side = away if stl_is_home else home
            stl_side = home if stl_is_home else away
            opp_team = opp_side.get("team", {})
            stl_score = stl_side.get("score", 0) or 0
            opp_score = opp_side.get("score", 0) or 0
            status = game.get("status", {}).get("abstractGameState", "")
            detailed = game.get("status", {}).get("detailedState", "")
            venue = game.get("venue", {}).get("name", "")
            city = game.get("venue", {}).get("location", {}).get("city", "")
            game_time = ""
            game_dt_str = game.get("gameDate", "")
            if game_dt_str:
                try:
                    gdt = datetime.fromisoformat(game_dt_str.replace("Z", "+00:00"))
                    game_time = gdt.astimezone(CT).strftime("%-I:%M %p CDT")
                except Exception:
                    pass
            result = ""
            if status == "Final":
                result = (f"Cardinals win {stl_score}-{opp_score}"
                          if stl_score > opp_score
                          else f"Cardinals fall {stl_score}-{opp_score}")
            elif status == "Live":
                ls = game.get("linescore", {})
                inning = ls.get("currentInning", "")
                inning_half = ls.get("inningHalf", "")
                result = f"{inning_half} {inning}".strip() if inning else "In Progress"
            return {
                "status": status, "detailed_state": detailed,
                "stl_score": stl_score, "opp_score": opp_score,
                "opp_abbr": opp_team.get("abbreviation", ""),
                "opp_name": opp_team.get("teamName", opp_team.get("name", "")),
                "stl_is_home": stl_is_home, "game_time": game_time,
                "venue": venue, "city": city, "result": result, "date_label": label,
            }

        current_game = parse_game(
            current_games[0] if current_games else None,
            current_date.strftime("Today · %b %-d") if now_ct.hour >= 10 else current_date.strftime("%b %-d")
        )
        next_game = parse_game(
            next_games[0] if next_games else None,
            next_date.strftime("%A · %b %-d")
        )

        return {"nl_central": nl_central, "current_game": current_game, "next_game": next_game}


# ─── Cardinals Playoff Projections (Baseball Reference, public) ────
import time as _time

_proj_cache: dict = {"data": None, "ts": 0}

@app.get("/sports/mlb/cardinals/projections")
async def get_cardinals_projections():
    now = _time.time()
    if _proj_cache["data"] and now - _proj_cache["ts"] < 1800:
        return _proj_cache["data"]

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.get(
                "https://www.baseball-reference.com/leagues/majors/2026-playoff-odds.shtml",
                headers=headers,
            )
        html = r.text

        import re
        idx = html.find("St. Louis Cardinals")
        if idx == -1:
            raise ValueError("Cardinals row not found")

        chunk = html[idx: idx + 2000]
        stats = dict(re.findall(r'data-stat="([^"]+)"[^>]*>([^<]*)<', chunk))

        def pct(key: str):
            v = stats.get(key, "").replace("%", "").strip()
            try:
                return round(float(v), 1)
            except ValueError:
                return None

        def num(key: str):
            v = stats.get(key, "").strip()
            try:
                return round(float(v), 1)
            except ValueError:
                return None

        proj_wins_raw = num("ppr_avg_w")
        proj_wins = int(round(proj_wins_raw)) if proj_wins_raw else None

        result = {
            "record": f"{stats.get('ppr_cur_w','?')}-{stats.get('ppr_cur_l','?')}",
            "proj_wins": proj_wins,
            "proj_losses": int(round(num("ppr_avg_l"))) if num("ppr_avg_l") else None,
            "best": stats.get("ppr_best", ""),
            "worst": stats.get("ppr_worst", ""),
            "playoff_pct": pct("ppr_postseason"),
            "div_pct": pct("ppr_division"),
            "wc_pct": pct("ppr_wildcard"),
            "ws_pct": pct("ppr_champs"),
            "source": "baseball-reference.com",
        }

        _proj_cache["data"] = result
        _proj_cache["ts"] = now
        return result

    except Exception as e:
        if _proj_cache["data"]:
            return _proj_cache["data"]
        return {"error": str(e), "proj_wins": None, "playoff_pct": None,
                "div_pct": None, "wc_pct": None, "ws_pct": None}
