from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional, List

# ─── Auth ────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    created_at: datetime
    
    class Config:
        from_attributes = True

# ─── Tasks ───────────────────────────────────────────────────────────
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    notes: Optional[str] = None
    status: str = "inbox"
    priority: str = "medium"
    importance: int = 3
    difficulty: int = 3
    due_date: Optional[date] = None
    time_estimate_minutes: Optional[int] = None
    project_id: Optional[str] = None
    parent_id: Optional[str] = None
    category_id: Optional[str] = None
    tag_ids: List[str] = []
    show_in_daily: bool = True

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    importance: Optional[int] = None
    difficulty: Optional[int] = None
    due_date: Optional[date] = None
    time_estimate_minutes: Optional[int] = None
    project_id: Optional[str] = None
    category_id: Optional[str] = None
    tag_ids: Optional[List[str]] = None
    
    class Config:
        from_attributes = True

class TaskResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    notes: Optional[str]
    status: str
    priority: str
    importance: int
    difficulty: int
    focus_score: int
    due_date: Optional[date]
    time_estimate_minutes: Optional[int]
    project_id: Optional[str]
    parent_id: Optional[str]
    category_id: Optional[str]
    tag_ids: str
    show_in_daily: bool
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]
    
    class Config:
        from_attributes = True

# ─── Projects ────────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "active"
    color: Optional[str] = None

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    status: str
    color: Optional[str]
    created_at: datetime
    updated_at: datetime
    tasks: List[TaskResponse] = []
    
    class Config:
        from_attributes = True

# ─── Habits ──────────────────────────────────────────────────────────
class HabitCreate(BaseModel):
    title: str
    description: Optional[str] = None
    color: Optional[str] = None
    frequency: str = "daily"

class HabitUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    frequency: Optional[str] = None

class HabitResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    color: Optional[str]
    frequency: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# ─── Time Entries ────────────────────────────────────────────────────
class TimeEntryCreate(BaseModel):
    task_id: Optional[str] = None
    habit_id: Optional[str] = None
    started_at: datetime
    note: Optional[str] = None

class TimeEntryResponse(BaseModel):
    id: str
    task_id: Optional[str]
    habit_id: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]
    note: Optional[str]
    
    class Config:
        from_attributes = True

# ─── Time Blocks ─────────────────────────────────────────────────────
class TimeBlockCreate(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    color: Optional[str] = None

class TimeBlockUpdate(BaseModel):
    title: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    color: Optional[str] = None

class TimeBlockResponse(BaseModel):
    id: str
    title: str
    start_time: datetime
    end_time: datetime
    color: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

# ─── Notes ───────────────────────────────────────────────────────────
class NoteCreate(BaseModel):
    title: Optional[str] = None
    content: str
    tags: Optional[str] = None

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[str] = None

class NoteResponse(BaseModel):
    id: str
    title: Optional[str]
    content: str
    tags: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# ─── Tags ────────────────────────────────────────────────────────────
class TagCreate(BaseModel):
    name: str
    color: Optional[str] = None

class TagResponse(BaseModel):
    id: str
    name: str
    color: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

# ─── Categories ──────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str
    color: Optional[str] = None
    icon: Optional[str] = None

class CategoryResponse(BaseModel):
    id: str
    name: str
    color: Optional[str]
    icon: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

# ─── CRM ─────────────────────────────────────────────────────────────
class CRMPersonCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    notes: Optional[str] = None

class CRMPersonUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    notes: Optional[str] = None

class CRMPersonResponse(BaseModel):
    id: str
    name: str
    email: Optional[str]
    phone: Optional[str]
    company: Optional[str]
    notes: Optional[str]
    last_contacted: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True

# ─── Braindump ───────────────────────────────────────────────────────
class BraindumpEntryCreate(BaseModel):
    raw_text: str

class BraindumpEntryResponse(BaseModel):
    id: str
    raw_text: str
    processed: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

# ─── Dashboard ───────────────────────────────────────────────────────
class DashboardSummary(BaseModel):
    tasks_today: int
    completed_today: int
    focus_score_today: int
    time_tracked_seconds: int
    streak_days: int
