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

# ── Telegram Bot ──────────────────────────────────────────────────────────────

@app.post("/telegram/webhook")
async def telegram_webhook(request: Request, session: Session = Depends(db.get_session)):
    """Receive updates from Telegram and process bot commands."""
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False}
    try:
        update = await request.json()
    except Exception:
        return {"ok": False}

    message = update.get("message") or update.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "").strip()
    sender_id = str(message.get("from", {}).get("id", ""))

    if not chat_id or not text:
        return {"ok": True}

    # Security: only allow the configured owner
    if TELEGRAM_OWNER_USER_ID and sender_id != TELEGRAM_OWNER_USER_ID:
        await telegram_send_message(chat_id, "⛔ Unauthorized.")
        return {"ok": True}

    lower = text.lower()

    if lower in ("/start", "/help"):
        await telegram_send_message(
            chat_id,
            "👋 CommandCenter Bot\n\n"
            "/task [title] — Add a task (prefix ! for high priority)\n"
            "/today — List today's tasks\n"
            "/help — Show this message",
        )
        return {"ok": True}

    if lower.startswith("/task"):
        owner_user = session.execute(select(User)).scalars().first()
        if not owner_user:
            await telegram_send_message(chat_id, "❌ No user found in CommandCenter.")
            return {"ok": True}
        try:
            task_data = parse_telegram_task(text)
        except ValueError as e:
            await telegram_send_message(chat_id, f"❌ {e}")
            return {"ok": True}
        fs = calc_focus_score(task_data["importance"], task_data["difficulty"])
        task = Task(
            title=task_data["title"],
            status=task_data["status"],
            priority=task_data["priority"],
            importance=task_data["importance"],
            difficulty=task_data["difficulty"],
            focus_score=fs,
            notes=task_data["notes"],
            user_id=owner_user.id,
        )
        session.add(task)
        session.commit()
        session.refresh(task)
        await telegram_send_message(
            chat_id,
            f"✅ Task created: \"{task.title}\"\nPriority: {task.priority} | Status: {task.status}",
        )
        return {"ok": True}

    if lower == "/today":
        owner_user = session.execute(select(User)).scalars().first()
        if not owner_user:
            await telegram_send_message(chat_id, "❌ No user found.")
            return {"ok": True}
        tasks = session.execute(
            select(Task).where(
                Task.user_id == owner_user.id,
                Task.status.in_(["today", "in_progress"]),
            ).order_by(Task.sort_order.asc())
        ).scalars().all()
        if not tasks:
            await telegram_send_message(chat_id, "📋 No tasks for today.")
        else:
            lines = [f"📋 Today's Tasks ({len(tasks)}):"]
            for i, t in enumerate(tasks, 1):
                lines.append(f"{i}. [{t.priority.upper()}] {t.title}")
            await telegram_send_message(chat_id, "\n".join(lines))
        return {"ok": True}

    await telegram_send_message(chat_id, "❓ Unknown command. Send /help for options.")
    return {"ok": True}


@app.get("/telegram/setup-webhook")
async def setup_telegram_webhook():
    """One-time admin call to register this backend's webhook URL with Telegram."""
    if not TELEGRAM_BOT_TOKEN or not PUBLIC_BACKEND_URL:
        return {"error": "TELEGRAM_BOT_TOKEN or PUBLIC_BACKEND_URL not set"}
    webhook_url = f"{PUBLIC_BACKEND_URL.rstrip('/')}/telegram/webhook"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
            json={"url": webhook_url},
        )
    return resp.json()


@app.get("/telegram/webhook-info")
async def telegram_webhook_info():
    """Check what webhook URL Telegram currently has on record."""
    if not TELEGRAM_BOT_TOKEN:
        return {"error": "TELEGRAM_BOT_TOKEN not set"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getWebhookInfo"
        )
    return resp.json()

# ── Auth ──────────────────────────────────────────────────────────────────────

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
    time_min = now_ct.isoformat()
    # Look ahead 24 hours
    time_max = (now_ct + timedelta(hours=24)).isoformat()

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

# ── Tasks ─────────────────────────────────────────────────────────────────────

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
@app.get("/tasks/{task_id}/", response_model=TaskResponse, include_in_schema=False)
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

@app.patch("/tasks/{task_id}", response_model=TaskResponse)
@app.patch("/tasks/{task_id}/", response_model=TaskResponse, include_in_schema=False)
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
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "tag_ids":
            setattr(task, field, tags_to_str(value))
        else:
            setattr(task, field, value)
    if "importance" in update_data or "difficulty" in update_data:
        task.focus_score = calc_focus_score(task.importance or 3, task.difficulty or 3)
    if update_data.get("status") == "done" and not task.completed_at:
        task.completed_at = datetime.utcnow()
    elif update_data.get("status") and update_data["status"] != "done":
        task.completed_at = None
    task.updated_at = datetime.utcnow()
    session.add(task)
    session.commit()
    session.refresh(task)
    return _task_to_dict(task)

@app.delete("/tasks/{task_id}")
@app.delete("/tasks/{task_id}/", include_in_schema=False)
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
    data: dict = {},
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
    if data.get("actual_time_minutes"):
        task.actual_time_minutes = data["actual_time_minutes"]
    task.updated_at = datetime.utcnow()
    session.add(task)
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
    ordered_ids = data.get("task_ids", [])
    for idx, task_id in enumerate(ordered_ids):
        task = session.execute(
            select(Task).where(Task.id == task_id, Task.user_id == user.id)
        ).scalar()
        if task:
            task.sort_order = idx
            session.add(task)
    session.commit()
    return {"detail": "reordered"}

# ── Projects ──────────────────────────────────────────────────────────────────

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
        tasks = session.execute(
            select(Task).where(Task.project_id == p.id, Task.user_id == user.id)
        ).scalars().all()
        done_count = sum(1 for t in tasks if t.status == "done")
        pct = int((done_count / len(tasks) * 100) if tasks else 0)
        d = _project_to_dict(p)
        d["task_count"] = len(tasks)
        d["completion_percentage"] = pct
        result.append(d)
    return result

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
        priority=data.priority or "medium", due_date=data.due_date,
        user_id=user.id,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    d = _project_to_dict(project)
    d["task_count"] = 0
    d["completion_percentage"] = 0
    return d

@app.get("/projects/{project_id}", response_model=ProjectResponse)
@app.get("/projects/{project_id}/", response_model=ProjectResponse, include_in_schema=False)
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
    tasks = session.execute(
        select(Task).where(Task.project_id == project_id, Task.user_id == user.id)
    ).scalars().all()
    done_count = sum(1 for t in tasks if t.status == "done")
    pct = int((done_count / len(tasks) * 100) if tasks else 0)
    d = _project_to_dict(project)
    d["tasks"] = [_task_to_dict(t) for t in tasks]
    d["task_count"] = len(tasks)
    d["completion_percentage"] = pct
    return d

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
@app.patch("/projects/{project_id}/", response_model=ProjectResponse, include_in_schema=False)
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
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    tasks = session.execute(
        select(Task).where(Task.project_id == project_id, Task.user_id == user.id)
    ).scalars().all()
    done_count = sum(1 for t in tasks if t.status == "done")
    pct = int((done_count / len(tasks) * 100) if tasks else 0)
    d = _project_to_dict(project)
    d["task_count"] = len(tasks)
    d["completion_percentage"] = pct
    return d

@app.delete("/projects/{project_id}")
@app.delete("/projects/{project_id}/", include_in_schema=False)
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

def _habit_to_dict(habit: Habit, session: Session, today: date) -> dict:
    comp = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit.id,
            HabitCompletion.completed_date == today,
        )
    ).scalar()
    completed = comp is not None
    streak = _habit_streak(habit.id, session, today)
    return {
        "id": habit.id,
        "title": habit.title,
        "name": habit.title,
        "description": habit.description,
        "color": habit.color,
        "frequency": habit.frequency,
        "icon": habit.icon,
        "custom_days": habit.custom_days,
        "target_minutes": habit.target_minutes,
        "time_hour": habit.time_hour,
        "time_minute": habit.time_minute,
        "sort_order": habit.sort_order,
        "is_active": habit.is_active,
        "created_at": habit.created_at,
        "updated_at": habit.updated_at,
        "completed_today": completed,
        "completed": completed,
        "streak": streak,
    }

@app.get("/habits", response_model=List[HabitResponse])
@app.get("/habits/", response_model=List[HabitResponse], include_in_schema=False)
async def list_habits(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    today = _today_ct()
    rows = session.execute(
        select(Habit).where(Habit.user_id == user.id).order_by(Habit.sort_order.asc(), Habit.created_at.asc())
    ).scalars().all()
    return [_habit_to_dict(h, session, today) for h in rows]

@app.post("/habits", response_model=HabitResponse)
@app.post("/habits/", response_model=HabitResponse, include_in_schema=False)
async def create_habit(
    data: HabitCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    habit = Habit(
        title=data.name or data.title,
        description=data.description,
        color=data.color,
        frequency=data.frequency or "daily",
        icon=data.icon,
        custom_days=data.custom_days,
        target_minutes=data.target_minutes,
        time_hour=data.time_hour,
        time_minute=data.time_minute,
        sort_order=data.sort_order or 0,
        user_id=user.id,
    )
    session.add(habit)
    session.commit()
    session.refresh(habit)
    today = _today_ct()
    return _habit_to_dict(habit, session, today)

@app.patch("/habits/{habit_id}", response_model=HabitResponse)
@app.patch("/habits/{habit_id}/", response_model=HabitResponse, include_in_schema=False)
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
    update_data = data.model_dump(exclude_unset=True)
    if "name" in update_data:
        habit.title = update_data.pop("name")
    for field, value in update_data.items():
        if hasattr(habit, field):
            setattr(habit, field, value)
    habit.updated_at = datetime.utcnow()
    session.add(habit)
    session.commit()
    session.refresh(habit)
    today = _today_ct()
    return _habit_to_dict(habit, session, today)

@app.delete("/habits/{habit_id}")
@app.delete("/habits/{habit_id}/", include_in_schema=False)
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
    if not existing:
        comp = HabitCompletion(habit_id=habit_id, completed_date=today)
        session.add(comp)
        session.commit()
    return _habit_to_dict(habit, session, today)

@app.delete("/habits/{habit_id}/complete")
@app.delete("/habits/{habit_id}/complete/", include_in_schema=False)
async def uncomplete_habit(
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
    return _habit_to_dict(habit, session, today)

@app.post("/habits/reorder")
@app.post("/habits/reorder/", include_in_schema=False)
async def reorder_habits(
    data: dict,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    ordered_ids = data.get("habit_ids", [])
    for idx, habit_id in enumerate(ordered_ids):
        habit = session.execute(
            select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
        ).scalar()
        if habit:
            habit.sort_order = idx
            session.add(habit)
    session.commit()
    return {"detail": "reordered"}

# ── Time Entries ──────────────────────────────────────────────────────────────

def _time_entry_to_dict(entry: TimeEntry) -> dict:
    if not entry:
        return None
    return {
        "id": entry.id,
        "task_id": entry.task_id,
        "habit_id": entry.habit_id,
        "started_at": entry.started_at,
        "ended_at": entry.ended_at,
        "duration_seconds": entry.duration_seconds,
        "note": entry.note,
        "created_at": entry.created_at,
    }

@app.get("/time-entries", response_model=List[TimeEntryResponse])
@app.get("/time-entries/", response_model=List[TimeEntryResponse], include_in_schema=False)
async def list_time_entries(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(TimeEntry).where(TimeEntry.user_id == user.id).order_by(TimeEntry.started_at.desc())
    ).scalars().all()
    return [_time_entry_to_dict(e) for e in rows]

@app.post("/time-entries", response_model=TimeEntryResponse)
@app.post("/time-entries/", response_model=TimeEntryResponse, include_in_schema=False)
async def create_time_entry(
    data: TimeEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = TimeEntry(
        task_id=data.task_id,
        habit_id=data.habit_id,
        started_at=data.started_at or datetime.utcnow(),
        ended_at=data.ended_at,
        note=data.note,
        user_id=user.id,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _time_entry_to_dict(entry)

@app.patch("/time-entries/{entry_id}")
@app.patch("/time-entries/{entry_id}/", include_in_schema=False)
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
        if hasattr(entry, field):
            setattr(entry, field, value)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _time_entry_to_dict(entry)

@app.delete("/time-entries/{entry_id}")
@app.delete("/time-entries/{entry_id}/", include_in_schema=False)
async def delete_time_entry(
    entry_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = session.execute(
        select(TimeEntry).where(TimeEntry.id == entry_id, TimeEntry.user_id == user.id)
    ).scalar()
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")
    session.delete(entry)
    session.commit()
    return {"detail": "deleted"}

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
    note = Note(
        title=data.title, content=data.content,
        tags=data.tags, user_id=user.id,
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@app.patch("/notes/{note_id}", response_model=NoteResponse)
@app.patch("/notes/{note_id}/", response_model=NoteResponse, include_in_schema=False)
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
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(note, field, value)
    note.updated_at = datetime.utcnow()
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@app.delete("/notes/{note_id}")
@app.delete("/notes/{note_id}/", include_in_schema=False)
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
        select(CRMPerson).where(CRMPerson.user_id == user.id).order_by(CRMPerson.name.asc())
    ).scalars().all()
    return rows

@app.post("/crm", response_model=CRMPersonResponse)
@app.post("/crm/", response_model=CRMPersonResponse, include_in_schema=False)
async def create_crm_person(
    data: CRMPersonCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    person = CRMPerson(
        name=data.name, email=data.email, phone=data.phone,
        company=data.company, notes=data.notes,
        last_contacted=data.last_contacted, user_id=user.id,
    )
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

@app.patch("/crm/{person_id}", response_model=CRMPersonResponse)
@app.patch("/crm/{person_id}/", response_model=CRMPersonResponse, include_in_schema=False)
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
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(person, field, value)
    person.updated_at = datetime.utcnow()
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

@app.delete("/crm/{person_id}")
@app.delete("/crm/{person_id}/", include_in_schema=False)
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

@app.get("/time-blocks", response_model=List[TimeBlockResponse])
@app.get("/time-blocks/", response_model=List[TimeBlockResponse], include_in_schema=False)
async def list_time_blocks(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(TimeBlock).where(TimeBlock.user_id == user.id).order_by(TimeBlock.start_time.asc())
    ).scalars().all()
    return rows

@app.post("/time-blocks", response_model=TimeBlockResponse)
@app.post("/time-blocks/", response_model=TimeBlockResponse, include_in_schema=False)
async def create_time_block(
    data: TimeBlockCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    block = TimeBlock(
        title=data.title, start_time=data.start_time,
        end_time=data.end_time, color=data.color, user_id=user.id,
    )
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.patch("/time-blocks/{block_id}", response_model=TimeBlockResponse)
@app.patch("/time-blocks/{block_id}/", response_model=TimeBlockResponse, include_in_schema=False)
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
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(block, field, value)
    block.updated_at = datetime.utcnow()
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/time-blocks/{block_id}")
@app.delete("/time-blocks/{block_id}/", include_in_schema=False)
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

# ── Braindump ─────────────────────────────────────────────────────────────────

@app.get("/braindump", response_model=List[BraindumpEntryResponse])
@app.get("/braindump/", response_model=List[BraindumpEntryResponse], include_in_schema=False)
async def list_braindump(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(BraindumpEntry).where(BraindumpEntry.user_id == user.id).order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()
    return rows

@app.post("/braindump", response_model=BraindumpEntryResponse)
@app.post("/braindump/", response_model=BraindumpEntryResponse, include_in_schema=False)
async def create_braindump_entry(
    data: BraindumpEntryCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    entry = BraindumpEntry(raw_text=data.raw_text, user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.delete("/braindump/{entry_id}")
@app.delete("/braindump/{entry_id}/", include_in_schema=False)
async def delete_braindump_entry(
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

# ── Sports Teams ──────────────────────────────────────────────────────────────

@app.get("/sports/favorites", response_model=List[FavoriteSportsTeamResponse])
@app.get("/sports/favorites/", response_model=List[FavoriteSportsTeamResponse], include_in_schema=False)
async def list_favorite_teams(
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    rows = session.execute(
        select(FavoriteSportsTeam).where(FavoriteSportsTeam.user_id == user.id)
    ).scalars().all()
    return rows

@app.post("/sports/favorites", response_model=FavoriteSportsTeamResponse)
@app.post("/sports/favorites/", response_model=FavoriteSportsTeamResponse, include_in_schema=False)
async def add_favorite_team(
    data: FavoriteSportsTeamCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = FavoriteSportsTeam(
        team_name=data.team_name,
        league=data.league,
        sport=data.sport,
        user_id=user.id,
    )
    session.add(team)
    session.commit()
    session.refresh(team)
    return team

@app.delete("/sports/favorites/{team_id}")
@app.delete("/sports/favorites/{team_id}/", include_in_schema=False)
async def remove_favorite_team(
    team_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
):
    team = session.execute(
        select(FavoriteSportsTeam).where(
            FavoriteSportsTeam.id == team_id,
            FavoriteSportsTeam.user_id == user.id,
        )
    ).scalar()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    session.delete(team)
    session.commit()
    return {"detail": "deleted"}
