from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
import os
import json
import httpx
from typing import Optional, List
import imaplib
import email
from email.header import decode_header
import asyncio
import re

import db
from models import Task, Project, Habit, HabitCompletion, TimeEntry, Note, CRMPerson, TimeBlock, Tag, Category, BraindumpEntry
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
)
from auth import get_current_user, create_access_token, verify_token
from schemas import UserCreate, UserResponse, UserLogin

app = FastAPI(title="CommandCenter API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Timezone Helpers ────────────────────────────────────────────────
# The server runs UTC; the user is in Central Time (CDT/CST, America/Chicago).
# Habit completed_date values are sent from the frontend as CDT dates.
# Task/timer timestamps (started_at, completed_at) are stored as naive UTC datetimes.
#
# Always use _today_ct() for date comparisons (due_date, completed_date).
# Always use _ct_midnight_as_utc() when filtering UTC timestamp columns by "today in CT".

_CT = ZoneInfo("America/Chicago")
_UTC = ZoneInfo("UTC")

def _today_ct() -> date:
    """Today's calendar date in Central Time."""
    return datetime.now(_CT).date()

def _ct_midnight_as_utc() -> datetime:
    """
    Naive UTC datetime equivalent to midnight Central Time today.
    Use this to filter columns like started_at / completed_at that are
    stored as naive UTC timestamps.
    e.g.  Task.completed_at >= _ct_midnight_as_utc()
    """
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

# ─── Telegram Bot ────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "RUWT_bot")
PUBLIC_BACKEND_URL = os.getenv("PUBLIC_BACKEND_URL", "")

async def telegram_send_message(chat_id: int, text: str):
    """Send a reply back to a Telegram chat."""
    if not TELEGRAM_BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    async with httpx.AsyncClient(timeout=15.0) as client:
        await client.post(url, json={"chat_id": chat_id, "text": text})

def parse_telegram_task(text: str) -> dict:
    """
    Parse a Telegram message into task fields.

    Supported formats (all case-insensitive prefixes):
      /task Buy milk
      /task today Call Mike          → status=today
      /task !Finish taxes            → priority=high, importance=5
      Buy milk                       → plain text, no command needed
    """
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

    lower = raw.lower()
    if lower.startswith("today "):
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
from sqlalchemy import select
from models import User

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

# ─── Tasks ────────────────────────────────────────────────────────────
@app.get("/tasks/", response_model=List[TaskResponse])
async def list_tasks(
    status: Optional[str] = None,
    search: Optional[str] = None,
    session: Session = Depends(db.get_session),
):
    query = select(Task)
    if status:
        # Support comma-separated status values, e.g. "today,in_progress"
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            query = query.where(Task.status == statuses[0])
        else:
            query = query.where(Task.status.in_(statuses))
    if search:
        query = query.where(Task.title.ilike(f"%{search}%"))
    tasks = session.execute(query.order_by(Task.created_at.desc())).scalars().all()
    return tasks

@app.get("/tasks/today", response_model=List[TaskResponse])
async def today_tasks(session: Session = Depends(db.get_session)):
    today = _today_ct()  # CDT date — matches due_date values set from the frontend
    query = select(Task).where(
        Task.status.in_(["today", "in_progress"]) |
        ((Task.due_date == today) & (Task.status != "done"))
    )
    return session.execute(query.order_by(Task.sort_order)).scalars().all()

@app.post("/tasks/", response_model=TaskResponse)
async def create_task(data: TaskCreate, session: Session = Depends(db.get_session)):
    d = data.dict()
    d["tag_ids"] = tags_to_str(d.get("tag_ids", []))
    d["focus_score"] = calc_focus_score(d.get("importance", 3), d.get("difficulty", 3))
    task = Task(**d)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task

@app.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, session: Session = Depends(db.get_session)):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    return task

@app.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, data: TaskUpdate, session: Session = Depends(db.get_session)):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    if "tag_ids" in updates:
        updates["tag_ids"] = tags_to_str(updates["tag_ids"])
    for key, value in updates.items():
        setattr(task, key, value)
    # Auto-set completed_at when status is changed to "done" via PATCH
    # (the /complete endpoint already handles this; PATCH did not)
    if updates.get("status") == "done" and not task.completed_at:
        task.completed_at = datetime.utcnow()
    task.focus_score = calc_focus_score(task.importance, task.difficulty)
    session.commit()
    session.refresh(task)
    return task

@app.delete("/tasks/{task_id}")
async def delete_task(task_id: str, session: Session = Depends(db.get_session)):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    session.query(TimeEntry).filter(TimeEntry.task_id == task_id).update({TimeEntry.task_id: None})
    children = session.execute(select(Task).where(Task.parent_id == task_id)).scalars().all()
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
async def complete_task(task_id: str, session: Session = Depends(db.get_session)):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    task.status = "done"
    task.completed_at = datetime.utcnow()
    session.commit()
    session.refresh(task)
    return task

@app.post("/tasks/reorder")
async def reorder_tasks(ids: List[str], session: Session = Depends(db.get_session)):
    for idx, task_id in enumerate(ids):
        task = session.execute(select(Task).where(Task.id == task_id)).scalar()
        if task:
            task.sort_order = idx
    session.commit()
    return {"ok": True}

# ─── Projects ─────────────────────────────────────────────────────────
@app.get("/projects/", response_model=List[ProjectResponse])
async def list_projects(
    status: Optional[str] = None,
    session: Session = Depends(db.get_session),
):
    query = select(Project)
    if status:
        query = query.where(Project.status == status)
    projects = session.execute(query.order_by(Project.created_at.desc())).scalars().all()
    result = []
    for p in projects:
        proj_tasks = session.execute(select(Task).where(Task.project_id == p.id)).scalars().all()
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
async def create_project(data: ProjectCreate, session: Session = Depends(db.get_session)):
    project = Project(**data.dict())
    session.add(project)
    session.commit()
    session.refresh(project)
    proj_tasks = session.execute(select(Task).where(Task.project_id == project.id)).scalars().all()
    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "color": project.color,
        "due_date": project.due_date,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "tasks": [],
        "task_count": 0,
        "completion_percentage": 0,
    }

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, session: Session = Depends(db.get_session)):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    proj_tasks = session.execute(select(Task).where(Task.project_id == project_id)).scalars().all()
    total = len(proj_tasks)
    done = sum(1 for t in proj_tasks if t.status == "done")
    pct = int((done / total) * 100) if total else 0
    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "color": project.color,
        "due_date": project.due_date,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in proj_tasks],
        "task_count": total,
        "completion_percentage": pct,
    }

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, data: ProjectUpdate, session: Session = Depends(db.get_session)):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(project, key, value)
    session.commit()
    session.refresh(project)
    proj_tasks = session.execute(select(Task).where(Task.project_id == project_id)).scalars().all()
    total = len(proj_tasks)
    done = sum(1 for t in proj_tasks if t.status == "done")
    pct = int((done / total) * 100) if total else 0
    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "color": project.color,
        "due_date": project.due_date,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "tasks": [json.loads(TaskResponse.from_orm(t).json()) for t in proj_tasks],
        "task_count": total,
        "completion_percentage": pct,
    }

@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, session: Session = Depends(db.get_session)):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    session.delete(project)
    session.commit()
    return {"ok": True}

# ─── Habits ──────────────────────────────────────────────────────────
@app.get("/habits/")
async def list_habits(session: Session = Depends(db.get_session)):
    habits = session.execute(select(Habit).order_by(Habit.sort_order)).scalars().all()
    result = []
    for h in habits:
        comps = session.execute(
            select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
        ).scalars().all()
        result.append({
            "id": h.id,
            "name": h.title,
            "color": h.color,
            "icon": getattr(h, "icon", None),
            "frequency": h.frequency,
            "time_hour": getattr(h, "time_hour", None),
            "time_minute": getattr(h, "time_minute", None),
            "sort_order": getattr(h, "sort_order", 0),
            "is_active": getattr(h, "is_active", True),
            "completions": [
                {"id": c.id, "habit_id": c.habit_id, "completed_date": c.completed_date.isoformat() if c.completed_date else None, "created_at": c.created_at.isoformat() if c.created_at else None}
                for c in comps
            ],
                        "description": getattr(h, "description", None),
                                    "custom_days": None,
                                                "target_minutes": getattr(h, "target_minutes", None),
                                                            "created_at": h.created_at,
                                                                        "updated_at": h.updated_at,
        })
    return result

@app.post("/habits/")
async def create_habit(data: HabitCreate, session: Session = Depends(db.get_session)):
    d = data.dict()
    habit = Habit(
        title=d["name"],
        color=d.get("color", "#e8a820"),
        icon=d.get("icon"),
        frequency=d.get("frequency", "daily"),
        time_hour=d.get("time_hour"),
        time_minute=d.get("time_minute"),
        sort_order=d.get("sort_order", 0),
        is_active=d.get("is_active", True),
    )
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return {
        "id": habit.id,
        "name": habit.title,
        "color": habit.color,
        "icon": habit.icon,
        "frequency": habit.frequency,
        "time_hour": habit.time_hour,
        "time_minute": habit.time_minute,
        "sort_order": habit.sort_order,
        "is_active": habit.is_active,
        "completions": [],
                "description": None,
                        "custom_days": None,
                                "target_minutes": None,
                                        "created_at": habit.created_at,
                                                "updated_at": habit.updated_at,
    }

@app.patch("/habits/{habit_id}")
async def update_habit(habit_id: str, data: HabitUpdate, session: Session = Depends(db.get_session)):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
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
    return {
        "id": habit.id,
        "name": habit.title,
        "color": habit.color,
        "icon": habit.icon,
        "frequency": habit.frequency,
        "time_hour": habit.time_hour,
        "time_minute": habit.time_minute,
        "sort_order": habit.sort_order,
        "is_active": habit.is_active,
        "completions": [
            {"id": c.id, "habit_id": c.habit_id, "completed_date": c.completed_date.isoformat() if c.completed_date else None, "created_at": c.created_at.isoformat() if c.created_at else None}
            for c in comps
        ],
                "description": None,
                        "custom_days": None,
                                "target_minutes": None,
                                        "created_at": habit.created_at,
                                                "updated_at": habit.updated_at,
    }

@app.delete("/habits/{habit_id}")
async def delete_habit(habit_id: str, session: Session = Depends(db.get_session)):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    session.execute(
        select(HabitCompletion).where(HabitCompletion.habit_id == habit_id)
    )
    session.query(HabitCompletion).filter(HabitCompletion.habit_id == habit_id).delete()
    session.delete(habit)
    session.commit()
    return {"ok": True}

@app.post("/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
):
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
        habit_id=habit_id,
        completed_date=completed_date,
        note=data.get("note"),
    )
    session.add(completion)
    session.commit()
    session.refresh(completion)
    return {"ok": True, "id": completion.id}

@app.delete("/habits/{habit_id}/complete/{completed_date}")
async def uncomplete_habit(
    habit_id: str,
    completed_date: str,
    session: Session = Depends(db.get_session),
):
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
async def get_habit_streak(habit_id: str, session: Session = Depends(db.get_session)):
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
async def get_active_timer(session: Session = Depends(db.get_session)):
    entry = session.execute(
        select(TimeEntry).where(TimeEntry.ended_at == None)
        .order_by(TimeEntry.started_at.desc())
    ).scalar()
    return entry

@app.post("/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(data: TimeEntryCreate, session: Session = Depends(db.get_session)):
    existing = session.execute(
        select(TimeEntry).where(TimeEntry.ended_at == None)
    ).scalar()
    if existing:
        existing.ended_at = datetime.utcnow()
        session.commit()
    entry = TimeEntry(**data.dict())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/time-entries/{entry_id}/stop", response_model=TimeEntryResponse)
async def stop_timer(entry_id: str, data: dict, session: Session = Depends(db.get_session)):
    entry = session.execute(select(TimeEntry).where(TimeEntry.id == entry_id)).scalar()
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
    session: Session = Depends(db.get_session),
):
    query = select(TimeEntry)
    if task_id:
        query = query.where(TimeEntry.task_id == task_id)
    entries = session.execute(query.order_by(TimeEntry.started_at.desc())).scalars().all()
    return entries

# ─── Notes ────────────────────────────────────────────────────────────
@app.get("/notes/", response_model=List[NoteResponse])
async def list_notes(
    search: Optional[str] = None,
    session: Session = Depends(db.get_session),
):
    query = select(Note)
    if search:
        query = query.where(Note.title.ilike(f"%{search}%") | Note.content.ilike(f"%{search}%"))
    notes = session.execute(query.order_by(Note.updated_at.desc())).scalars().all()
    return notes

@app.post("/notes/", response_model=NoteResponse)
async def create_note(data: NoteCreate, session: Session = Depends(db.get_session)):
    note = Note(**data.dict())
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@app.patch("/notes/{note_id}", response_model=NoteResponse)
async def update_note(note_id: str, data: NoteUpdate, session: Session = Depends(db.get_session)):
    note = session.execute(select(Note).where(Note.id == note_id)).scalar()
    if not note:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(note, key, value)
    note.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(note)
    return note

@app.delete("/notes/{note_id}")
async def delete_note(note_id: str, session: Session = Depends(db.get_session)):
    note = session.execute(select(Note).where(Note.id == note_id)).scalar()
    if not note:
        raise HTTPException(status_code=404)
    session.delete(note)
    session.commit()
    return {"ok": True}

# ─── CRM ──────────────────────────────────────────────────────────────
@app.get("/crm/", response_model=List[CRMPersonResponse])
async def list_crm(
    search: Optional[str] = None,
    session: Session = Depends(db.get_session),
):
    query = select(CRMPerson)
    if search:
        query = query.where(CRMPerson.name.ilike(f"%{search}%"))
    people = session.execute(query.order_by(CRMPerson.name)).scalars().all()
    return people

@app.post("/crm/", response_model=CRMPersonResponse)
async def create_crm(data: CRMPersonCreate, session: Session = Depends(db.get_session)):
    person = CRMPerson(**data.dict())
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

@app.get("/crm/{person_id}", response_model=CRMPersonResponse)
async def get_crm(person_id: str, session: Session = Depends(db.get_session)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    return person

@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm(person_id: str, data: CRMPersonUpdate, session: Session = Depends(db.get_session)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(person, key, value)
    session.commit()
    session.refresh(person)
    return person

@app.delete("/crm/{person_id}")
async def delete_crm(person_id: str, session: Session = Depends(db.get_session)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    session.delete(person)
    session.commit()
    return {"ok": True}

@app.post("/crm/{person_id}/contacted", response_model=CRMPersonResponse)
async def mark_contacted(person_id: str, session: Session = Depends(db.get_session)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
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
    session: Session = Depends(db.get_session),
):
    query = select(TimeBlock)
    if date:
        try:
            target_date = datetime.fromisoformat(date).date()
            query = query.where(TimeBlock.date == target_date)
        except ValueError:
            pass
    blocks = session.execute(query.order_by(TimeBlock.start_time)).scalars().all()
    return blocks

@app.post("/time-blocks/", response_model=TimeBlockResponse)
async def create_time_block(data: TimeBlockCreate, session: Session = Depends(db.get_session)):
    block = TimeBlock(**data.dict())
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.patch("/time-blocks/{block_id}", response_model=TimeBlockResponse)
async def update_time_block(block_id: str, data: TimeBlockUpdate, session: Session = Depends(db.get_session)):
    block = session.execute(select(TimeBlock).where(TimeBlock.id == block_id)).scalar()
    if not block:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(block, key, value)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/time-blocks/{block_id}")
async def delete_time_block(block_id: str, session: Session = Depends(db.get_session)):
    block = session.execute(select(TimeBlock).where(TimeBlock.id == block_id)).scalar()
    if not block:
        raise HTTPException(status_code=404)
    session.delete(block)
    session.commit()
    return {"ok": True}

# ─── Braindump ────────────────────────────────────────────────────────
@app.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(session: Session = Depends(db.get_session)):
    entries = session.execute(
        select(BraindumpEntry).order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()
    return entries

@app.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(data: BraindumpEntryCreate, session: Session = Depends(db.get_session)):
    entry = BraindumpEntry(raw_text=data.raw_text)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/braindump/{entry_id}/process", response_model=BraindumpEntryResponse)
async def process_braindump(entry_id: str, session: Session = Depends(db.get_session)):
    entry = session.execute(select(BraindumpEntry).where(BraindumpEntry.id == entry_id)).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.processed = True
    session.commit()
    session.refresh(entry)
    return entry

# ─── Dashboard ────────────────────────────────────────────────────────
@app.get("/dashboard/debug")
async def debug_dashboard(session: Session = Depends(db.get_session)):
    try:
        today = _today_ct()
        ct_midnight = _ct_midnight_as_utc()
        today_tasks = session.execute(select(Task).where(Task.status.in_(["today", "in_progress"]))).scalars().all()
        completed_today = session.execute(select(Task).where((Task.status == "done") & (Task.completed_at >= ct_midnight))).scalars().all()
        time_entries = session.execute(select(TimeEntry).where(TimeEntry.started_at >= ct_midnight)).scalars().all()
        habits_rows = session.execute(select(Habit)).scalars().all()
        serialized = [json.loads(TaskResponse.from_orm(t).json()) for t in list(today_tasks)+list(completed_today)]
        return {"ok": True, "tasks": len(today_tasks), "completed": len(completed_today), "time_entries": len(time_entries), "habits": len(habits_rows), "serialized": len(serialized)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/dashboard/")
async def get_dashboard(session: Session = Depends(db.get_session)):
    # Use CDT date for date columns (due_date, completed_date).
    # Use _ct_midnight_as_utc() for UTC timestamp columns (started_at, completed_at).
    today = _today_ct()
    ct_midnight = _ct_midnight_as_utc()

    today_tasks = session.execute(
        select(Task).where(Task.status.in_(["today", "in_progress"]))
    ).scalars().all()

    # completed_at is stored as naive UTC — compare against CDT midnight converted to UTC
    completed_today = session.execute(
        select(Task).where(
            (Task.status == "done") &
            (Task.completed_at >= ct_midnight)
        )
    ).scalars().all()

    # started_at is stored as naive UTC — same conversion
    time_entries = session.execute(
        select(TimeEntry).where(
            TimeEntry.started_at >= ct_midnight
        )
    ).scalars().all()

    total_seconds = 0
    for entry in time_entries:
        end = entry.ended_at or datetime.utcnow()
        total_seconds += int((end - entry.started_at).total_seconds())

    focus_score_today = sum(t.focus_score for t in completed_today if t.focus_score)

    # due_date is a date column set from the frontend as a CDT date — compare with CDT today
    overdue_tasks = session.execute(
        select(Task).where(
            (Task.due_date != None) &
            (Task.due_date < today) &
            (~Task.status.in_(["done", "cancelled"]))
        )
    ).scalars().all()

    active_projects_rows = session.execute(
        select(Project).where(Project.status == "active")
    ).scalars().all()
    active_projects = []
    for p in active_projects_rows:
        proj_tasks = session.execute(select(Task).where(Task.project_id == p.id)).scalars().all()
        total = len(proj_tasks)
        done = sum(1 for t in proj_tasks if t.status == "done")
        active_projects.append({
            "id": p.id,
            "title": p.title,
            "task_count": total,
            "completion_percentage": int((done / total) * 100) if total else 0,
        })

    habits_rows = session.execute(select(Habit)).scalars().all()
    today_habits = []
    for h in habits_rows:
        comps = session.execute(
            select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
        ).scalars().all()
        today_habits.append({
            "id": h.id,
            "name": h.title,
            "color": h.color,
            "icon": getattr(h, "icon", None),
            "frequency": h.frequency,
            "time_hour": getattr(h, "time_hour", None),
            "time_minute": getattr(h, "time_minute", None),
            "sort_order": getattr(h, "sort_order", 0),
            "is_active": getattr(h, "is_active", True),
            "completions": [
                {"id": c.id, "habit_id": c.habit_id, "completed_date": c.completed_date.isoformat() if c.completed_date else None, "created_at": c.created_at.isoformat() if c.created_at else None}
                for c in comps
            ],
                        "description": getattr(h, "description", None),
                                    "custom_days": None,
                                                "target_minutes": getattr(h, "target_minutes", None),
                                                            "created_at": h.created_at,
                                                                        "updated_at": h.updated_at,
        })

    # Include completed tasks in the dashboard task list so they show as done
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
@app.get("/tags/", response_model=List[TagResponse])
async def list_tags(session: Session = Depends(db.get_session)):
    tags = session.execute(select(Tag)).scalars().all()
    return tags

@app.post("/tags/", response_model=TagResponse)
async def create_tag(data: TagCreate, session: Session = Depends(db.get_session)):
    tag = Tag(**data.dict())
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@app.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, session: Session = Depends(db.get_session)):
    tag = session.execute(select(Tag).where(Tag.id == tag_id)).scalar()
    if not tag:
        raise HTTPException(status_code=404)
    session.delete(tag)
    session.commit()
    return {"ok": True}

@app.get("/categories/", response_model=List[CategoryResponse])
async def list_categories(session: Session = Depends(db.get_session)):
    categories = session.execute(select(Category)).scalars().all()
    return categories

@app.post("/categories/", response_model=CategoryResponse)
async def create_category(data: CategoryCreate, session: Session = Depends(db.get_session)):
    category = Category(**data.dict())
    session.add(category)
    session.commit()
    session.refresh(category)
    return category

@app.delete("/categories/{category_id}")
async def delete_category(category_id: str, session: Session = Depends(db.get_session)):
    category = session.execute(select(Category).where(Category.id == category_id)).scalar()
    if not category:
        raise HTTPException(status_code=404)
    session.delete(category)
    session.commit()
    return {"ok": True}

# ─── Sports ──────────────────────────────────────────────────────────
from models import FavoriteSportsTeam
from schemas import FavoriteSportsTeamCreate, FavoriteSportsTeamResponse

@app.get("/sports/favorites/", response_model=List[FavoriteSportsTeamResponse])
async def list_favorite_teams(session: Session = Depends(db.get_session)):
    teams = session.execute(select(FavoriteSportsTeam)).scalars().all()
    return teams

@app.post("/sports/favorites/", response_model=FavoriteSportsTeamResponse)
async def add_favorite_team(data: FavoriteSportsTeamCreate, session: Session = Depends(db.get_session)):
    team = FavoriteSportsTeam(**data.dict())
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

@app.delete("/sports/favorites/{team_id}")
async def remove_favorite_team(team_id: str, session: Session = Depends(db.get_session)):
    team = session.execute(select(FavoriteSportsTeam).where(FavoriteSportsTeam.id == team_id)).scalar()
    if not team:
        raise HTTPException(status_code=404)
    session.delete(team)
    session.commit()
    return {"ok": True}

# ─── Gamification ─────────────────────────────────────────────────────
@app.get("/gamification/", response_model=List[dict])
async def get_gamification_history(limit: int = 30, session: Session = Depends(db.get_session)):
    """
    Returns gamification stats for the last `limit` days that have data.
    Each day: tasks_completed, tasks_attempted, habits_completed, total_focus_minutes,
              home_runs, hits, strikeouts, batting_average, hitting_streak, stat_date
    """
    ct_now = datetime.now(_CT)
    results = []

    for days_back in range(limit):
        day = (ct_now - timedelta(days=days_back)).date()
        day_start_utc = datetime(day.year, day.month, day.day, 0, 0, 0,
                                 tzinfo=_CT).astimezone(_UTC).replace(tzinfo=None)
        day_end_utc   = day_start_utc + timedelta(days=1)

        completed = session.execute(
            select(Task).where(
                (Task.status == "done") &
                (Task.completed_at >= day_start_utc) &
                (Task.completed_at < day_end_utc)
            )
        ).scalars().all()

        attempted_statuses = ["today", "in_progress", "done"]
        if days_back == 0:
            attempted = session.execute(
                select(Task).where(Task.status.in_(["today", "in_progress"]))
            ).scalars().all()
            attempted_count = len(attempted) + len(completed)
        else:
            attempted_count = len(completed)

        time_entries_day = session.execute(
            select(TimeEntry).where(
                (TimeEntry.started_at >= day_start_utc) &
                (TimeEntry.started_at < day_end_utc)
            )
        ).scalars().all()

        total_secs = 0
        for e in time_entries_day:
            end = e.ended_at or day_end_utc
            total_secs += int((end - e.started_at).total_seconds())

        habits_completed_day = session.execute(
            select(HabitCompletion).where(HabitCompletion.completed_date == day)
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

# ─── Telegram Webhook ─────────────────────────────────────────────────
@app.post("/telegram/webhook")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    """
    Receives Telegram Bot webhook updates and creates tasks from messages.
    Auto-tags the task with the sender's first name.
    """
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "Invalid JSON"}

    message = body.get("message") or body.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message.get("chat", {}).get("id")
    text    = (message.get("text") or "").strip()

    if not text or not chat_id:
        return {"ok": True}

    # ── Resolve sender name → tag ────────────────────────────────
    sender_first = (message.get("from") or {}).get("first_name", "").strip()
    sender_tag_id = ""
    if sender_first:
        tag_name = sender_first.capitalize()
        existing_tag = session.execute(
            select(Tag).where(Tag.name == tag_name)
        ).scalar()
        if existing_tag:
            sender_tag_id = existing_tag.id
        else:
            new_tag = Tag(name=tag_name, color="#4f98a3")
            session.add(new_tag)
            session.commit()
            session.refresh(new_tag)
            sender_tag_id = new_tag.id

    try:
        task_data = parse_telegram_task(text)
    except ValueError as e:
        await telegram_send_message(chat_id, str(e))
        return {"ok": True}

    task_data["tag_ids"] = sender_tag_id
    task_data["focus_score"] = calc_focus_score(
        task_data.get("importance", 3),
        task_data.get("difficulty", 3),
    )
    task = Task(**task_data)
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
async def set_telegram_webhook():
    """
    Convenience endpoint: registers the webhook URL with Telegram.
    Call once after deploy: GET /telegram/set-webhook
    """
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



@app.get("/habits/debug-error")
async def debug_habits_error(session: Session = Depends(db.get_session)):
    import traceback
    try:
        habits = session.execute(select(Habit).order_by(Habit.sort_order)).scalars().all()
        result = []
        for h in habits:
            comps = session.execute(
                select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
            ).scalars().all()
            result.append({
                "id": h.id,
                "name": h.title,
                "color": h.color,
                "icon": getattr(h, "icon", None),
                "frequency": h.frequency,
                "time_hour": getattr(h, "time_hour", None),
                "time_minute": getattr(h, "time_minute", None),
                "sort_order": getattr(h, "sort_order", 0),
                "is_active": getattr(h, "is_active", True),
                "completions": [
                    {"id": c.id, "habit_id": c.habit_id, "completed_date": c.completed_date.isoformat() if c.completed_date else None, "created_at": c.created_at.isoformat() if c.created_at else None}
                    for c in comps
                ],
                "description": getattr(h, "description", None),
                "custom_days": None,
                "target_minutes": getattr(h, "target_minutes", None),
                "created_at": h.created_at.isoformat() if h.created_at else None,
                "updated_at": h.updated_at.isoformat() if h.updated_at else None,
            })
        return {"ok": True, "count": len(result), "habits": result, "version": "v_debug_1"}
    except Exception as e:
        return {"ok": False, "error": str(e), "traceback": traceback.format_exc()}

@app.get("/telegram/webhook-info")
async def get_webhook_info():
    """Query Telegram for current webhook status and recent errors."""
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN not set"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getWebhookInfo"
        )
    return resp.json()

# ─── MLB Live Data — Cardinals ────────────────────────────────────────────────
@app.get("/sports/mlb/cardinals")
async def get_cardinals_data():
    """
    Returns Cardinals current/next game and NL Central standings from MLB Stats API.
    Time logic (America/Chicago):
      - Before 10:00 AM CDT  → current_game = yesterday's final, next_game = today
      - 10:00 AM CDT or later → current_game = today's game,    next_game = tomorrow
    """
    CT = ZoneInfo("America/Chicago")
    now_ct = datetime.now(CT)
    STL_TEAM_ID = 138

    async with httpx.AsyncClient(timeout=15.0) as client:

        # ── 1. NL Central standings ─────────────────────────────────────────
        standings_resp = await client.get(
            "https://statsapi.mlb.com/api/v1/standings",
            params={"leagueId": "104", "season": str(now_ct.year), "standingsTypes": "regularSeason", "hydrate": "team"},
        )
        nl_central = []
        for division in standings_resp.json().get("records", []):
            if division.get("division", {}).get("id") == 205:  # NL Central
                for tr in division.get("teamRecords", []):
                    team = tr.get("team", {})
                    wins   = tr.get("wins", 0)
                    losses = tr.get("losses", 0)
                    pct_raw = tr.get("winningPercentage", "0")
                    gb_raw  = tr.get("gamesBack", "-")
                    strk    = tr.get("streak", {}).get("streakCode", "")
                    l10_rec = tr.get("records", {}).get("splitRecords", [])
                    l10     = next((f"{r['wins']}-{r['losses']}" for r in l10_rec if r.get("type") == "lastTen"), "")
                    try:
                        pct_fmt = f".{int(float(pct_raw) * 1000):03d}"
                    except Exception:
                        pct_fmt = ".000"
                    nl_central.append({
                        "abbr":    team.get("abbreviation", ""),
                        "full":    team.get("name", ""),
                        "team_id": team.get("id"),
                        "wl":      f"{wins}-{losses}",
                        "pct":     pct_fmt,
                        "gb":      "—" if str(gb_raw) in ["-", "0.0", "0"] else str(gb_raw),
                        "strk":    strk,
                        "l10":     l10,
                        "cards":   team.get("id") == STL_TEAM_ID,
                    })

        # ── 2. Date logic ────────────────────────────────────────────────────
        if now_ct.hour < 10:
            current_date = (now_ct - timedelta(days=1)).date()
            next_date    = now_ct.date()
        else:
            current_date = now_ct.date()
            next_date    = (now_ct + timedelta(days=1)).date()

        # ── 3. Fetch schedule ────────────────────────────────────────────────
        async def fetch_games(game_date: date):
            r = await client.get(
                "https://statsapi.mlb.com/api/v1/schedule",
                params={
                    "sportId": "1",
                    "teamId":  STL_TEAM_ID,
                    "date":    game_date.strftime("%Y-%m-%d"),
                    "hydrate": "linescore,team",
                },
            )
            return r.json().get("dates", [{}])[0].get("games", [])

        current_games, next_games = await asyncio.gather(
            fetch_games(current_date), fetch_games(next_date)
        )

        # ── 4. Parse a game record ───────────────────────────────────────────
        def parse_game(game, label: str):
            if not game:
                return None
            away = game.get("teams", {}).get("away", {})
            home = game.get("teams", {}).get("home", {})
            stl_is_home = home.get("team", {}).get("id") == STL_TEAM_ID
            opp_side    = away if stl_is_home else home
            stl_side    = home if stl_is_home else away
            opp_team    = opp_side.get("team", {})
            stl_score   = stl_side.get("score", 0) or 0
            opp_score   = opp_side.get("score", 0) or 0
            status      = game.get("status", {}).get("abstractGameState", "")
            detailed    = game.get("status", {}).get("detailedState", "")
            venue       = game.get("venue", {}).get("name", "")
            city        = game.get("venue", {}).get("location", {}).get("city", "")
            game_time   = ""
            game_dt_str = game.get("gameDate", "")
            if game_dt_str:
                try:
                    gdt = datetime.fromisoformat(game_dt_str.replace("Z", "+00:00"))
                    game_time = gdt.astimezone(CT).strftime("%-I:%M %p CDT")
                except Exception:
                    pass
            result = ""
            if status == "Final":
                result = f"Cardinals win {stl_score}-{opp_score}" if stl_score > opp_score else f"Cardinals fall {stl_score}-{opp_score}"
            elif status == "Live":
                ls = game.get("linescore", {})
                inning      = ls.get("currentInning", "")
                inning_half = ls.get("inningHalf", "")
                result = f"{inning_half} {inning}".strip() if inning else "In Progress"
            return {
                "status":       status,
                "detailed_state": detailed,
                "stl_score":    stl_score,
                "opp_score":    opp_score,
                "opp_abbr":     opp_team.get("abbreviation", ""),
                "opp_name":     opp_team.get("teamName", opp_team.get("name", "")),
                "stl_is_home":  stl_is_home,
                "game_time":    game_time,
                "venue":        venue,
                "city":         city,
                "result":       result,
                "date_label":   label,
            }

        current_game = parse_game(current_games[0] if current_games else None,
                                   current_date.strftime("Today · %b %-d") if now_ct.hour >= 10 else current_date.strftime("%b %-d"))
        next_game    = parse_game(next_games[0] if next_games else None,
                                   next_date.strftime("%A · %b %-d"))

        return {
            "nl_central":   nl_central,
            "current_game": current_game,
            "next_game":    next_game,
        }


# ─── Cardinals Playoff Projections (Baseball Reference) ──────────────────────
import httpx
from functools import lru_cache
import time as _time

_proj_cache: dict = {"data": None, "ts": 0}

@app.get("/sports/mlb/cardinals/projections")
async def get_cardinals_projections():
    """
    Scrapes Baseball Reference playoff odds page for Cardinals projection data.
    Cached for 30 minutes to be polite to BBRef.
    """
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

        def pct(key: str) -> float | None:
            v = stats.get(key, "").replace("%", "").strip()
            try:
                return round(float(v), 1)
            except ValueError:
                return None

        def num(key: str) -> float | None:
            v = stats.get(key, "").strip()
            try:
                return round(float(v), 1)
            except ValueError:
                return None

        proj_wins_raw = num("ppr_avg_w")
        proj_wins = int(round(proj_wins_raw)) if proj_wins_raw else None

        result = {
            "record":      f"{stats.get('ppr_cur_w','?')}-{stats.get('ppr_cur_l','?')}",
            "proj_wins":   proj_wins,
            "proj_losses": int(round(num("ppr_avg_l"))) if num("ppr_avg_l") else None,
            "best":        stats.get("ppr_best", ""),
            "worst":       stats.get("ppr_worst", ""),
            "playoff_pct": pct("ppr_postseason"),
            "div_pct":     pct("ppr_division"),
            "wc_pct":      pct("ppr_wildcard"),
            "ws_pct":      pct("ppr_champs"),
            "source":      "baseball-reference.com",
        }

        _proj_cache["data"] = result
        _proj_cache["ts"]   = now
        return result

    except Exception as e:
        # Return last cached data if available, else error
        if _proj_cache["data"]:
            return _proj_cache["data"]
        return {"error": str(e), "proj_wins": None, "playoff_pct": None, "div_pct": None, "wc_pct": None, "ws_pct": None}

