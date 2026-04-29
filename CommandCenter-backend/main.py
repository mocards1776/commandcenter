from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
import os
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

# ─── Helpers ─────────────────────────────────────────────────────────
def tags_to_str(tag_ids) -> str:
    """Convert a list of tag IDs to a CSV string for DB storage."""
    if tag_ids is None:
        return ""
    if isinstance(tag_ids, list):
        return ",".join(str(t) for t in tag_ids)
    return str(tag_ids)

def calc_focus_score(importance: int, difficulty: int) -> int:
    # Max score = 5 x 5 = 25 (most important AND hardest task)
    return importance * difficulty

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
    # user: User = Depends(get_current_user),
):
    query = select(Task)
    if status:
        query = query.where(Task.status == status)
    if search:
        query = query.where(Task.title.ilike(f"%{search}%"))
    tasks = session.execute(query.order_by(Task.created_at.desc())).scalars().all()
    return tasks

@app.get("/tasks/today", response_model=List[TaskResponse])
async def today_tasks(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    today = datetime.utcnow().date()
    query = select(Task).where(
        Task.status.in_(["today", "in_progress"]) |
        ((Task.due_date == today) & (Task.status != "done"))
    )
    return session.execute(query.order_by(Task.order)).scalars().all()

@app.post("/tasks/", response_model=TaskResponse)
async def create_task(
    data: TaskCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    d = data.dict()
    # Serialize tag_ids list to CSV string for the DB column
    d["tag_ids"] = tags_to_str(d.get("tag_ids", []))
    # Compute focus_score
    d["focus_score"] = calc_focus_score(d.get("importance", 3), d.get("difficulty", 3))
    task = Task(**d)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task

@app.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    return task

@app.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    updates = data.dict(exclude_unset=True)
    # Serialize tag_ids if present
    if "tag_ids" in updates:
        updates["tag_ids"] = tags_to_str(updates["tag_ids"])
    for key, value in updates.items():
        setattr(task, key, value)
    # Recompute focus_score if importance or difficulty changed
    task.focus_score = calc_focus_score(task.importance, task.difficulty)
    session.commit()
    session.refresh(task)
    return task

@app.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task:
        raise HTTPException(status_code=404)
    session.delete(task)
    session.commit()
    return {"ok": True}

@app.post("/tasks/{task_id}/complete", response_model=TaskResponse)
async def complete_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
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
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    for idx, task_id in enumerate(ids):
        task = session.execute(select(Task).where(Task.id == task_id)).scalar()
        if task:
            task.order = idx
    session.commit()
    return {"ok": True}

# ─── Projects ────────────────────────────────────────────────────────
@app.get("/projects/", response_model=List[ProjectResponse])
async def list_projects(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    projects = session.execute(select(Project)).scalars().all()
    return projects

@app.post("/projects/", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    project = Project(**data.dict())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project

@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    return project

@app.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(project, key, value)
    session.commit()
    session.refresh(project)
    return project

@app.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project:
        raise HTTPException(status_code=404)
    session.delete(project)
    session.commit()
    return {"ok": True}

# ─── Time Blocks ─────────────────────────────────────────────────────
@app.get("/time-blocks/", response_model=List[TimeBlockResponse])
async def list_time_blocks(
    date: Optional[str] = None,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
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
async def create_time_block(
    data: TimeBlockCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    block = TimeBlock(**data.dict())
    session.add(block)
    session.commit()
    session.refresh(block)
    return block

@app.delete("/time-blocks/{block_id}")
async def delete_time_block(
    block_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    block = session.execute(select(TimeBlock).where(TimeBlock.id == block_id)).scalar()
    if not block:
        raise HTTPException(status_code=404)
    session.delete(block)
    session.commit()
    return {"ok": True}

# ─── Habits ──────────────────────────────────────────────────────────
@app.get("/habits/", response_model=List[HabitResponse])
async def list_habits(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    habits = session.execute(select(Habit)).scalars().all()
    return habits

@app.post("/habits/", response_model=HabitResponse)
async def create_habit(
    data: HabitCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    habit = Habit(**data.dict())
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@app.post("/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit:
        raise HTTPException(status_code=404)
    completion = HabitCompletion(
        habit_id=habit_id,
        completed_date=datetime.fromisoformat(data["completed_date"]).date(),
        note=data.get("note"),
    )
    session.add(completion)
    session.commit()
    return {"ok": True}

@app.get("/habits/{habit_id}/streak")
async def get_habit_streak(
    habit_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
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
    today = datetime.utcnow().date()
    for i, comp in enumerate(completions):
        expected_date = today - timedelta(days=i)
        if comp.completed_date == expected_date:
            streak += 1
        else:
            break

    return {"habit_id": habit_id, "streak": streak}

# ─── Time Entries ────────────────────────────────────────────────────
@app.get("/time-entries/active", response_model=Optional[TimeEntryResponse])
async def get_active_timer(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    entry = session.execute(
        select(TimeEntry)
        .order_by(TimeEntry.started_at.desc())
    ).scalar()
    return entry

@app.post("/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(
    data: TimeEntryCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
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
async def stop_timer(
    entry_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    entry = session.execute(select(TimeEntry).where(TimeEntry.id == entry_id)).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.ended_at = datetime.fromisoformat(data["ended_at"])
    session.commit()
    session.refresh(entry)
    return entry

# ─── Dashboard ───────────────────────────────────────────────────────
@app.get("/dashboard/", response_model=DashboardSummary)
async def get_dashboard(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    today = datetime.utcnow().date()

    today_tasks = session.execute(
        select(Task).where(
            Task.status.in_(["today", "in_progress"])
        )
    ).scalars().all()

    completed_today = session.execute(
        select(Task).where(
            (Task.status == "done") &
            (Task.completed_at >= datetime(today.year, today.month, today.day))
        )
    ).scalars().all()

    time_entries = session.execute(
        select(TimeEntry).where(
            TimeEntry.started_at >= datetime(today.year, today.month, today.day)
        )
    ).scalars().all()

    total_seconds = 0
    for entry in time_entries:
        end = entry.ended_at or datetime.utcnow()
        total_seconds += int((end - entry.started_at).total_seconds())

    focus_score_today = sum(t.focus_score for t in completed_today if t.focus_score)

    # Overdue tasks: due_date < today and not done/cancelled
    overdue_tasks = session.execute(
        select(Task).where(
            (Task.due_date != None) &
            (Task.due_date < today) &
            (~Task.status.in_(["done", "cancelled"]))
        )
    ).scalars().all()

    # Active projects with task counts and completion %
    active_projects_rows = session.execute(
        select(Project).where(Project.status == "active")
    ).scalars().all()
    active_projects = []
    for p in active_projects_rows:
        proj_tasks = session.execute(
            select(Task).where(Task.project_id == p.id)
        ).scalars().all()
        total = len(proj_tasks)
        done = sum(1 for t in proj_tasks if t.status == "done")
        active_projects.append({
            "id": p.id,
            "title": p.title,
            "task_count": total,
            "completion_percentage": int((done / total) * 100) if total else 0,
        })

    # Habits with today's completions attached (frontend reads habit.completions and habit.name)
    habits_rows = session.execute(select(Habit)).scalars().all()
    today_habits = []
    for h in habits_rows:
        comps = session.execute(
            select(HabitCompletion).where(HabitCompletion.habit_id == h.id)
        ).scalars().all()
        today_habits.append({
            "id": h.id,
            "name": getattr(h, "title", None) or getattr(h, "name", ""),
            "color": getattr(h, "color", None),
            "completions": [
                {"completed_date": c.completed_date.isoformat() if c.completed_date else None}
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
async def list_tags(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    tags = session.execute(select(Tag)).scalars().all()
    return tags

@app.post("/tags/", response_model=TagResponse)
async def create_tag(
    data: TagCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    tag = Tag(**data.dict())
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@app.get("/categories/", response_model=List[CategoryResponse])
async def list_categories(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    categories = session.execute(select(Category)).scalars().all()
    return categories

@app.post("/categories/", response_model=CategoryResponse)
async def create_category(
    data: CategoryCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    category = Category(**data.dict())
    session.add(category)
    session.commit()
    session.refresh(category)
    return category

# ─── Notes ──────────────────────────────────────────────────────────
@app.get("/notes/", response_model=List[NoteResponse])
async def list_notes(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    notes = session.execute(select(Note)).scalars().all()
    return notes

@app.post("/notes/", response_model=NoteResponse)
async def create_note(
    data: NoteCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    note = Note(**data.dict())
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

# ─── CRM ────────────────────────────────────────────────────────────
@app.get("/crm/", response_model=List[CRMPersonResponse])
async def list_crm(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    people = session.execute(select(CRMPerson)).scalars().all()
    return people

@app.post("/crm/", response_model=CRMPersonResponse)
async def create_crm(
    data: CRMPersonCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    person = CRMPerson(**data.dict())
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

# ─── Braindump ──────────────────────────────────────────────────────
@app.get("/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    entries = session.execute(select(BraindumpEntry)).scalars().all()
    return entries

@app.post("/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    entry = BraindumpEntry(**data.dict())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/braindump/{entry_id}/process")
async def process_braindump(
    entry_id: str,
    session: Session = Depends(db.get_session),
    # user: User = Depends(get_current_user),
):
    entry = session.execute(select(BraindumpEntry).where(BraindumpEntry.id == entry_id)).scalar()
    if not entry:
        raise HTTPException(status_code=404)
    entry.processed = True
    session.commit()
    session.refresh(entry)
    return entry

# Startup
@app.on_event("startup")
async def startup():
    db.init_db()
    print("\u2713 Database initialized")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
