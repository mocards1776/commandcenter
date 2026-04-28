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

# ─── Auth ────────────────────────────────────────────────────────────
from sqlalchemy import select
from models import User

@app.post("/api/auth/register", response_model=UserResponse)
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

@app.post("/api/auth/login")
async def login(data: UserLogin, session: Session = Depends(db.get_session)):
    user = session.execute(select(User).where(User.email == data.email)).scalar()
    if not user or not user.check_password(data.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}

# ─── Tasks ────────────────────────────────────────────────────────────
@app.get("/api/tasks/", response_model=List[TaskResponse])
async def list_tasks(
    status: Optional[str] = None,
    search: Optional[str] = None,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    query = select(Task).where(Task.user_id == user.id)
    if status:
        query = query.where(Task.status == status)
    if search:
        query = query.where(Task.title.ilike(f"%{search}%"))
    tasks = session.execute(query.order_by(Task.created_at.desc())).scalars().all()
    return tasks

@app.get("/api/tasks/today", response_model=List[TaskResponse])
async def today_tasks(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    today = datetime.utcnow().date()
    query = select(Task).where(
        (Task.user_id == user.id) &
        (Task.status.in_(["today", "in_progress"])) |
        ((Task.due_date == today) & (Task.status != "done"))
    )
    return session.execute(query.order_by(Task.priority_order)).scalars().all()

@app.post("/api/tasks/", response_model=TaskResponse)
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

@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    return task

@app.patch("/api/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    for key, value in data.dict(exclude_unset=True).items():
        setattr(task, key, value)
    session.commit()
    session.refresh(task)
    return task

@app.delete("/api/tasks/{task_id}")
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

@app.post("/api/tasks/{task_id}/complete", response_model=TaskResponse)
async def complete_task(
    task_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    task = session.execute(select(Task).where(Task.id == task_id)).scalar()
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404)
    task.status = "done"
    task.completed_at = datetime.utcnow()
    session.commit()
    session.refresh(task)
    return task

@app.post("/api/tasks/reorder")
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

# ─── Projects ────────────────────────────────────────────────────────
@app.get("/api/projects/", response_model=List[ProjectResponse])
async def list_projects(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    projects = session.execute(
        select(Project).where(Project.user_id == user.id).order_by(Project.created_at.desc())
    ).scalars().all()
    return projects

@app.post("/api/projects/", response_model=ProjectResponse)
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

@app.get("/api/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    project = session.execute(select(Project).where(Project.id == project_id)).scalar()
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404)
    return project

@app.patch("/api/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
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

@app.delete("/api/projects/{project_id}")
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

# ─── Time Blocks ─────────────────────────────────────────────────────
@app.get("/api/time-blocks/", response_model=List[TimeBlockResponse])
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

@app.post("/api/time-blocks/", response_model=TimeBlockResponse)
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

@app.delete("/api/time-blocks/{block_id}")
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

# ─── Habits ──────────────────────────────────────────────────────────
@app.get("/api/habits/", response_model=List[HabitResponse])
async def list_habits(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habits = session.execute(
        select(Habit).where(Habit.user_id == user.id).order_by(Habit.created_at.desc())
    ).scalars().all()
    return habits

@app.post("/api/habits/", response_model=HabitResponse)
async def create_habit(
    data: HabitCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = Habit(**data.dict(), user_id=user.id)
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

@app.post("/api/habits/{habit_id}/complete")
async def complete_habit(
    habit_id: str,
    data: dict,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    habit = session.execute(select(Habit).where(Habit.id == habit_id)).scalar()
    if not habit or habit.user_id != user.id:
        raise HTTPException(status_code=404)
    completion = HabitCompletion(
        habit_id=habit_id,
        completed_date=datetime.fromisoformat(data["completed_date"]).date(),
        note=data.get("note"),
    )
    session.add(completion)
    session.commit()
    return {"ok": True}

@app.get("/api/habits/{habit_id}/streak")
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
    today = datetime.utcnow().date()
    for i, comp in enumerate(completions):
        expected_date = today - timedelta(days=i)
        if comp.completed_date == expected_date:
            streak += 1
        else:
            break
    
    return {"habit_id": habit_id, "streak": streak}

# ─── Time Entries ────────────────────────────────────────────────────
@app.get("/api/time-entries/active", response_model=Optional[TimeEntryResponse])
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

@app.post("/api/time-entries/start", response_model=TimeEntryResponse)
async def start_timer(
    data: TimeEntryCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    # Stop any active timer
    session.execute(
        db.update(TimeEntry)
        .where((TimeEntry.user_id == user.id) & (TimeEntry.ended_at.is_(None)))
        .values(ended_at=datetime.utcnow())
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

@app.post("/api/time-entries/{entry_id}/stop", response_model=TimeEntryResponse)
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

# ─── Dashboard ───────────────────────────────────────────────────────
@app.get("/api/dashboard/", response_model=DashboardSummary)
async def get_dashboard(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    today = datetime.utcnow().date()
    
    # Today's tasks
    today_tasks = session.execute(
        select(Task).where(
            (Task.user_id == user.id) &
            (Task.status.in_(["today", "in_progress"]))
        )
    ).scalars().all()
    
    # Completed today
    completed_today = session.execute(
        select(Task).where(
            (Task.user_id == user.id) &
            (Task.status == "done") &
            (Task.completed_at >= datetime(today.year, today.month, today.day))
        )
    ).scalars().all()
    
    # Time tracked today
    time_entries = session.execute(
        select(TimeEntry).where(
            (TimeEntry.user_id == user.id) &
            (TimeEntry.started_at >= datetime(today.year, today.month, today.day))
        )
    ).scalars().all()
    
    total_seconds = 0
    for entry in time_entries:
        end = entry.ended_at or datetime.utcnow()
        total_seconds += int((end - entry.started_at).total_seconds())
    
    focus_score_today = sum(t.focus_score for t in completed_today if t.focus_score)
    
    return DashboardSummary(
        tasks_today=len(today_tasks),
        completed_today=len(completed_today),
        focus_score_today=focus_score_today,
        time_tracked_seconds=total_seconds,
        streak_days=0,  # compute from habits
    )

# ─── Tags & Categories ──────────────────────────────────────────────
@app.get("/api/tags/", response_model=List[TagResponse])
async def list_tags(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    tags = session.execute(
        select(Tag).where(Tag.user_id == user.id)
    ).scalars().all()
    return tags

@app.post("/api/tags/", response_model=TagResponse)
async def create_tag(
    data: TagCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    tag = Tag(**data.dict(), user_id=user.id)
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@app.get("/api/categories/", response_model=List[CategoryResponse])
async def list_categories(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    categories = session.execute(
        select(Category).where(Category.user_id == user.id)
    ).scalars().all()
    return categories

@app.post("/api/categories/", response_model=CategoryResponse)
async def create_category(
    data: CategoryCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    category = Category(**data.dict(), user_id=user.id)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category

# ─── Notes ──────────────────────────────────────────────────────────
@app.get("/api/notes/", response_model=List[NoteResponse])
async def list_notes(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    notes = session.execute(
        select(Note).where(Note.user_id == user.id).order_by(Note.created_at.desc())
    ).scalars().all()
    return notes

@app.post("/api/notes/", response_model=NoteResponse)
async def create_note(
    data: NoteCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    note = Note(**data.dict(), user_id=user.id)
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

# ─── CRM ────────────────────────────────────────────────────────────
@app.get("/api/crm/", response_model=List[CRMPersonResponse])
async def list_crm(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    people = session.execute(
        select(CRMPerson).where(CRMPerson.user_id == user.id).order_by(CRMPerson.created_at.desc())
    ).scalars().all()
    return people

@app.post("/api/crm/", response_model=CRMPersonResponse)
async def create_crm(
    data: CRMPersonCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    person = CRMPerson(**data.dict(), user_id=user.id)
    session.add(person)
    session.commit()
    session.refresh(person)
    return person

# ─── Braindump ──────────────────────────────────────────────────────
@app.get("/api/braindump/", response_model=List[BraindumpEntryResponse])
async def list_braindump(
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    entries = session.execute(
        select(BraindumpEntry).where(BraindumpEntry.user_id == user.id).order_by(BraindumpEntry.created_at.desc())
    ).scalars().all()
    return entries

@app.post("/api/braindump/", response_model=BraindumpEntryResponse)
async def create_braindump(
    data: BraindumpEntryCreate,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    entry = BraindumpEntry(**data.dict(), user_id=user.id)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@app.post("/api/braindump/{entry_id}/process")
async def process_braindump(
    entry_id: str,
    session: Session = Depends(db.get_session),
    user: User = Depends(get_current_user),
):
    entry = session.execute(select(BraindumpEntry).where(BraindumpEntry.id == entry_id)).scalar()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404)
    entry.processed = True
    session.commit()
    session.refresh(entry)
    return entry

# Startup
@app.on_event("startup")
async def startup():
    db.init_db()
    print("✓ Database initialized")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
