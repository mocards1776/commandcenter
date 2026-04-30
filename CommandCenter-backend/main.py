from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
import os
import json
import httpx
from typing import Optional, List

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
    status = "inbox"
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
        query = query.where(Task.status == status)
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
    return session.execute(query.order_by(Task.order)).scalars().all()

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
            task.order = idx
    session.commit()
    return {"ok": True}

# ─── Projects ────────────────────────────────────────────────────────
@app.get("/projects/", response_model=List[ProjectResponse])
async def list_projects(session: Session = Depends(db.get_session)):
    projects = session.execute(select(Project)).scalars().all()
    return projects

@app.post("/projects/", response_model=ProjectResponse)
async def create_project(data: ProjectCreate, session: Session = Depends(db.get_session)):
    project = Project(**data.dict())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, session: Session = Depends(db.get_session)):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    return project

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, data: ProjectUpdate, session: Session = Depends(db.get_session)):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(project, key, value)
    session.commit()
    session.refresh(project)
    return project

@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, session: Session = Depends(db.get_session)):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    session.delete(project)
    session.commit()
    return {"ok": True}

# ─── Time Blocks ─────────────────────────────────────────────────────
@app.get("/time-blocks/", response_model=List[TimeBlockResponse])
async def list_time_blocks(date: Optional[str] = None, session: Session = Depends(db.get_session)):
    query = select(TimeBlock)
    if date:
        target_date = datetime.fromisoformat(date).date()
        query = query.where(
            (TimeBlock.start_time >= target_date) &
            (TimeBlock.start_time < target_date + timedelta(days=1))
        )
    blocks = session.execute(query.order_by(TimeBlock.start_time)).scalars().all()
    return blocks

@app.post("/time-blocks/", response_model=TimeBlockResponse)
async def create_time_block(data: TimeBlockCreate, session: Session = Depends(db.get_session)):
    block = TimeBlock(**data.dict())
    session.add(block)
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

# ─── Habits ──────────────────────────────────────────────────────────
@app.get("/habits/", response_model=List[HabitResponse])
async def list_habits(session: Session = Depends(db.get_session)):
    habits = session.execute(select(Habit).order_by(Habit.sort_order)).scalars().all()
    return habits

@app.post("/habits/", response_model=HabitResponse)
async def create_habit(data: HabitCreate, session: Session = Depends(db.get_session)):
    d = data.dict()
    # Map 'name' → 'title' for DB column
    title = d.pop("name")
    # Encode custom_days list as JSON string
    custom_days = d.pop("custom_days", None)
    custom_days_str = json.dumps(custom_days) if custom_days is not None else None
    habit = Habit(
        title=title,
        description=d.get("description"),
        color=d.get("color"),
        frequency=d.get("frequency", "daily"),
        icon=d.get("icon"),
        custom_days=custom_days_str,
        target_minutes=d.get("target_minutes"),
        time_hour=d.get("time_hour"),
        time_minute=d.get("time_minute"),
        sort_order=d.get("sort_order", 0),
        is_active=d.get("is_active", True),
    )
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@app.patch("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit(habit_id: str, data: HabitUpdate, session: Session = Depends(db.get_session)):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    # Map 'name' → 'title'
    if "name" in updates:
        habit.title = updates.pop("name")
    # Encode custom_days
    if "custom_days" in updates:
        cd = updates.pop("custom_days")
        habit.custom_days = json.dumps(cd) if cd is not None else None
    for key, value in updates.items():
        setattr(habit, key, value)
    habit.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(habit)
    return habit

@app.delete("/habits/{habit_id}")
async def delete_habit(habit_id: str, session: Session = Depends(db.get_session)):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    session.delete(habit)
    session.commit()
    return {"ok": True}

@app.post("/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    # completed_date sent from frontend is already a CDT calendar date string
    completed_date = datetime.fromisoformat(data["completed_date"]).date()
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
    if completion:
        session.delete(completion)
        session.commit()
    return {"ok": True}

@app.get("/habits/{habit_id}/streak")
async def get_habit_streak(habit_id: str, session: Session = Depends(db.get_session)):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    completions = session.execute(
        select(HabitCompletion).where(HabitCompletion.habit_id == habit_id)
        .order_by(HabitCompletion.completed_date.desc())
    ).scalars().all()
    if not completions:
        return {"habit_id": habit_id, "streak": 0}
    streak = 0
    today = _today_ct()  # CDT date — matches stored CDT completed_date values
    for i, comp in enumerate(completions):
        expected_date = today - timedelta(days=i)
        if comp.completed_date == expected_date:
            streak += 1
        else:
            break
    return {"habit_id": habit_id, "streak": streak}

# ─── Time Entries ────────────────────────────────────────────────────
@app.get("/time-entries/active", response_model=Optional[TimeEntryResponse])
async def get_active_timer(session: Session = Depends(db.get_session)):
    entry = session.execute(
        select(TimeEntry)
        .where(TimeEntry.ended_at == None)  # noqa: E711
        .order_by(TimeEntry.started_at.desc())
    ).scalar()
    return entry

@app.post("/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(data: TimeEntryCreate, session: Session = Depends(db.get_session)):
    entry = TimeEntry(
        task_id=data.task_id,
        habit_id=data.habit_id,
        started_at=data.started_at,
        note=data.note,
    )
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
    session.commit()
    session.refresh(entry)
    return entry

# ─── Dashboard ───────────────────────────────────────────────────────
@app.get("/dashboard/", response_model=DashboardSummary)
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
        })

    today_tasks_serialized = [TaskResponse.from_orm(t).dict() for t in today_tasks]
    overdue_tasks_serialized = [TaskResponse.from_orm(t).dict() for t in overdue_tasks]

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
        gamification=None,
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

# ─── Notes ──────────────────────────────────────────────────────────
@app.get("/notes/", response_model=List[NoteResponse])
async def list_notes(session: Session = Depends(db.get_session)):
    notes = session.execute(select(Note)).scalars().all()
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

# ─── CRM ────────────────────────────────────────────────────────────
@app.get("/crm/", response_model=List[CRMPersonResponse])
async def list_crm(session: Session = Depends(db.get_session)):
    people = session.execute(select(CRMPerson)).scalars().all()
    return people

@app.post("/crm/", response_model=CRMPersonResponse)
async def create_crm(data: CRMPersonCreate, session: Session = Depends(db.get_session)):
    person = CRMPerson(**data.dict())
    session.add(person)
    session.commit()
    session.refresh(person)
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

@app.post("/crm/{person_id}/contacted")
async def mark_contacted(person_id: str, session: Session = Depends(db.get_session)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    person.last_contacted = datetime.utcnow()
    session.commit()
    return {"ok": True}

@app.delete("/crm/{person_id}")
async def delete_crm(person_id: str, session: Session = Depends(db.get_session)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person:
        raise HTTPException(status_code=404)
    session.delete(person)
    session.commit()
    return {"ok": True}

# ─── Braindump ──────────────────────────────────────────────────────
@app.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(session: Session = Depends(db.get_session)):
    entries = session.execute(select(BraindumpEntry)).scalars().all()
    return entries

@app.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(data: BraindumpEntryCreate, session: Session = Depends(db.get_session)):
    entry = BraindumpEntry(**data.dict())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/braindump/{entry_id}/process")
async def process_braindump(entry_id: str, session: Session = Depends(db.get_session)):
    entry = session.execute(select(BraindumpEntry).where(BraindumpEntry.id == entry_id)).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.processed = True
    session.commit()
    session.refresh(entry)
    return entry

# ─── Telegram Integration ─────────────────────────────────────────────
@app.post("/integrations/telegram/webhook")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    """
    Telegram bot webhook. Register this URL with Telegram via /integrations/telegram/set-webhook.
    Supported message formats:
      /task Buy milk
      /task today Call Mike      → status=today
      /task !Finish taxes        → priority=high
      Buy milk                   → plain text also works
    """
    payload = await request.json()
    message = payload.get("message") or payload.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message.get("chat", {}).get("id")
    text = (message.get("text") or "").strip()

    if not chat_id or not text:
        return {"ok": True}

    # Handle /start and /help
    if text.lower() in ("/start", "/help"):
        help_msg = (
            "CommandCenter Bot\n\n"
            "Send any message to create a task, or use:\n"
            "/task Buy milk\n"
            "/task today Call Mike  (adds to Today)\n"
            "/task !Finish taxes    (high priority)\n\n"
            "Plain text also creates a task."
        )
        await telegram_send_message(chat_id, help_msg)
        return {"ok": True}

    # Ignore other slash commands we don't handle
    if text.startswith("/") and not text.lower().startswith("/task"):
        return {"ok": True}

    try:
        task_fields = parse_telegram_task(text)
    except ValueError as exc:
        await telegram_send_message(chat_id, str(exc))
        return {"ok": True}

    task_fields["tag_ids"] = ""
    task_fields["focus_score"] = calc_focus_score(
        task_fields.pop("importance", 3),
        task_fields.pop("difficulty", 3),
    )
    task = Task(**task_fields)
    session.add(task)
    session.commit()
    session.refresh(task)

    reply = (
        f"Task added: {task.title}\n"
        f"Status: {task.status}  Priority: {task.priority}"
    )
    await telegram_send_message(chat_id, reply)
    return {"ok": True}


@app.get("/integrations/telegram/set-webhook")
async def set_telegram_webhook():
    """
    Register the webhook URL with Telegram. Call once after deploying.
    Requires TELEGRAM_BOT_TOKEN and PUBLIC_BACKEND_URL env vars to be set.
    """
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=500, detail="TELEGRAM_BOT_TOKEN env var not set")
    if not PUBLIC_BACKEND_URL:
        raise HTTPException(status_code=500, detail="PUBLIC_BACKEND_URL env var not set")

    webhook_url = f"{PUBLIC_BACKEND_URL.rstrip('/')}/integrations/telegram/webhook"
    api_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(api_url, json={"url": webhook_url})
        result = resp.json()

    return {"webhook_url": webhook_url, "telegram_response": result}


# Startup
@app.on_event("startup")
async def startup():
    db.init_db()
    print("\u2713 Database initialized")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
