from pydantic import BaseModel, Field, validator
from datetime import datetime, date
from typing import Optional, List, Any
import json

# ─── Auth ──────────────────────────────────────────────────────────────
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

# ─── Tasks ─────────────────────────────────────────────────────────────
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
    description: Optional[str] = None
    notes: Optional[str] = None
    status: str
    priority: str
    importance: int
    difficulty: int
    focus_score: int = 0
    due_date: Optional[date] = None
    time_estimate_minutes: Optional[int] = None
    project_id: Optional[str] = None
    parent_id: Optional[str] = None
    category_id: Optional[str] = None
    tag_ids: List[str] = []
    show_in_daily: bool = True
    actual_time_minutes: int = 0
    sort_order: int = 0
    subtasks: List[Any] = []
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    @validator("tag_ids", pre=True, always=True)
    def parse_tag_ids(cls, v):
        if v is None:
            return []
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                try:
                    return json.loads(s)
                except Exception:
                    pass
            return [i.strip() for i in s.split(",") if i.strip()]
        return []

    @validator("subtasks", pre=True, always=True)
    def parse_subtasks(cls, v):
        if v is None:
            return []
        return v

    class Config:
        from_attributes = True

# ─── Projects ──────────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "active"
    color: Optional[str] = None
    priority: Optional[str] = "medium"
    due_date: Optional[str] = None

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: str
    color: Optional[str] = None
    priority: Optional[str] = "medium"
    due_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    tasks: List[TaskResponse] = []

    class Config:
        from_attributes = True

# ─── Habits ────────────────────────────────────────────────────────────
class HabitCompletionResponse(BaseModel):
    id: str
    habit_id: str
    completed_date: date
    note: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class HabitCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#e8a820"
    frequency: str = "daily"
    icon: Optional[str] = "\U0001f525"
    custom_days: Optional[List[int]] = None
    target_minutes: Optional[int] = None
    time_hour: Optional[int] = None
    time_minute: Optional[int] = None
    sort_order: int = 0
    is_active: bool = True

class HabitUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    frequency: Optional[str] = None
    icon: Optional[str] = None
    custom_days: Optional[List[int]] = None
    target_minutes: Optional[int] = None
    time_hour: Optional[int] = None
    time_minute: Optional[int] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

class HabitResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    frequency: str
    icon: Optional[str] = None
    custom_days: Optional[List[int]] = None
    target_minutes: Optional[int] = None
    time_hour: Optional[int] = None
    time_minute: Optional[int] = None
    sort_order: int = 0
    is_active: bool = True
    completions: List[HabitCompletionResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @validator("custom_days", pre=True, always=True)
    def parse_custom_days(cls, v):
        if v is None:
            return None
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                return None
        return None

    class Config:
        from_attributes = True

# ─── Time Entries ──────────────────────────────────────────────────────
class TimeEntryCreate(BaseModel):
    task_id: Optional[str] = None
    habit_id: Optional[str] = None
    started_at: datetime
    note: Optional[str] = None

class TimeEntryResponse(BaseModel):
    id: str
    task_id: Optional[str] = None
    habit_id: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    note: Optional[str] = None

    class Config:
        from_attributes = True

# ─── Time Blocks ───────────────────────────────────────────────────────
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
    color: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# ─── Notes ─────────────────────────────────────────────────────────────
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
    title: Optional[str] = None
    content: str
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# ─── Tags ──────────────────────────────────────────────────────────────
class TagCreate(BaseModel):
    name: str
    color: Optional[str] = None

class TagResponse(BaseModel):
    id: str
    name: str
    color: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# ─── Categories ────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str
    color: Optional[str] = None
    icon: Optional[str] = None

class CategoryResponse(BaseModel):
    id: str
    name: str
    color: Optional[str] = None
    icon: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# ─── CRM ───────────────────────────────────────────────────────────────
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
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    notes: Optional[str] = None
    last_contacted: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

# ─── Braindump ─────────────────────────────────────────────────────────
class BraindumpEntryCreate(BaseModel):
    raw_text: str

class BraindumpEntryResponse(BaseModel):
    id: str
    raw_text: str
    processed: bool
    created_at: datetime

    class Config:
        from_attributes = True

# ─── Dashboard ─────────────────────────────────────────────────────────
class DashboardSummary(BaseModel):
    tasks_today: int
    completed_today: int
    focus_score_today: int
    time_tracked_seconds: int
    streak_days: int
    today_tasks: List[Any] = []
    overdue_tasks: List[Any] = []
    today_habits: List[Any] = []
    active_projects: List[Any] = []
    total_tasks_today: int = 0
    completed_tasks_today: int = 0
    habit_completion_rate: float = 0.0
    gamification: Optional[Any] = None
