from sqlalchemy import Column, String, Integer, Float, Text, DateTime, Date, Boolean, ForeignKey, Enum, DECIMAL
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from werkzeug.security import generate_password_hash, check_password_hash

Base = declarative_base()

def gen_id():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=gen_id)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")
    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")
    habits = relationship("Habit", back_populates="user", cascade="all, delete-orphan")
    time_entries = relationship("TimeEntry", back_populates="user", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="user", cascade="all, delete-orphan")
    tags = relationship("Tag", back_populates="user", cascade="all, delete-orphan")
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")
    crm = relationship("CRMPerson", back_populates="user", cascade="all, delete-orphan")
    time_blocks = relationship("TimeBlock", back_populates="user", cascade="all, delete-orphan")
    braindump = relationship("BraindumpEntry", back_populates="user", cascade="all, delete-orphan")

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

class Task(Base):
    __tablename__ = "tasks"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=True)
    parent_id = Column(String(36), ForeignKey("tasks.id"), nullable=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(50), default="inbox", index=True)
    priority = Column(String(50), default="medium")

    importance = Column(Integer, default=3)
    difficulty = Column(Integer, default=3)
    focus_score = Column(Integer, default=0)

    due_date = Column(Date, nullable=True, index=True)
    time_estimate_minutes = Column(Integer, nullable=True)
    show_in_daily = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
        actual_time_minutes = Column(Integer, default=0)
    category_id = Column(String(36), ForeignKey("categories.id"), nullable=True)
    tag_ids = Column(String(1000), default="")

    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="tasks")
    project = relationship("Project", back_populates="tasks")
    subtasks = relationship("Task", remote_side=[id], cascade="all, delete-orphan", single_parent=True, lazy="noload")
    category = relationship("Category")

    @property
    def priority_order(self):
        order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        return order.get(self.priority, 99)

class Project(Base):
    __tablename__ = "projects"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="active")
    color = Column(String(50), nullable=True)
    priority = Column(String(50), default="medium")
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="projects")
    tasks = relationship("Task", back_populates="project")

class Habit(Base):
    __tablename__ = "habits"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    # DB column is 'title' for backwards compat; accessed via .name property
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(50), nullable=True)
    frequency = Column(String(50), default="daily")  # daily, weekdays, weekends, weekly, custom
    icon = Column(String(100), nullable=True)
    custom_days = Column(Text, nullable=True)  # JSON: "[1,2,3,4,5]"
    target_minutes = Column(Integer, nullable=True)
    time_hour = Column(Integer, nullable=True)   # 0-23
    time_minute = Column(Integer, nullable=True)  # 0-59
    sort_sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="habits")
    completions = relationship("HabitCompletion", cascade="all, delete-orphan", lazy="subquery")

    @property
    def name(self):
        return self.title

    @name.setter
    def name(self, value):
        self.title = value

class HabitCompletion(Base):
    __tablename__ = "habit_completions"
    id = Column(String(36), primary_key=True, default=gen_id)
    habit_id = Column(String(36), ForeignKey("habits.id"), nullable=False)
    completed_date = Column(Date, nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class TimeEntry(Base):
    __tablename__ = "time_entries"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    task_id = Column(String(36), ForeignKey("tasks.id"), nullable=True)
    habit_id = Column(String(36), ForeignKey("habits.id"), nullable=True)
    started_at = Column(DateTime, nullable=False, index=True)
    ended_at = Column(DateTime, nullable=True, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="time_entries")

    @property
    def duration_seconds(self):
        end = self.ended_at or datetime.utcnow()
        return int((end - self.started_at).total_seconds())

class TimeBlock(Base):
    __tablename__ = "time_blocks"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    color = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="time_blocks")

class Note(Base):
    __tablename__ = "notes"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String(255), nullable=True)
    content = Column(Text, nullable=False)
    tags = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="notes")

class Tag(Base):
    __tablename__ = "tags"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="tags")

class Category(Base):
    __tablename__ = "categories"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(50), nullable=True)
    icon = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="categories")

class CRMPerson(Base):
    __tablename__ = "crm_people"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    company = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    last_contacted = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="crm")

class BraindumpEntry(Base):
    __tablename__ = "braindump_entries"
    id = Column(String(36), primary_key=True, default=gen_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    raw_text = Column(Text, nullable=False)
    processed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="braindump")
