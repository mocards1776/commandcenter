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
from pydantic import BaseModel

import db
from models import (
    Task, Project, Habit, HabitCompletion, TimeEntry, Note, CRMPerson,
    TimeBlock, Tag, Category, BraindumpEntry, User, FavoriteSportsTeam,
)
from schemas import (
    TaskCreate, TaskUpdate, TaskResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    HabitCreate, HabitUpdate, HabitResponse, HabitCompletionResponse,
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

def _ct_calendar_day_bounds(day: date) -> tuple[datetime, datetime]:
    """Start/end naive datetimes for a Central calendar day (matches dashboard date logic)."""
    start = datetime(day.year, day.month, day.day)
    return start, start + timedelta(days=1)

def _gamification_row_for_date(session: Session, user_id: str, day: date) -> dict:
    """Build scoreboard-shaped stats for one calendar day (for /gamification history)."""
    day_start, day_end = _ct_calendar_day_bounds(day)
    completed_rows = session.execute(
        select(Task).where(
            Task.user_id == user_id,
            Task.status == "done",
            Task.completed_at >= day_start,
            Task.completed_at < day_end,
        )
    ).scalars().all()
    completed_tasks_today = len(completed_rows)
    if day == _today_ct():
        today_active = session.execute(
            select(Task).where(
                Task.user_id == user_id,
                Task.status.in_(["today", "in_progress"]),
            )
        ).scalars().all()
        total_tasks_today = len(today_active) + completed_tasks_today
    else:
        total_tasks_today = completed_tasks_today
    attempted = total_tasks_today
    batting_avg = (completed_tasks_today / attempted) if attempted > 0 else 0.0

    habits_completed = session.execute(
        select(func.count(HabitCompletion.id))
        .join(Habit, HabitCompletion.habit_id == Habit.id)
        .where(Habit.user_id == user_id, HabitCompletion.completed_date == day)
    ).scalar() or 0

    time_entries_day = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user_id,
            TimeEntry.started_at >= day_start,
            TimeEntry.started_at < day_end,
            TimeEntry.ended_at != None,  # noqa: E711
        )
    ).scalars().all()
    time_tracked_seconds = sum(e.duration_seconds or 0 for e in time_entries_day)

    # Strikeouts omitted for history rows (would need point-in-time task state)
    strikeouts = 0

    hitting_streak = 0
    check = day
    for _ in range(365):
        count = session.execute(
            select(func.count(Task.id)).where(
                Task.user_id == user_id,
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

    return {
        "stat_date": day.isoformat(),
        "tasks_completed": completed_tasks_today,
        "tasks_attempted": attempted,
        "habits_completed": int(habits_completed),
        "total_focus_minutes": round(time_tracked_seconds / 60),
        "home_runs": 0,
        "hits": completed_tasks_today,
        "strikeouts": strikeouts,
        "batting_average": round(batting_avg, 3),
        "hitting_streak": hitting_streak,
    }

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
                    # Full datetime — parse with timezone awareness.
                    # Python <=3.10 fromisoformat() cannot handle "+HH:MM" offsets,
                    # so we fall back to manual offset parsing if needed.
                    from datetime import timezone as _tz2
                    import re as _re
                    try:
                        dt = datetime.fromisoformat(dt_str)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=_tz2.utc)
                    except ValueError:
                        m = _re.match(r'(.+)([+-])(\d{2}):(\d{2})$', dt_str)
                        if m:
                            naive_str = m.group(1)
                            sign = 1 if m.group(2) == '+' else -1
                            offset_mins = sign * (int(m.group(3)) * 60 + int(m.group(4)))
                            dt = datetime.fromisoformat(naive_str) - timedelta(minutes=offset_mins)
                            dt = dt.replace(tzinfo=_tz2.utc)
                        else:
                            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                            if dt.tzinfo is None:
                                dt = dt.replace(tzinfo=_tz2.utc)
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


@app.get("/gamification")
@app.get("/gamification/", include_in_schema=False)
async def get_gamification_history(
    limit: int = Query(30, ge=1, le=366),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    """Daily scoreboard stats for charts (newest last, same shape as dashboard gamification)."""
    today = _today_ct()
    out = []
    for i in range(limit - 1, -1, -1):
        day = today - timedelta(days=i)
        out.append(_gamification_row_for_date(session, user.id, day))
    return out


# ── Tags ──────────────────────────────────────────────────────────────────────

@app.get("/tags", response_model=List[TagResponse])
@app.get("/tags/", response_model=List[TagResponse], include_in_schema=False)
async def list_tags(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(select(Tag).where(Tag.user_id == user.id)).scalars().all()
    return rows

@app.post("/tags", response_model=TagResponse)
@app.post("/tags/", response_model=TagResponse, include_in_schema=False)
async def create_tag(
    data: TagCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    tag = Tag(name=data.name, color=data.color, user_id=user.id)
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

# ── Categories ────────────────────────────────────────────────────────────────

@app.get("/categories", response_model=List[CategoryResponse])
@app.get("/categories/", response_model=List[CategoryResponse], include_in_schema=False)
async def list_categories(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(select(Category).where(Category.user_id == user.id)).scalars().all()
    return rows

@app.post("/categories", response_model=CategoryResponse)
@app.post("/categories/", response_model=CategoryResponse, include_in_schema=False)
async def create_category(
    data: CategoryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    cat = Category(name=data.name, color=data.color, user_id=user.id)
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat

# ── Tasks ─────────────────────────────────────────────────────────────────────

@app.get("/api/tasks", response_model=List[TaskResponse])
@app.get("/api/tasks/", response_model=List[TaskResponse], include_in_schema=False)
async def list_tasks(
    status: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(Task).where(Task.user_id == user.id)
    if status:
        parts = [s.strip() for s in status.split(",") if s.strip()]
        if len(parts) > 1:
            q = q.where(Task.status.in_(parts))
        else:
            q = q.where(Task.status == parts[0])
    if project_id:
        q = q.where(Task.project_id == project_id)
    if search:
        term = f"%{search.strip()}%"
        q = q.where(Task.title.ilike(term))
    rows = session.execute(q.order_by(Task.sort_order, Task.created_at.desc())).scalars().all()
    return [_task_to_dict(t) for t in rows]


class TaskReorderBody(BaseModel):
    order: List[str]


class HabitCompleteBody(BaseModel):
    completed_date: str
    note: Optional[str] = None


@app.post("/api/tasks", response_model=TaskResponse)
@app.post("/api/tasks/", response_model=TaskResponse, include_in_schema=False)
async def create_task(
    data: TaskCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    focus = calc_focus_score(data.importance or 3, data.difficulty or 3)
    tag_str = tags_to_str(data.tag_ids)
    task = Task(
        title=data.title,
        description=data.description,
        notes=data.notes,
        status=data.status or "inbox",
        priority=data.priority or "medium",
        importance=data.importance or 3,
        difficulty=data.difficulty or 3,
        focus_score=focus,
        due_date=data.due_date,
        time_estimate_minutes=data.time_estimate_minutes,
        project_id=data.project_id,
        parent_id=data.parent_id,
        category_id=data.category_id,
        tag_ids=tag_str,
        show_in_daily=data.show_in_daily if data.show_in_daily is not None else True,
        user_id=user.id,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
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

@app.patch("/api/tasks/{task_id}", response_model=TaskResponse)
@app.put("/api/tasks/{task_id}", response_model=TaskResponse, include_in_schema=False)
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

    update_data = data.dict(exclude_unset=True)
    for field, value in update_data.items():
        if field == "tag_ids":
            setattr(task, field, tags_to_str(value))
        elif field in ("importance", "difficulty"):
            setattr(task, field, value)
            task.focus_score = calc_focus_score(
                task.importance or 3, task.difficulty or 3
            )
        else:
            setattr(task, field, value)

    if "status" in update_data and update_data["status"] == "done":
        if not task.completed_at:
            task.completed_at = datetime.now(_CT)
    elif "status" in update_data and update_data["status"] != "done":
        task.completed_at = None

    session.add(task)
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.delete("/api/tasks/{task_id}")
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

@app.post("/api/tasks/{task_id}/complete")
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
    task.completed_at = datetime.now(_CT)
    session.add(task)
    session.commit()
    return _task_to_dict(task)


@app.post("/api/tasks/reorder")
@app.post("/api/tasks/reorder/", include_in_schema=False)
async def reorder_tasks(
    body: TaskReorderBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    for i, tid in enumerate(body.order):
        task = session.execute(
            select(Task).where(Task.id == tid, Task.user_id == user.id)
        ).scalar()
        if task:
            task.sort_order = i
            session.add(task)
    session.commit()
    return {"detail": "ok"}


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
    entry = BraindumpEntry(content=data.content, user_id=user.id)
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
        select(BraindumpEntry).where(BraindumpEntry.id == entry_id, BraindumpEntry.user_id == user.id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    session.delete(entry)
    session.commit()
    return {"detail": "deleted"}

# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/projects", response_model=List[ProjectResponse])
@app.get("/projects/", response_model=List[ProjectResponse], include_in_schema=False)
async def list_projects(
    status: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(Project).where(Project.user_id == user.id)
    if status:
        q = q.where(Project.status == status)
    rows = session.execute(q.order_by(Project.created_at.desc())).scalars().all()
    return [_project_to_dict(p) for p in rows]

@app.post("/projects", response_model=ProjectResponse)
@app.post("/projects/", response_model=ProjectResponse, include_in_schema=False)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    project = Project(
        title=data.title, description=data.description,
        status=data.status or "active", color=data.color,
        priority=data.priority or "medium",
        due_date=data.due_date, user_id=user.id,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return _project_to_dict(project)

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
    return _project_to_dict(project)

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
@app.put("/projects/{project_id}", response_model=ProjectResponse, include_in_schema=False)
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
    for field, value in data.dict(exclude_unset=True).items():
        setattr(project, field, value)
    session.add(project)
    session.commit()
    session.refresh(project)
    return _project_to_dict(project)

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

@app.get("/habits", response_model=List[HabitResponse])
@app.get("/habits/", response_model=List[HabitResponse], include_in_schema=False)
async def list_habits(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(select(Habit).where(Habit.user_id == user.id)).scalars().all()
    return rows

@app.post("/habits", response_model=HabitResponse)
@app.post("/habits/", response_model=HabitResponse, include_in_schema=False)
async def create_habit(
    data: HabitCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = Habit(title=data.title, color=data.color, icon=data.icon, user_id=user.id)
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@app.patch("/habits/{habit_id}", response_model=HabitResponse)
@app.put("/habits/{habit_id}", response_model=HabitResponse, include_in_schema=False)
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
    for field, value in data.dict(exclude_unset=True).items():
        setattr(habit, field, value)
    session.add(habit)
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

@app.post("/habits/{habit_id}/complete", response_model=HabitCompletionResponse)
@app.post("/habits/{habit_id}/complete/", response_model=HabitCompletionResponse, include_in_schema=False)
async def complete_habit(
    habit_id: str,
    body: HabitCompleteBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    try:
        comp_date = date.fromisoformat(body.completed_date[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid completed_date")
    existing = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == comp_date,
        )
    ).scalar()
    if existing:
        return existing
    comp = HabitCompletion(habit_id=habit_id, completed_date=comp_date, note=body.note)
    session.add(comp)
    session.commit()
    session.refresh(comp)
    return comp


@app.delete("/habits/{habit_id}/complete/{completed_date}")
async def uncomplete_habit(
    habit_id: str,
    completed_date: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = session.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    ).scalar()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    try:
        comp_date = date.fromisoformat(completed_date[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid completed_date")
    existing = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == comp_date,
        )
    ).scalar()
    if not existing:
        raise HTTPException(status_code=404, detail="Completion not found")
    session.delete(existing)
    session.commit()
    return {"detail": "deleted"}


@app.get("/habits/{habit_id}/streak")
@app.get("/habits/{habit_id}/streak/", include_in_schema=False)
async def habit_streak_endpoint(
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
    return {"habit_id": habit_id, "streak": _habit_streak(habit_id, session, today)}


@app.post("/habits/{habit_id}/toggle")
async def toggle_habit(
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
    def _iso(dt):
        return dt.isoformat() if dt else None
    return {
        "id": entry.id,
        "task_id": entry.task_id,
        "started_at": _iso(entry.started_at),
        "ended_at": _iso(entry.ended_at),
        "duration_seconds": entry.duration_seconds,
        "created_at": _iso(entry.created_at),
    }

# ── MUST be declared before /time-entries and /time-entries/ list routes ──────
# FastAPI matches routes top-to-bottom; /active/ must come first or it gets
# consumed as /{entry_id} by the update_time_entry handler below.
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
        return None
    return _time_entry_to_dict(entry)

@app.get("/time-entries", response_model=List[TimeEntryResponse])
@app.get("/time-entries/", response_model=List[TimeEntryResponse], include_in_schema=False)
async def list_time_entries(
    task_id: Optional[int] = Query(None),
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

@app.patch("/time-entries/{entry_id}", response_model=TimeEntryResponse)
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
    for field, value in data.items():
        setattr(entry, field, value)
    session.add(entry)
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
    note = Note(title=data.title, content=data.content, user_id=user.id)
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

@app.patch("/notes/{note_id}", response_model=NoteResponse)
@app.put("/notes/{note_id}", response_model=NoteResponse, include_in_schema=False)
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
    for field, value in data.dict(exclude_unset=True).items():
        setattr(note, field, value)
    session.add(note)
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
        select(CRMPerson).where(CRMPerson.user_id == user.id)
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

@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
@app.put("/crm/{person_id}", response_model=CRMPersonResponse, include_in_schema=False)
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
    for field, value in data.dict(exclude_unset=True).items():
        setattr(person, field, value)
    session.add(person)
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

# ── Time Blocks ───────────────────────────────────────────────────────────────

@app.get("/api/time-blocks", response_model=List[TimeBlockResponse])
@app.get("/api/time-blocks/", response_model=List[TimeBlockResponse], include_in_schema=False)
async def list_time_blocks(
    date: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    q = select(TimeBlock).where(TimeBlock.user_id == user.id)
    if date:
        try:
            d = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            d = None
        if d is not None:
            day_start, day_end = _ct_calendar_day_bounds(d)
            q = q.where(TimeBlock.start_time >= day_start, TimeBlock.start_time < day_end)
    rows = session.execute(q.order_by(TimeBlock.start_time)).scalars().all()
    return rows

@app.post("/api/time-blocks", response_model=TimeBlockResponse)
@app.post("/api/time-blocks/", response_model=TimeBlockResponse, include_in_schema=False)
async def create_time_block(
    data: TimeBlockCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = TimeBlock(**data.dict(), user_id=user.id)
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.patch("/api/time-blocks/{block_id}", response_model=TimeBlockResponse)
@app.put("/api/time-blocks/{block_id}", response_model=TimeBlockResponse, include_in_schema=False)
async def update_time_block(
    block_id: str,
    data: TimeBlockUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = session.execute(
        select(TimeBlock).where(TimeBlock.id == block_id, TimeBlock.user_id == user.id)
    ).scalar()
    if not block:
        raise HTTPException(status_code=404, detail="Time block not found")
    for field, value in data.dict(exclude_unset=True).items():
        setattr(block, field, value)
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/api/time-blocks/{block_id}")
async def delete_time_block(
    block_id: str,
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

# ── Timer (start / stop) ──────────────────────────────────────────────────────

@app.post("/api/timer/start")
async def timer_start(
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    task_id = data.get("task_id")
    # Stop any currently running timer first
    running = session.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.ended_at == None,  # noqa: E711
        )
    ).scalars().all()
    now = datetime.now(_CT)
    for e in running:
        e.ended_at = now
        delta = now - e.started_at
        e.duration_seconds = int(delta.total_seconds())
        session.add(e)

    # Start new timer
    entry = TimeEntry(task_id=task_id, started_at=now, user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _time_entry_to_dict(entry)

@app.post("/api/timer/stop")
async def timer_stop(
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
        return {"detail": "no active timer"}
    now = datetime.now(_CT)
    entry.ended_at = now
    delta = now - entry.started_at
    entry.duration_seconds = int(delta.total_seconds())
    session.add(entry)
    session.commit()
    return _time_entry_to_dict(entry)

# ── Telegram Webhook ──────────────────────────────────────────────────────────

@app.post("/telegram/webhook")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    try:
        body = await request.json()
    except Exception:
        return Response(status_code=200)

    message = body.get("message") or body.get("edited_message")
    if not message:
        return Response(status_code=200)

    chat_id = message.get("chat", {}).get("id")
    from_id = str(message.get("from", {}).get("id", ""))
    text = message.get("text", "").strip()

    if TELEGRAM_OWNER_USER_ID and from_id != TELEGRAM_OWNER_USER_ID:
        return Response(status_code=200)

    if not text.lower().startswith("/task"):
        return Response(status_code=200)

    # Look up the owner user from DB
    owner_user = None
    if TELEGRAM_OWNER_USER_ID:
        owner_user = session.execute(
            select(User).order_by(User.id)
        ).scalar()

    if not owner_user:
        await telegram_send_message(chat_id, "No user account found.")
        return Response(status_code=200)

    try:
        task_data = parse_telegram_task(text)
    except ValueError as e:
        await telegram_send_message(chat_id, str(e))
        return Response(status_code=200)

    focus = calc_focus_score(task_data["importance"], task_data["difficulty"])
    task = Task(
        title=task_data["title"],
        status=task_data["status"],
        priority=task_data["priority"],
        importance=task_data["importance"],
        difficulty=task_data["difficulty"],
        focus_score=focus,
        notes=task_data["notes"],
        user_id=owner_user.id,
        show_in_daily=True,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    await telegram_send_message(
        chat_id,
        f"✅ Task created: {task.title}\nPriority: {task.priority} | Status: {task.status}"
    )
    return Response(status_code=200)

@app.get("/setup-webhook")
async def setup_webhook():
    if not TELEGRAM_BOT_TOKEN or not PUBLIC_BACKEND_URL:
        return {"error": "TELEGRAM_BOT_TOKEN or PUBLIC_BACKEND_URL not set"}
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json={"url": f"{PUBLIC_BACKEND_URL}/telegram/webhook"})
    return resp.json()

@app.get("/webhook-info")
async def webhook_info():
    if not TELEGRAM_BOT_TOKEN:
        return {"error": "TELEGRAM_BOT_TOKEN not set"}
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getWebhookInfo"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
    return resp.json()

# ── Favorite Sports Teams ─────────────────────────────────────────────────────

@app.get("/favorite-sports-teams", response_model=List[FavoriteSportsTeamResponse])
@app.get("/favorite-sports-teams/", response_model=List[FavoriteSportsTeamResponse], include_in_schema=False)
async def list_favorite_sports_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(FavoriteSportsTeam).where(FavoriteSportsTeam.user_id == user.id)
    ).scalars().all()
    return rows

@app.post("/favorite-sports-teams", response_model=FavoriteSportsTeamResponse)
@app.post("/favorite-sports-teams/", response_model=FavoriteSportsTeamResponse, include_in_schema=False)
async def create_favorite_sports_team(
    data: FavoriteSportsTeamCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = FavoriteSportsTeam(**data.dict(), user_id=user.id)
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

@app.delete("/favorite-sports-teams/{team_id}")
async def delete_favorite_sports_team(
    team_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = session.execute(
        select(FavoriteSportsTeam).where(FavoriteSportsTeam.id == team_id, FavoriteSportsTeam.user_id == user.id)
    ).scalar()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    session.delete(team)
    session.commit()
    return {"detail": "deleted"}
