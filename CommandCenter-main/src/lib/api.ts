import axios from "axios";
import type {
  Task, TaskCreate, TaskUpdate,
  Project, ProjectSummary,
  Habit, HabitCompletion,
  TimeEntry, Note, CRMPerson,
  TimeBlock, BraindumpEntry,
  DashboardSummary, Tag, Category,
  FavoriteSportsTeam,
} from "@/types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

// Auth interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Dashboard ────────────────────────────────────────────────
export const dashboardApi = {
  get: () => api.get<DashboardSummary>("/dashboard/").then(r => r.data),
};

// ─── Tasks ────────────────────────────────────────────────────
export const tasksApi = {
  list: (params?: Record<string, any>) =>
    api.get<Task[]>("/tasks/", { params }).then(r => r.data),
  today: () => api.get<Task[]>("/tasks/today").then(r => r.data),
  get: (id: string) => api.get<Task>(`/tasks/${id}`).then(r => r.data),
  create: (data: Partial<TaskCreate>) =>
    api.post<Task>("/tasks/", data).then(r => r.data),
  update: (id: string, data: TaskUpdate) =>
    api.patch<Task>(`/tasks/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  complete: (id: string) =>
    api.post<Task>(`/tasks/${id}/complete`).then(r => r.data),
  reorder: (ids: string[]) => api.post("/tasks/reorder", ids),
};

// ─── Projects ────────────────────────────────────────────────
export const projectsApi = {
  list: (params?: Record<string, any>) =>
    api.get<ProjectSummary[]>("/projects/", { params }).then(r => r.data),
  get: (id: string) => api.get<Project>(`/projects/${id}`).then(r => r.data),
  create: (data: any) => api.post<Project>("/projects/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<Project>(`/projects/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/projects/${id}`),
};

// ─── Habits ──────────────────────────────────────────────────
export const habitsApi = {
  list: (params?: Record<string, any>) =>
    api.get<Habit[]>("/habits/", { params }).then(r => r.data),
  get: (id: string) => api.get<Habit>(`/habits/${id}`).then(r => r.data),
  create: (data: any) => api.post<Habit>("/habits/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<Habit>(`/habits/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/habits/${id}`),
  complete: (id: string, data: { completed_date: string; note?: string }) =>
    api.post<HabitCompletion>(`/habits/${id}/complete`, data).then(r => r.data),
  uncomplete: (id: string, date: string) =>
    api.delete(`/habits/${id}/complete/${date}`),
  streak: (id: string) =>
    api.get<{ habit_id: string; streak: number }>(`/habits/${id}/streak`).then(r => r.data),
};

// ─── Time Entries ────────────────────────────────────────────
export const timersApi = {
  active: () =>
    api.get<TimeEntry | null>("/time-entries/active").then(r => r.data),
  start: (data: { task_id?: string; habit_id?: string; started_at: string; note?: string }) =>
    api.post<TimeEntry>("/time-entries/start", data).then(r => r.data),
  stop: (id: string, data: { ended_at: string; note?: string }) =>
    api.post<TimeEntry>(`/time-entries/${id}/stop`, data).then(r => r.data),
  list: (params?: Record<string, any>) =>
    api.get<TimeEntry[]>("/time-entries/", { params }).then(r => r.data),
};

// ─── Braindump ────────────────────────────────────────────────
export const braindumpApi = {
  list: () => api.get<BraindumpEntry[]>("/braindump/").then(r => r.data),
  create: (raw_text: string) =>
    api.post<BraindumpEntry>("/braindump/", { raw_text }).then(r => r.data),
  process: (id: string) =>
    api.post<BraindumpEntry>(`/braindump/${id}/process`).then(r => r.data),
};

// ─── Notes ───────────────────────────────────────────────────
export const notesApi = {
  list: (params?: Record<string, any>) =>
    api.get<Note[]>("/notes/", { params }).then(r => r.data),
  create: (data: any) => api.post<Note>("/notes/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<Note>(`/notes/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/notes/${id}`),
};

// ─── CRM ─────────────────────────────────────────────────────
export const crmApi = {
  list: (params?: Record<string, any>) =>
    api.get<CRMPerson[]>("/crm/", { params }).then(r => r.data),
  get: (id: string) => api.get<CRMPerson>(`/crm/${id}`).then(r => r.data),
  create: (data: any) => api.post<CRMPerson>("/crm/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<CRMPerson>(`/crm/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/crm/${id}`),
  markContacted: (id: string) =>
    api.post<CRMPerson>(`/crm/${id}/contacted`).then(r => r.data),
};

// ─── Tags ─────────────────────────────────────────────────────
export const tagsApi = {
  list: () => api.get<Tag[]>("/tags/").then(r => r.data),
  create: (data: { name: string; color: string }) =>
    api.post<Tag>("/tags/", data).then(r => r.data),
  delete: (id: string) => api.delete(`/tags/${id}`),
};

// ─── Categories ───────────────────────────────────────────────
export const categoriesApi = {
  list: () => api.get<Category[]>("/categories/").then(r => r.data),
  create: (data: { name: string; color: string; icon?: string }) =>
    api.post<Category>("/categories/", data).then(r => r.data),
  delete: (id: string) => api.delete(`/categories/${id}`),
};

// ─── Sports ──────────────────────────────────────────────────
export const sportsApi = {
  favorites: () =>
    api.get<FavoriteSportsTeam[]>("/sports/favorites/").then(r => r.data),
  addFavorite: (data: any) =>
    api.post<FavoriteSportsTeam>("/sports/favorites/", data).then(r => r.data),
  removeFavorite: (id: string) => api.delete(`/sports/favorites/${id}`),
};

export default api;
// Force redeploy - Tue Apr 28 14:30:53 CDT 2026
