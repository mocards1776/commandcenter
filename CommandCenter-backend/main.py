from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
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

ALLOWED_ORIGINS = [
    "https://command-center-flax-gamma.vercel.app",
    "https://command-center-git-main-mocards1776s-projects.vercel.app",
    "https://command-center-mocards1776s-projects.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app = FastAPI(title="CommandCenter API", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://command-center.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    expose_headers=["*"],
    max_age=600,
)

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

# ── Google Calendar (API key + Calendar ID — set on DO) ───────────────────────
GCAL_API_KEY = os.getenv("GCAL_API_KEY", "")
GCAL_CALENDAR_ID = os.getenv("GCAL_CALENDAR_ID", "")

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

# ── Google Calendar ───────────────────────────────────────────────────────────

@app.get("/api/gcal/next-event")
@app.get("/api/gcal/next-event/", include_in_schema=False)
async def get_gcal_next_event(user: User = Depends(get_current_user)):
    """
    Fetch upcoming Google Calendar events for today using a hardcoded API key
    and calendar ID stored as environment variables (GCAL_API_KEY, GCAL_CALENDAR_ID).
    Returns { configured: bool, events: [{ title, startMs }] }
    """
    if not GCAL_API_KEY or not GCAL_CALENDAR_ID:
        return {"configured": False, "events": []}

    now_ct = datetime.now(_CT)
    # Convert to UTC with RFC 3339 Z suffix — required by Google Calendar API
    from datetime import timezone as _tz
    now_utc = now_ct.astimezone(_tz.utc)
    time_min = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    time_max = (now_utc + timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://www.googleapis.com/calendar/v3/calendars/{GCAL_CALENDAR_ID}/events",
                params={
                    "key": GCAL_API_KEY,
                    "timeMin": time_min,
                    "timeMax": time_max,
                    "singleEvents": "true",
                    "orderBy": "startTime",
                    "maxResults": 10,
                },
            )
        if resp.status_code != 200:
            return {"configured": True, "events": [], "error": resp.text}

        data = resp.json()
        events = []
        for item in data.get("items", []):
            summary = item.get("summary", "Untitled")
            start = item.get("start", {})
            dt_str = start.get("dateTime") or start.get("date")
            if not dt_str:
                continue
            try:
                if "T" in dt_str:
                    # Full datetime — parse with timezone awareness
                    from datetime import timezone
                    dt = datetime.fromisoformat(dt_str)
                    start_ms = int(dt.timestamp() * 1000)
                else:
                    # All-day event — treat as midnight CT
                    d = date.fromisoformat(dt_str)
                    dt = datetime(d.year, d.month, d.day, tzinfo=_CT)
                    start_ms = int(dt.timestamp() * 1000)
                events.append({"title": summary, "startMs": start_ms})
            except Exception:
                continue

        return {"configured": True, "events": events}

    except Exception as e:
        return {"configured": True, "events": [], "error": str(e)}

# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/dashboard")
@app.get("/dashboard/", include_in_schema=False)
async def get_dashboard(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    today_dt = datetime(today.year, today.month, today.day)

    # Tasks
    today_tasks = session.execute(
        select(Task).where(
            Task.user_id == user.id,
            Task.status.in_(["today", "in_progress"]),
        )
    ).scalars().all()

    overdue_tasks = session.execute(
        select(Task).where(
            Task.user_id == user.id,
            Task.due_date < today_dt,
            Task.status.notin_(["done"]),
        )
    ).scalars().all()

    # Tasks completed today
    completed_today_tasks = session.execute(
        select(Task).where(
            Task.user_id == user.id,
            Task.status == "done",
            Task.completed_at >= today_dt,
        )
    ).scalars().all()

    completed_tasks_today = len(completed_today_tasks)
    total_tasks_today = len(today_tasks) + completed_tasks_today

    # Time tracked today (seconds)
    time_entries_today = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.started_at >= today_dt,
            TimeEntry.ended_at != None,  # noqa: E711
        )
    ).scalars().all()
    time_tracked_seconds = sum(e.duration_seconds or 0 for e in time_entries_today)

    # Habits
    habits = session.execute(
        select(Habit).where(Habit.user_id == user.id)
    ).scalars().all()

    habits_completed_today = 0
    today_habits = []
    for h in habits:
        comp = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id == h.id,
                HabitCompletion.completed_date == today,
            )
        ).scalar()
        completed = comp is not None
        if completed:
            habits_completed_today += 1
        streak = _habit_streak(h.id, session, today)
        today_habits.append({
            "id": h.id,
            "title": h.title,
            "name": h.title,      # frontend DashHabitRow checks entry?.name
            "color": h.color,
            "icon": h.icon,
            "completed_today": completed,
            "completed": completed,   # DashHabitRow also checks entry?.completed
            "streak": streak,
        })

    # Active time entry
    active_entry = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.ended_at == None,  # noqa: E711
        ).order_by(TimeEntry.started_at.desc())
    ).scalar()

    # Active projects (with task counts)
    projects_rows = session.execute(
        select(Project).where(Project.user_id == user.id, Project.status == "active")
    ).scalars().all()
    active_projects = []
    for p in projects_rows:
        tasks = session.execute(
            select(Task).where(Task.project_id == p.id, Task.user_id == user.id)
        ).scalars().all()
        done_count = sum(1 for t in tasks if t.status == "done")
        pct = int((done_count / len(tasks) * 100) if tasks else 0)
        d = _project_to_dict(p)
        d["task_count"] = len(tasks)
        d["completion_percentage"] = pct
        active_projects.append(d)

    # Gamification block — batting average stats the scoreboard needs
    attempted = total_tasks_today
    batting_avg = (completed_tasks_today / attempted) if attempted > 0 else 0.0

    # Hitting streak: consecutive days with at least 1 task completed
    hitting_streak = 0
    check = today
    for _ in range(365):
        count = session.execute(
            select(func.count(Task.id)).where(
                Task.user_id == user.id,
                Task.status == "done",
                Task.completed_at >= datetime(check.year, check.month, check.day),
                Task.completed_at < datetime(check.year, check.month, check.day) + timedelta(days=1),
            )
        ).scalar() or 0
        if count > 0:
            hitting_streak += 1
            check = check - timedelta(days=1)
        else:
            break

    gamification = {
        "stat_date": today.isoformat(),
        "tasks_completed": completed_tasks_today,
        "tasks_attempted": attempted,
        "habits_completed": habits_completed_today,
        "total_focus_minutes": round(time_tracked_seconds / 60),
        "home_runs": 0,
        "hits": completed_tasks_today,
        "strikeouts": len(overdue_tasks),
        "batting_average": round(batting_avg, 3),
        "hitting_streak": hitting_streak,
    }

    return {
        "today_tasks": [_task_to_dict(t) for t in today_tasks],
        "overdue_tasks": [_task_to_dict(t) for t in overdue_tasks],
        "today_habits": today_habits,
        "habits_total": len(habits),
        "habits_completed_today": habits_completed_today,
        "active_time_entry": _time_entry_to_dict(active_entry) if active_entry else None,
        "active_projects_count": len(projects_rows),
        "active_projects": active_projects,
        "completed_tasks_today": completed_tasks_today,
        "total_tasks_today": total_tasks_today,
        "time_tracked_seconds": time_tracked_seconds,
        "gamification": gamification,
        "date": today.isoformat(),
    }

# ── Tags ──────────────────────────────────────────────────────────────────────

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
@app.post("/tags/", response_model=TagResponse, include_in_schema=False)
async def create_tag(
    data: TagCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tag = Tag(name=data.name, color=getattr(data, "color", None) or "#4A90D9", user_id=user.id)
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@app.delete("/tags/{tag_id}")
@app.delete("/tags/{tag_id}/", include_in_schema=False)
async def delete_tag(
    tag_id: str,
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

# ── Categories ────────────────────────────────────────────────────────────────

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
@app.post("/categories/", response_model=CategoryResponse, include_in_schema=False)
async def create_category(
    data: CategoryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = Category(
        name=data.name,
        color=getattr(data, "color", None) or "#4A90D9",
        user_id=user.id,
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat

@app.delete("/categories/{category_id}")
@app.delete("/categories/{category_id}/", include_in_schema=False)
async def delete_category(
    category_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = session.execute(
        select(Category).where(Category.id == category_id, Category.user_id == user.id)
    ).scalar()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    session.delete(cat)
    session.commit()
    return {"detail": "deleted"}

# ── Gamification ──────────────────────────────────────────────────────────────

@app.get("/gamification")
@app.get("/gamification/", include_in_schema=False)
async def get_gamification(
    limit: int = Query(default=90, ge=1, le=365),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    start_date = today - timedelta(days=limit - 1)

    tasks_done = session.execute(
        select(Task).where(
            Task.user_id == user.id,
            Task.status == "done",
            Task.completed_at >= datetime(start_date.year, start_date.month, start_date.day),
        )
    ).scalars().all()

    habit_completions = session.execute(
        select(HabitCompletion).join(Habit, HabitCompletion.habit_id == Habit.id).where(
            Habit.user_id == user.id,
            HabitCompletion.completed_date >= start_date,
        )
    ).scalars().all()

    task_xp = sum((t.focus_score or 1) * 10 for t in tasks_done)
    habit_xp = len(habit_completions) * 5

    total_xp = task_xp + habit_xp
    level = max(1, int(total_xp ** 0.5) // 10 + 1)
    xp_for_current_level = ((level - 1) * 10) ** 2
    xp_for_next_level = (level * 10) ** 2
    xp_progress = total_xp - xp_for_current_level
    xp_needed = max(1, xp_for_next_level - xp_for_current_level)

    daily_activity: dict = defaultdict(int)
    for t in tasks_done:
        if t.completed_at:
            day = t.completed_at.date() if hasattr(t.completed_at, "date") else t.completed_at
            daily_activity[str(day)] += 1
    for hc in habit_completions:
        daily_activity[str(hc.completed_date)] += 1

    streak = 0
    check = today
    for _ in range(limit):
        if daily_activity.get(str(check), 0) > 0:
            streak += 1
            check = check - timedelta(days=1)
        else:
            break

    return {
        "total_xp": total_xp,
        "level": level,
        "xp_progress": xp_progress,
        "xp_needed": xp_needed,
        "current_streak": streak,
        "tasks_completed": len(tasks_done),
        "habits_completed": len(habit_completions),
        "daily_activity": dict(daily_activity),
    }

# ── Tasks ────────────────────────────────────────────────────────────────────

@app.get("/tasks", response_model=List[TaskResponse])
@app.get("/tasks/", response_model=List[TaskResponse], include_in_schema=False)
async def list_tasks(
    status: Optional[str] = None,
    project_id: Optional[str] = None,
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
    task_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    ).scalar()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_dict(task)

@app.put("/tasks/{task_id}", response_model=TaskResponse)
@app.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    ).scalar()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = data.dict(exclude_unset=True)
    if "tag_ids" in updates:
        updates["tag_ids"] = tags_to_str(updates["tag_ids"])
    if "importance" in updates or "difficulty" in updates:
        imp = updates.get("importance", task.importance) or 3
        diff = updates.get("difficulty", task.difficulty) or 3
        updates["focus_score"] = calc_focus_score(imp, diff)
    for k, v in updates.items():
        setattr(task, k, v)
    task.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
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

@app.post("/tasks/{task_id}/complete")
@app.post("/tasks/{task_id}/complete/", include_in_schema=False)
async def complete_task(
    task_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task = session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    ).scalar()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = "done"
    task.completed_at = datetime.utcnow()
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.post("/tasks/reorder")
@app.post("/tasks/reorder/", include_in_schema=False)
async def reorder_tasks(
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    ids = data.get("ids", [])
    for i, task_id in enumerate(ids):
        task = session.execute(
            select(Task).where(Task.id == task_id, Task.user_id == user.id)
        ).scalar()
        if task:
            task.sort_order = i
    session.commit()
    return {"detail": "reordered"}

# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/projects", response_model=List[ProjectResponse])
@app.get("/projects/", response_model=List[ProjectResponse], include_in_schema=False)
async def list_projects(
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(Project).where(Project.user_id == user.id)
    if status:
        q = q.where(Project.status == status)
    rows = session.execute(q.order_by(Project.created_at.desc())).scalars().all()
    return rows

@app.post("/projects", response_model=ProjectResponse)
@app.post("/projects/", response_model=ProjectResponse, include_in_schema=False)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = Project(**data.dict(), user_id=user.id)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    ).scalar()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@app.put("/projects/{project_id}", response_model=ProjectResponse)
@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    ).scalar()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(project, k, v)
    project.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(project)
    return project

@app.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = session.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    ).scalar()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    session.delete(project)
    session.commit()
    return {"detail": "deleted"}

# ── Habits ────────────────────────────────────────────────────────────────────

def _habit_streak(habit_id: str, session: Session, today: date) -> int:
    streak = 0
    check = today
    for _ in range(365):
        comp = session.execute(
            select(HabitCompletion).where(
                HabitCompletion.habit_id == habit_id,
                HabitCompletion.completed_date == check,
            )
        ).scalar()
        if comp:
            streak += 1
            check = check - timedelta(days=1)
        else:
            break
    return streak

@app.get("/habits", response_model=List[HabitResponse])
@app.get("/habits/", response_model=List[HabitResponse], include_in_schema=False)
async def list_habits(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Habit).where(Habit.user_id == user.id).order_by(Habit.created_at)
    ).scalars().all()
    return rows

@app.post("/habits", response_model=HabitResponse)
@app.post("/habits/", response_model=HabitResponse, include_in_schema=False)
async def create_habit(
    data: HabitCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = Habit(**data.dict(), user_id=user.id)
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@app.put("/habits/{habit_id}", response_model=HabitResponse)
@app.patch("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit(
    habit_id: str,
    data: HabitUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
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
    habit_id: str,
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
        return {"detail": "uncompleted", "completed": False}
    comp = HabitCompletion(habit_id=habit_id, completed_date=today)
    session.add(comp)
    session.commit()
    return {"detail": "completed", "completed": True}

# ── Time Entries ──────────────────────────────────────────────────────────────

def _time_entry_to_dict(entry: TimeEntry) -> dict:
    return {
        "id": entry.id,
        "task_id": entry.task_id,
        "started_at": entry.started_at,
        "ended_at": entry.ended_at,
        "duration_seconds": entry.duration_seconds,
        "notes": entry.notes,
        "created_at": entry.created_at,
    }

@app.get("/time-entries", response_model=List[TimeEntryResponse])
@app.get("/time-entries/", response_model=List[TimeEntryResponse], include_in_schema=False)
async def list_time_entries(
    task_id: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(TimeEntry).where(TimeEntry.user_id == user.id)
    if task_id:
        q = q.where(TimeEntry.task_id == task_id)
    rows = session.execute(q.order_by(TimeEntry.started_at.desc())).scalars().all()
    return [_time_entry_to_dict(e) for e in rows]

@app.post("/time-entries", response_model=TimeEntryResponse)
@app.post("/time-entries/", response_model=TimeEntryResponse, include_in_schema=False)
async def create_time_entry(
    data: TimeEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = TimeEntry(**data.dict(), user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _time_entry_to_dict(entry)

@app.patch("/time-entries/{entry_id}")
async def update_time_entry(
    entry_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        select(TimeEntry).where(TimeEntry.id == entry_id, TimeEntry.user_id == user.id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")
    for k, v in data.items():
        setattr(entry, k, v)
    session.commit()
    session.refresh(entry)
    return _time_entry_to_dict(entry)

# ── Notes ─────────────────────────────────────────────────────────────────────

@app.get("/notes", response_model=List[NoteResponse])
@app.get("/notes/", response_model=List[NoteResponse], include_in_schema=False)
async def list_notes(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(Note).where(Note.user_id == user.id).order_by(Note.updated_at.desc())
    ).scalars().all()
    return rows

@app.post("/notes", response_model=NoteResponse)
@app.post("/notes/", response_model=NoteResponse, include_in_schema=False)
async def create_note(
    data: NoteCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = Note(**data.dict(), user_id=user.id)
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@app.get("/notes/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note

@app.put("/notes/{note_id}", response_model=NoteResponse)
@app.patch("/notes/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: str,
    data: NoteUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    note = session.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
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
    note = session.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    ).scalar()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    session.delete(note)
    session.commit()
    return {"detail": "deleted"}

# ── CRM ───────────────────────────────────────────────────────────────────────

@app.get("/crm", response_model=List[CRMPersonResponse])
@app.get("/crm/", response_model=List[CRMPersonResponse], include_in_schema=False)
async def list_crm(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(CRMPerson).where(CRMPerson.user_id == user.id).order_by(CRMPerson.name)
    ).scalars().all()
    return rows

@app.post("/crm", response_model=CRMPersonResponse)
@app.post("/crm/", response_model=CRMPersonResponse, include_in_schema=False)
async def create_crm_person(
    data: CRMPersonCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = CRMPerson(**data.dict(), user_id=user.id)
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

@app.put("/crm/{person_id}", response_model=CRMPersonResponse)
@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm_person(
    person_id: str,
    data: CRMPersonUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = session.execute(
        select(CRMPerson).where(CRMPerson.id == person_id, CRMPerson.user_id == user.id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
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
    person = session.execute(
        select(CRMPerson).where(CRMPerson.id == person_id, CRMPerson.user_id == user.id)
    ).scalar()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    session.delete(person)
    session.commit()
    return {"detail": "deleted"}

# ── TimeBlocks ────────────────────────────────────────────────────────────────

@app.get("/api/timeblocks")
@app.get("/api/timeblocks/", include_in_schema=False)
async def list_timeblocks(
    date: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(TimeBlock).where(TimeBlock.user_id == user.id)
    if date:
        q = q.where(TimeBlock.date == date)
    rows = session.execute(q.order_by(TimeBlock.start_time)).scalars().all()
    return rows

@app.post("/api/timeblocks", response_model=TimeBlockResponse)
@app.post("/api/timeblocks/", response_model=TimeBlockResponse, include_in_schema=False)
async def create_timeblock(
    data: TimeBlockCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = TimeBlock(**data.dict(), user_id=user.id)
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.put("/api/timeblocks/{block_id}", response_model=TimeBlockResponse)
@app.patch("/api/timeblocks/{block_id}", response_model=TimeBlockResponse)
async def update_timeblock(
    block_id: str,
    data: TimeBlockUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(
        select(TimeBlock).where(TimeBlock.id == block_id, TimeBlock.user_id == user.id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404, detail="TimeBlock not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(block, k, v)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/api/timeblocks/{block_id}")
async def delete_timeblock(
    block_id: str,
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
@app.get("/braindump/", response_model=List[BraindumpEntryResponse], include_in_schema=False)
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
@app.post("/braindump/", response_model=BraindumpEntryResponse, include_in_schema=False)
async def create_braindump(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = BraindumpEntry(**data.dict(), user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.delete("/braindump/{entry_id}")
async def delete_braindump(
    entry_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        select(BraindumpEntry).where(
            BraindumpEntry.id == entry_id, BraindumpEntry.user_id == user.id
        )
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    session.delete(entry)
    session.commit()
    return {"detail": "deleted"}

# ── Sports Teams ──────────────────────────────────────────────────────────────

@app.get("/api/sports/teams", response_model=List[FavoriteSportsTeamResponse])
@app.get("/api/sports/teams/", response_model=List[FavoriteSportsTeamResponse], include_in_schema=False)
async def list_sports_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(FavoriteSportsTeam).where(FavoriteSportsTeam.user_id == user.id)
        .order_by(FavoriteSportsTeam.sort_order)
    ).scalars().all()
    return rows

@app.post("/api/sports/teams", response_model=FavoriteSportsTeamResponse)
@app.post("/api/sports/teams/", response_model=FavoriteSportsTeamResponse, include_in_schema=False)
async def add_sports_team(
    data: FavoriteSportsTeamCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = FavoriteSportsTeam(**data.dict(), user_id=user.id)
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

@app.delete("/api/sports/teams/{team_id}")
async def delete_sports_team(
    team_id: str,
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

# ── Telegram Webhook ──────────────────────────────────────────────────────────

@app.post("/webhook/telegram")
async def telegram_webhook(
    request: Request,
    session: Session = Depends(db.get_session),
):
    try:
        body = await request.json()
    except Exception:
        return Response(status_code=200)

    message = body.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    text    = message.get("text", "").strip()

    if not chat_id or not text:
        return Response(status_code=200)

    # Only respond to the owner
    if TELEGRAM_OWNER_USER_ID and str(chat_id) != str(TELEGRAM_OWNER_USER_ID):
        return Response(status_code=200)

    if text.lower().startswith("/task"):
        try:
            task_data = parse_telegram_task(text)
        except ValueError as e:
            await telegram_send_message(chat_id, str(e))
            return Response(status_code=200)

        # Find the owner user to associate the task
        user = None
        if TELEGRAM_OWNER_USER_ID:
            user = session.execute(select(User)).scalars().first()

        if not user:
            await telegram_send_message(chat_id, "No user account found. Please register first.")
            return Response(status_code=200)

        fs = calc_focus_score(task_data["importance"], task_data["difficulty"])
        task = Task(
            title=task_data["title"],
            status=task_data["status"],
            priority=task_data["priority"],
            importance=task_data["importance"],
            difficulty=task_data["difficulty"],
            focus_score=fs,
            notes=task_data["notes"],
            user_id=user.id,
        )
        session.add(task)
        session.commit()

        priority_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(task_data["priority"], "⚪")
        await telegram_send_message(
            chat_id,
            f"✅ Task created!\n\n{priority_emoji} {task_data['title']}\n"
            f"Status: {task_data['status']} | Priority: {task_data['priority']}\n"
            f"Focus Score: {fs}"
        )
    else:
        await telegram_send_message(
            chat_id,
            "CommandCenter Bot\n\nCommands:\n/task <title> — Add a task\n/task !<title> — Add high priority task"
        )

    return Response(status_code=200)
