from fastapi import FastAPI, Depends, HTTPException, Query, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, text, update
from datetime import datetime, timedelta, date
import os
from typing import Optional, List

import db
from models import Task, Project, Habit, HabitCompletion, TimeEntry, Note, CRMPerson, TimeBlock, Tag, Category, BraindumpEntry
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
)
from auth import get_current_user, create_access_token, verify_token
from schemas import UserCreate, UserResponse, UserLogin

app = FastAPI(title="CommandCenter API")

# CORS — allow everything; DO App Platform edge handles TLS termination
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Explicit OPTIONS handler — ensures preflight never hits the DO edge CORS filter
@app.options("/{rest_of_path:path}")
async def preflight_handler(rest_of_path: str):
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "86400",
        },
    )

# NOTE: datetime.now() respects the TZ environment variable (set to America/Chicago in DO).
# datetime.utcnow() always returns UTC regardless of TZ — never use it here.

# All routes live on this router.
# It is mounted at both "" (root) AND "/api" so the frontend's calls to
# /dashboard/, /tasks/, etc. resolve, AND old /api/... URLs still work.
router = APIRouter()

# ─── Auth ─────────────────────────────────────────────
from models import User

@router.post("/auth/register", response_model=UserResponse)
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

@router.post("/auth/login")
async def login(data: UserLogin, session: Session = Depends(db.get_session)):
    user = session.execute(select(User).where(User.email == data.email)).scalar()
    if not user or not user.check_password(data.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}

# ─── Tasks ─────────────────────────────────────────────
@router.get("/tasks/", response_model=List[TaskResponse])
async def list_tasks(
    status: Optional[str] = None,
    search: Optional[str] = None,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    query = select(Task).where(Task.user_id == user.id)
    if status:
        statuses = [s.strip() for s in status.split(",")]
        query = query.where(Task.status.in_(statuses))
    if search:
        query = query.where(Task.title.ilike(f"%{search}%"))
    tasks = session.execute(query.order_by(Task.created_at.desc())).scalars().all()
    return tasks

@router.get("/tasks/today", response_model=List[TaskResponse])
async def today_tasks(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    today = datetime.now().date()
    query = select(Task).where(
        (Task.user_id == user.id) &
        (Task.status.in_(["today", "in_progress"])) |
        ((Task.due_date == today) & (Task.status != "done"))
    )
    return session.execute(query.order_by(Task.order)).scalars().all()

@router.post("/tasks/", response_model=TaskResponse)
async def create_task(
    data: TaskCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = Task(**data.dict(), user_id=user.id)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task

@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    return task

@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task_patch(
    task_id: str,
    data: TaskUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    previous_status = task.status
    for key, value in updates.items():
        setattr(task, key, value)
    if updates.get("status") == "done" and previous_status != "done":
        task.completed_at = datetime.now()
    elif updates.get("status") and updates.get("status") != "done" and previous_status == "done":
        task.completed_at = None
    session.commit()
    session.refresh(task)
    return task

# PUT alias — frontend uses PUT to avoid DO edge proxy blocking PATCH preflight
@router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task_put(
    task_id: str,
    data: TaskUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    previous_status = task.status
    for key, value in updates.items():
        setattr(task, key, value)
    if updates.get("status") == "done" and previous_status != "done":
        task.completed_at = datetime.now()
    elif updates.get("status") and updates.get("status") != "done" and previous_status == "done":
        task.completed_at = None
    session.commit()
    session.refresh(task)
    return task

@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(task)
    session.commit()
    return {"ok": True}

@router.post("/tasks/{task_id}/complete", response_model=TaskResponse)
async def complete_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    task.status = "done"
    task.completed_at = datetime.now()
    session.commit()
    session.refresh(task)
    return task

@router.post("/tasks/reorder")
async def reorder_tasks(
    ids: List[str],
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    for idx, task_id in enumerate(ids):
        task = session.execute(select(Task).where(Task.id == task_id)).scalar()
        if task and task.user_id == user.id:
            task.order = idx
    session.commit()
    return {"ok": True}

# ─── Projects ────────────────────────────────────────────
@router.get("/projects/", response_model=List[ProjectResponse])
async def list_projects(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    projects = session.execute(
        select(Project).where(Project.user_id == user.id).order_by(Project.created_at.desc())
    ).scalars().all()
    return projects

@router.post("/projects/", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    project = Project(**data.dict(), user_id=user.id)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project

@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404)
    return project

@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project_patch(
    project_id: str,
    data: ProjectUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(project, key, value)
    session.commit()
    session.refresh(project)
    return project

# PUT alias for projects
@router.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project_put(
    project_id: str,
    data: ProjectUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(project, key, value)
    session.commit()
    session.refresh(project)
    return project

@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(project)
    session.commit()
    return {"ok": True}

# ─── Time Blocks ─────────────────────────────────────────
@router.get("/time-blocks/", response_model=List[TimeBlockResponse])
async def list_time_blocks(
    date: Optional[str] = None,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    query = select(TimeBlock).where(TimeBlock.user_id == user.id)
    if date:
        target_date = datetime.fromisoformat(date).date()
        query = query.where(
            (TimeBlock.start_time >= target_date) &
            (TimeBlock.start_time < target_date + timedelta(days=1))
        )
    blocks = session.execute(query.order_by(TimeBlock.start_time)).scalars().all()
    return blocks

@router.post("/time-blocks/", response_model=TimeBlockResponse)
async def create_time_block(
    data: TimeBlockCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    block = TimeBlock(**data.dict(), user_id=user.id)
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@router.delete("/time-blocks/{block_id}")
async def delete_time_block(
    block_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    block = session.execute(select(TimeBlock).where(TimeBlock.id == block_id)).scalar()
    if not block or block.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(block)
    session.commit()
    return {"ok": True}

# ─── Habits ────────────────────────────────────────────

def _serialize_habit(data_dict: dict) -> dict:
    """Convert custom_days list to CSV string for storage."""
    if "custom_days" in data_dict:
        cd = data_dict["custom_days"]
        data_dict["custom_days"] = ",".join(str(d) for d in cd) if cd else None
    return data_dict

@router.get("/habits/", response_model=List[HabitResponse])
async def list_habits(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habits = session.execute(
        select(Habit).where(Habit.user_id == user.id).order_by(Habit.created_at.desc())
    ).scalars().all()
    return habits

@router.post("/habits/", response_model=HabitResponse)
async def create_habit(
    data: HabitCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    payload = _serialize_habit(data.dict())
    habit = Habit(**payload, user_id=user.id)
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@router.patch("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit_patch(
    habit_id: str,
    data: HabitUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    updates = _serialize_habit(data.dict(exclude_unset=True))
    for key, value in updates.items():
        setattr(habit, key, value)
    session.commit()
    session.refresh(habit)
    return habit

# PUT alias for habits
@router.put("/habits/{habit_id}", response_model=HabitResponse)
async def update_habit_put(
    habit_id: str,
    data: HabitUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    updates = _serialize_habit(data.dict(exclude_unset=True))
    for key, value in updates.items():
        setattr(habit, key, value)
    session.commit()
    session.refresh(habit)
    return habit

@router.delete("/habits/{habit_id}")
async def delete_habit(
    habit_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(habit)
    session.commit()
    return {"ok": True}

@router.post("/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    completed_date = datetime.fromisoformat(data["completed_date"]).date()
    existing = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == completed_date,
        )
    ).scalar()
    if not existing:
        completion = HabitCompletion(
            habit_id=habit_id,
            completed_date=completed_date,
            note=data.get("note"),
        )
        session.add(completion)
        session.commit()
    return {"ok": True}

@router.delete("/habits/{habit_id}/complete/{date_str}")
async def uncomplete_habit(
    habit_id: str,
    date_str: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    target_date = date.fromisoformat(date_str)
    completion = session.execute(
        select(HabitCompletion).where(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == target_date,
        )
    ).scalar()
    if completion:
        session.delete(completion)
        session.commit()
    return {"ok": True}

@router.get("/habits/{habit_id}/streak")
async def get_habit_streak(
    habit_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    completions = session.execute(
        select(HabitCompletion).where(HabitCompletion.habit_id == habit_id)
        .order_by(HabitCompletion.completed_date.desc())
    ).scalars().all()
    if not completions:
        return {"habit_id": habit_id, "streak": 0}
    streak = 0
    today = datetime.now().date()
    for i, comp in enumerate(completions):
        if comp.completed_date == today - timedelta(days=i):
            streak += 1
        else:
            break
    return {"habit_id": habit_id, "streak": streak}

# ─── Time Entries ─────────────────────────────────────────
@router.get("/time-entries/active", response_model=Optional[TimeEntryResponse])
async def get_active_timer(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    entry = session.execute(
        select(TimeEntry)
        .where((TimeEntry.user_id == user.id) & (TimeEntry.ended_at.is_(None)))
        .order_by(TimeEntry.started_at.desc())
    ).scalar()
    return entry

@router.post("/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(
    data: TimeEntryCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    session.execute(
        update(TimeEntry)
        .where((TimeEntry.user_id == user.id) & (TimeEntry.ended_at.is_(None)))
        .values(ended_at=datetime.now())
    )
    entry = TimeEntry(
        user_id=user.id,
        task_id=data.task_id,
        habit_id=data.habit_id,
        started_at=data.started_at,
        note=data.note,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@router.post("/time-entries/{entry_id}/stop", response_model=TimeEntryResponse)
async def stop_timer(
    entry_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    entry = session.execute(select(TimeEntry).where(TimeEntry.id == entry_id)).scalar()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404)
    entry.ended_at = datetime.fromisoformat(data["ended_at"])
    session.commit()
    session.refresh(entry)
    return entry

# ─── Dashboard ──────────────────────────────────────────
@router.get("/dashboard/")
async def get_dashboard(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    now = datetime.now()
    today = now.date()
    today_start = datetime(today.year, today.month, today.day)

    today_task_rows = session.execute(
        select(Task).where(
            (Task.user_id == user.id) &
            (Task.status.in_(["today", "in_progress"]))
        ).order_by(Task.order)
    ).scalars().all()

    overdue_rows = session.execute(
        select(Task).where(
            (Task.user_id == user.id) &
            (Task.status != "done") &
            (Task.due_date != None) &
            (Task.due_date < today)
        ).order_by(Task.due_date)
    ).scalars().all()

    completed_rows = session.execute(
        select(Task).where(
            (Task.user_id == user.id) &
            (Task.status == "done") &
            (Task.completed_at >= today_start)
        )
    ).scalars().all()

    habits_rows = session.execute(
        select(Habit).where(Habit.user_id == user.id).order_by(Habit.created_at.desc())
    ).scalars().all()
    habits_data = []
    for h in habits_rows:
        completions = session.execute(
            select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
            .order_by(HabitCompletion.completed_date.desc())
            .limit(30)
        ).scalars().all()
        habits_data.append({
            "id": h.id,
            "name": h.name,
            "icon": getattr(h, "icon", None),
            "frequency": h.frequency,
            "color": getattr(h, "color", "#e8a820"),
            "sort_order": getattr(h, "sort_order", 0),
            "is_active": getattr(h, "is_active", True),
            "time_hour": getattr(h, "time_hour", None),
            "time_minute": getattr(h, "time_minute", None),
            "completions": [{"completed_date": str(c.completed_date)} for c in completions],
        })

    projects_rows = session.execute(
        select(Project).where(
            (Project.user_id == user.id) &
            (Project.status == "active")
        ).order_by(Project.created_at.desc())
    ).scalars().all()
    projects_data = []
    for p in projects_rows:
        all_tasks = session.execute(
            select(Task).where(Task.project_id == p.id)
        ).scalars().all()
        done_tasks = [t for t in all_tasks if t.status == "done"]
        pct = round(len(done_tasks) / len(all_tasks) * 100) if all_tasks else 0
        projects_data.append({
            "id": p.id,
            "title": p.title,
            "status": p.status,
            "task_count": len(all_tasks),
            "completion_percentage": pct,
        })

    time_entries = session.execute(
        select(TimeEntry).where(
            (TimeEntry.user_id == user.id) &
            (TimeEntry.started_at >= today_start)
        )
    ).scalars().all()
    total_seconds = sum(
        int(((e.ended_at or datetime.now()) - e.started_at).total_seconds())
        for e in time_entries
    )

    completed_count = len(completed_rows)
    attempted_count = len(today_task_rows) + completed_count
    batting_avg = round(completed_count / attempted_count, 3) if attempted_count > 0 else 0.0

    streak = 0
    check_date = today
    while True:
        ds = datetime(check_date.year, check_date.month, check_date.day)
        de = ds + timedelta(days=1)
        hit = session.execute(
            select(Task).where(
                (Task.user_id == user.id) &
                (Task.status == "done") &
                (Task.completed_at >= ds) &
                (Task.completed_at < de)
            )
        ).scalars().first()
        if hit:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break

    habits_done_today = sum(
        1 for h in habits_data
        if any(c["completed_date"] == str(today) for c in h["completions"])
    )

    gamification = {
        "stat_date": str(today),
        "tasks_completed": completed_count,
        "tasks_attempted": attempted_count,
        "habits_completed": habits_done_today,
        "total_focus_minutes": round(total_seconds / 60),
        "home_runs": len([t for t in completed_rows if getattr(t, "priority", "") == "critical"]),
        "hits": completed_count,
        "strikeouts": len(overdue_rows),
        "batting_average": batting_avg,
        "hitting_streak": streak,
    }

    return {
        "today_tasks": [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": getattr(t, "priority", None),
                "due_date": str(t.due_date) if t.due_date else None,
                "project_id": getattr(t, "project_id", None),
                "focus_score": getattr(t, "focus_score", 0),
                "importance": getattr(t, "importance", 3),
                "difficulty": getattr(t, "difficulty", 3),
                "sort_order": getattr(t, "order", 0),
                "actual_time_minutes": getattr(t, "time_estimate_minutes", 0) or 0,
                "subtasks": [],
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "notes": getattr(t, "notes", None),
                "description": getattr(t, "description", None),
                "tag_ids": [],
                "show_in_daily": True,
                "time_estimate_minutes": getattr(t, "time_estimate_minutes", None),
                "parent_id": None,
                "category_id": getattr(t, "category_id", None),
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            }
            for t in today_task_rows
        ],
        "overdue_tasks": [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "due_date": str(t.due_date) if t.due_date else None,
            }
            for t in overdue_rows
        ],
        "completed_tasks_today": completed_count,
        "total_tasks_today": attempted_count,
        "today_habits": habits_data,
        "active_projects": projects_data,
        "time_tracked_seconds": total_seconds,
        "gamification": gamification,
    }

# ─── Gamification history ──────────────────────────────────
@router.get("/gamification/")
async def get_gamification_history(
    limit: int = Query(30, ge=1, le=90),
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    today = datetime.now().date()
    results = []
    for i in range(limit):
        day = today - timedelta(days=i)
        ds = datetime(day.year, day.month, day.day)
        de = ds + timedelta(days=1)

        done = session.execute(
            select(Task).where(
                (Task.user_id == user.id) &
                (Task.status == "done") &
                (Task.completed_at >= ds) &
                (Task.completed_at < de)
            )
        ).scalars().all()

        time_entries = session.execute(
            select(TimeEntry).where(
                (TimeEntry.user_id == user.id) &
                (TimeEntry.started_at >= ds) &
                (TimeEntry.started_at < de)
            )
        ).scalars().all()
        secs = sum(
            int(((e.ended_at or datetime.now()) - e.started_at).total_seconds())
            for e in time_entries
        )

        n_done = len(done)
        results.append({
            "stat_date": str(day),
            "tasks_completed": n_done,
            "tasks_attempted": n_done,
            "habits_completed": 0,
            "total_focus_minutes": round(secs / 60),
            "home_runs": len([t for t in done if getattr(t, "priority", "") == "critical"]),
            "hits": n_done,
            "strikeouts": 0,
            "batting_average": 1.0 if n_done > 0 else 0.0,
            "hitting_streak": 0,
        })
    return list(reversed(results))

# ─── Tags & Categories ─────────────────────────────────────
@router.get("/tags/", response_model=List[TagResponse])
async def list_tags(session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    return session.execute(select(Tag).where(Tag.user_id == user.id)).scalars().all()

@router.post("/tags/", response_model=TagResponse)
async def create_tag(data: TagCreate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    tag = Tag(**data.dict(), user_id=user.id)
    session.add(tag); session.commit(); session.refresh(tag)
    return tag

@router.get("/categories/", response_model=List[CategoryResponse])
async def list_categories(session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    return session.execute(select(Category).where(Category.user_id == user.id)).scalars().all()

@router.post("/categories/", response_model=CategoryResponse)
async def create_category(data: CategoryCreate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    category = Category(**data.dict(), user_id=user.id)
    session.add(category); session.commit(); session.refresh(category)
    return category

# ─── Notes ────────────────────────────────────────────
@router.get("/notes/", response_model=List[NoteResponse])
async def list_notes(session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    return session.execute(select(Note).where(Note.user_id == user.id).order_by(Note.created_at.desc())).scalars().all()

@router.post("/notes/", response_model=NoteResponse)
async def create_note(data: NoteCreate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    note = Note(**data.dict(), user_id=user.id)
    session.add(note); session.commit(); session.refresh(note)
    return note

@router.patch("/notes/{note_id}", response_model=NoteResponse)
async def update_note_patch(note_id: str, data: NoteUpdate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    note = session.execute(select(Note).where(Note.id == note_id)).scalar()
    if not note or note.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(note, key, value)
    session.commit(); session.refresh(note)
    return note

@router.put("/notes/{note_id}", response_model=NoteResponse)
async def update_note_put(note_id: str, data: NoteUpdate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    note = session.execute(select(Note).where(Note.id == note_id)).scalar()
    if not note or note.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(note, key, value)
    session.commit(); session.refresh(note)
    return note

@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    note = session.execute(select(Note).where(Note.id == note_id)).scalar()
    if not note or note.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(note); session.commit()
    return {"ok": True}

# ─── CRM ────────────────────────────────────────────
@router.get("/crm/", response_model=List[CRMPersonResponse])
async def list_crm(session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    return session.execute(select(CRMPerson).where(CRMPerson.user_id == user.id).order_by(CRMPerson.created_at.desc())).scalars().all()

@router.post("/crm/", response_model=CRMPersonResponse)
async def create_crm(data: CRMPersonCreate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    person = CRMPerson(**data.dict(), user_id=user.id)
    session.add(person); session.commit(); session.refresh(person)
    return person

@router.get("/crm/{person_id}", response_model=CRMPersonResponse)
async def get_crm(person_id: str, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person or person.user_id != user.id:
        raise HTTPException(status_code=404)
    return person

@router.patch("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm_patch(person_id: str, data: CRMPersonUpdate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person or person.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(person, key, value)
    session.commit(); session.refresh(person)
    return person

@router.put("/crm/{person_id}", response_model=CRMPersonResponse)
async def update_crm_put(person_id: str, data: CRMPersonUpdate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person or person.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(person, key, value)
    session.commit(); session.refresh(person)
    return person

@router.delete("/crm/{person_id}")
async def delete_crm(person_id: str, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person or person.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(person); session.commit()
    return {"ok": True}

@router.post("/crm/{person_id}/contacted", response_model=CRMPersonResponse)
async def mark_contacted(person_id: str, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    person = session.execute(select(CRMPerson).where(CRMPerson.id == person_id)).scalar()
    if not person or person.user_id != user.id:
        raise HTTPException(status_code=404)
    person.last_contacted = datetime.now()
    session.commit(); session.refresh(person)
    return person

# ─── Braindump ─────────────────────────────────────────
@router.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    return session.execute(select(BraindumpEntry).where(BraindumpEntry.user_id == user.id).order_by(BraindumpEntry.created_at.desc())).scalars().all()

@router.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(data: BraindumpEntryCreate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    entry = BraindumpEntry(**data.dict(), user_id=user.id)
    session.add(entry); session.commit(); session.refresh(entry)
    return entry

@router.post("/braindump/{entry_id}/process")
async def process_braindump(entry_id: str, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    entry = session.execute(select(BraindumpEntry).where(BraindumpEntry.id == entry_id)).scalar()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404)
    entry.processed = True
    session.commit(); session.refresh(entry)
    return entry

# ─── Sports — Favorites ────────────────────────────────────
from models import FavoriteSportsTeam
from schemas import FavoriteSportsTeamCreate, FavoriteSportsTeamResponse

@router.get("/sports/favorites/", response_model=List[FavoriteSportsTeamResponse])
async def list_sports_favorites(session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    return session.execute(select(FavoriteSportsTeam).where(FavoriteSportsTeam.user_id == user.id)).scalars().all()

@router.post("/sports/favorites/", response_model=FavoriteSportsTeamResponse)
async def add_sports_favorite(data: FavoriteSportsTeamCreate, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    team = FavoriteSportsTeam(**data.dict(), user_id=user.id)
    session.add(team); session.commit(); session.refresh(team)
    return team

@router.delete("/sports/favorites/{team_id}")
async def remove_sports_favorite(team_id: str, session: Session = Depends(db.get_session), user: User = Depends(get_current_user)):
    team = session.execute(select(FavoriteSportsTeam).where(FavoriteSportsTeam.id == team_id)).scalar()
    if not team or team.user_id != user.id:
        raise HTTPException(status_code=404)
    session.delete(team); session.commit()
    return {"ok": True}

# ─── Sports — MLB Live Data (MLB Stats API, no key required) ──────────────────
import httpx
from zoneinfo import ZoneInfo
_CT = ZoneInfo("America/Chicago")

_MLB_TEAM_IDS = {
    "cardinals": 138, "cubs": 112, "brewers": 158, "reds": 113, "pirates": 134,
    "braves": 144, "mets": 121, "phillies": 143, "marlins": 146, "nationals": 120,
    "dodgers": 119, "giants": 137, "padres": 135, "rockies": 115, "diamondbacks": 109,
    "yankees": 147, "redsox": 111, "bluejays": 141, "orioles": 110, "rays": 139,
    "astros": 117, "athletics": 133, "mariners": 136, "angels": 108, "rangers": 140,
    "twins": 142, "whitesox": 145, "guardians": 114, "tigers": 116, "royals": 118,
}

_TEAM_META = {
    138: ("STL", "St. Louis"),   112: ("CHC", "Chicago"),     158: ("MIL", "Milwaukee"),
    113: ("CIN", "Cincinnati"),  134: ("PIT", "Pittsburgh"),  144: ("ATL", "Atlanta"),
    121: ("NYM", "New York"),    143: ("PHI", "Philadelphia"), 146: ("MIA", "Miami"),
    120: ("WSH", "Washington"),  119: ("LAD", "Los Angeles"),  137: ("SF", "San Francisco"),
    135: ("SD", "San Diego"),    115: ("COL", "Denver"),       109: ("ARI", "Phoenix"),
    147: ("NYY", "New York"),    111: ("BOS", "Boston"),       141: ("TOR", "Toronto"),
    110: ("BAL", "Baltimore"),   139: ("TB", "Tampa Bay"),     117: ("HOU", "Houston"),
    133: ("OAK", "Oakland"),     136: ("SEA", "Seattle"),      108: ("LAA", "Anaheim"),
    140: ("TEX", "Arlington"),   145: ("CHW", "Chicago"),      114: ("CLE", "Cleveland"),
    116: ("DET", "Detroit"),     118: ("KC", "Kansas City"),   142: ("MIN", "Minneapolis"),
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
    is_home  = home.get("team", {}).get("id") == team_id
    stl_side = home if is_home else away
    opp_side = away if is_home else home
    opp_id   = opp_side.get("team", {}).get("id", 0)
    opp_abbr, opp_city = _TEAM_META.get(opp_id, ("???", ""))
    abstract = g.get("status", {}).get("abstractGameState", "")
    status = "Final" if abstract == "Final" else "Live" if abstract == "Live" else g.get("status", {}).get("detailedState", "")
    game_time_ct = ""
    game_date_utc = g.get("gameDate", "")
    if game_date_utc:
        try:
            utc_dt = datetime.fromisoformat(game_date_utc.replace("Z", "+00:00"))
            game_time_ct = utc_dt.astimezone(_CT).strftime("%-I:%M %p CT")
        except Exception:
            game_time_ct = game_date_utc
    linescore = g.get("linescore", {})
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
        "date_label":  g.get("officialDate", game_date_utc[:10] if game_date_utc else ""),
    }

@router.get("/sports/mlb/{team_slug}")
async def mlb_team_today(team_slug: str, user: User = Depends(get_current_user)):
    team_id = _MLB_TEAM_IDS.get(team_slug.lower())
    if not team_id:
        raise HTTPException(status_code=404, detail=f"Unknown team: {team_slug}")
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
                (today_games if date_entry.get("date") == today_str else future_games).append(shaped)
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
                    tid = tr.get("team", {}).get("id", 0)
                    abbr, _ = _TEAM_META.get(tid, ("???", ""))
                    splits = tr.get("records", {}).get("splitRecords", [])
                    last10 = next(
                        (f"{s['wins']}-{s['losses']}" for s in splits if s.get("type") == "lastTen"), ""
                    )
                    nl_central.append({
                        "team_id":  tid,
                        "abbr":     abbr,
                        "teamName": tr.get("team", {}).get("name", ""),
                        "wl":       f"{tr.get('wins', 0)}-{tr.get('losses', 0)}",
                        "pct":      tr.get("winningPercentage", ".000"),
                        "gb":       str(tr.get("gamesBack", "\u2014")),
                        "strk":     tr.get("streak", {}).get("streakCode", ""),
                        "l10":      last10,
                        "cards":    tid == 138,
                    })
                break
        return {
            "team_id":      team_id,
            "date":         today_str,
            "current_game": current_game,
            "next_game":    next_game,
            "nl_central":   nl_central,
        }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MLB API error: {e}")

@router.get("/sports/mlb/{team_slug}/projections")
async def mlb_projections(team_slug: str, user: User = Depends(get_current_user)):
    """Playoff odds from FanGraphs — no API key required."""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            r = await client.get(
                "https://www.fangraphs.com/api/playoff-odds/odds"
                "?dateEnd=yesterday&dateDelta=0&odds=div,wc,league,world",
                headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
            )
            r.raise_for_status()
            rows = r.json()
            if not isinstance(rows, list):
                rows = []
        row = next((x for x in rows if "Cardinals" in str(x.get("Team", ""))), None)
        if row:
            def pct(v):
                try:
                    f = float(v)
                    return round(f * 100, 1) if f <= 1.0 else round(f, 1)
                except Exception:
                    return None
            wins   = row.get("W") or row.get("Wins")
            losses = row.get("L") or row.get("Losses")
            return {
                "proj_wins":   round(float(wins))   if wins   else None,
                "playoff_pct": pct(row.get("Playoffs")    or row.get("PlayoffOdds")),
                "div_pct":     pct(row.get("Division")),
                "wc_pct":      pct(row.get("WildCard")     or row.get("WC")),
                "ws_pct":      pct(row.get("WorldSeries")  or row.get("WS")),
                "best":        f"{int(float(wins))}-{int(float(losses))}" if wins and losses else None,
                "record":      None,
            }
    except Exception:
        pass
    return {"proj_wins": None, "playoff_pct": None, "div_pct": None,
            "wc_pct": None, "ws_pct": None, "best": None, "record": None}

# ─── Mount router at BOTH "" (root) AND "/api" ─────────────
app.include_router(router)
app.include_router(router, prefix="/api")

# ─── Startup ──────────────────────────────────────────
@app.on_event("startup")
async def startup():
    db.init_db()
    migrations = [
        "ALTER TABLE habits RENAME COLUMN title TO name",
        "ALTER TABLE habits ADD COLUMN IF NOT EXISTS icon VARCHAR(100)",
        "ALTER TABLE habits ADD COLUMN IF NOT EXISTS custom_days VARCHAR(100)",
        "ALTER TABLE habits ADD COLUMN IF NOT EXISTS target_minutes INTEGER",
        "ALTER TABLE habits ADD COLUMN IF NOT EXISTS time_hour INTEGER",
        "ALTER TABLE habits ADD COLUMN IF NOT EXISTS time_minute INTEGER DEFAULT 0",
    ]
    with db.engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass
    print("\u2713 Database initialized and migrated")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
