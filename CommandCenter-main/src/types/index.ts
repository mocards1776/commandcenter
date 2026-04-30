// ─── Enums ───────────────────────────────────────────────────
export type TaskStatus = "inbox" | "today" | "in_progress" | "done" | "cancelled" | "waiting";
export type Priority = "low" | "medium" | "high" | "critical";
export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";
export type HabitFrequency = "daily" | "weekdays" | "weekends" | "weekly" | "custom";

// ─── Tag / Category ──────────────────────────────────────────
export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
  created_at: string;
}

// ─── Task ────────────────────────────────────────────────────
export interface Subtask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  importance: number;
  difficulty: number;
  focus_score: number;
  time_estimate_minutes?: number;
  actual_time_minutes: number;
  due_date?: string;
  scheduled_date?: string;
  completed_at?: string;
  sort_order: number;
  show_in_daily: boolean;
  tag_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  status: TaskStatus;
  priority: Priority;
  importance: number;
  difficulty: number;
  focus_score: number;
  time_estimate_minutes?: number;
  actual_time_minutes: number;
  time_variance_minutes?: number;
  due_date?: string;
  scheduled_date?: string;
  completed_at?: string;
  show_in_daily: boolean;
  tag_ids: string[];
  project_id?: string;
  category_id?: string;
  parent_id?: string;
  sort_order: number;
  gcal_event_id?: string;
  subtasks: Subtask[];
  created_at: string;
  updated_at: string;
}

export type TaskCreate = Omit<Task, "id" | "focus_score" | "actual_time_minutes" | "time_variance_minutes" | "completed_at" | "created_at" | "updated_at" | "subtasks">;
export type TaskUpdate = Partial<TaskCreate & { actual_time_minutes: number; completed_at: string }>;

// ─── Project ─────────────────────────────────────────────────
export interface Project {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  status: ProjectStatus;
  priority: Priority;
  importance: number;
  difficulty: number;
  focus_score: number;
  time_estimate_minutes?: number;
  actual_time_minutes: number;
  due_date?: string;
  start_date?: string;
  completed_at?: string;
  category_id?: string;
  tag_ids: string[];
  show_in_daily: boolean;
  completion_percentage: number;
  tasks: Task[];
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary extends Omit<Project, "tasks"> {
  task_count: number;
}

// ─── Habit ───────────────────────────────────────────────────
export interface HabitCompletion {
  id: string;
  habit_id: string;
  completed_date: string;
  note?: string;
  duration_minutes?: number;
  created_at: string;
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  frequency: HabitFrequency;
  custom_days?: number[];
  target_minutes?: number;
  time_hour?: number;
  time_minute?: number;
  color: string;
  icon?: string;
  sort_order: number;
  is_active: boolean;
  completions: HabitCompletion[];
  created_at: string;
  updated_at: string;
}

// ─── Time Entry ───────────────────────────────────────────────
export interface TimeEntry {
  id: string;
  task_id?: string;
  habit_id?: string;
  started_at: string;
  ended_at?: string;
  duration_seconds: number;
  is_active: boolean;
  note?: string;
  created_at: string;
}

// ─── Note ─────────────────────────────────────────────────────
export interface Note {
  id: string;
  title?: string;
  content: string;
  task_id?: string;
  project_id?: string;
  habit_id?: string;
  crm_person_id?: string;
  tag_ids: string[];
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

// ─── CRM ──────────────────────────────────────────────────────
export interface CRMPerson {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  relationship_type?: string;
  last_contact_date?: string;
  contact_frequency_days?: number;
  notes_text?: string;
  birthday?: string;
  avatar_url?: string;
  tag_ids: string[];
  days_since_contact?: number;
  overdue_contact: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Time Block ───────────────────────────────────────────────
export interface TimeBlock {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  color: string;
  is_recurring: boolean;
  recurrence_rule?: string;
  task_id?: string;
  project_id?: string;
  gcal_event_id?: string;
  gcal_calendar_id?: string;
  created_at: string;
  updated_at: string;
}

// ─── Braindump ────────────────────────────────────────────────
export interface BraindumpEntry {
  id: string;
  raw_text: string;
  processed: boolean;
  ai_result?: {
    summary: string;
    projects: any[];
    standalone_tasks: any[];
    notes: string;
  };
  created_task_ids: string[];
  created_project_ids: string[];
  created_at: string;
  processed_at?: string;
}

// ─── Gamification ─────────────────────────────────────────────
export interface GamificationStats {
  stat_date: string;
  tasks_completed: number;
  tasks_attempted: number;
  habits_completed: number;
  total_focus_minutes: number;
  home_runs: number;
  hits: number;
  strikeouts: number;
  batting_average: number;
  hitting_streak: number;
}

// ─── Dashboard ────────────────────────────────────────────────
export interface DashboardSummary {
  today_tasks: Task[];
  overdue_tasks: Task[];
  active_projects: ProjectSummary[];
  today_habits: Habit[];
  active_timer?: TimeEntry;
  gamification?: GamificationStats;
  total_tasks_today: number;
  completed_tasks_today: number;
  habit_completion_rate: number;
  tasks_today?: number;
  completed_today?: number;
  focus_score_today?: number;
  time_tracked_seconds?: number;
  streak_days?: number;
}

// ─── Sports ───────────────────────────────────────────────────
export interface FavoriteSportsTeam {
  id: string;
  team_name: string;
  team_id?: string;
  sport: string;
  league?: string;
  abbreviation?: string;
  sort_order: number;
  created_at: string;
}
