import axios from "axios";
import type {
  Task, TaskCreate, TaskUpdate,
  Project, ProjectSummary,
  Habit, HabitCompletion,
  TimeEntry, Note, CRMPerson,
  TimeBlock, BraindumpEntry,
  DashboardSummary, Tag, Category,
  FavoriteSportsTeam, GamificationStats,
} from "@/types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "https://orca-app-v7oew.ondigitalocean.app",
  headers: { "Content-Type": "application/json" },
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear token and force re-login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("auth_token");
      window.dispatchEvent(new CustomEvent("auth:logout"));
    }
    return Promise.reject(err);
  }
);

// ─── Dashboard ────────────────────────────────────────────
export const dashboardApi = {
  get: () => api.get<DashboardSummary>("/api/dashboard/").then(r => r.data),
};

// ─── Gamification ─────────────────────────────────────────
export const gamificationApi = {
  history: (limit = 30) =>
    api.get<GamificationStats[]>("/api/gamification/", { params: { limit } }).then(r => r.data),
};

// ─── Tasks ─────────────────────────────────────────────
export const tasksApi = {
  list: (params?: Record<string, any>) =>
    api.get<Task[]>("/api/tasks/", { params }).then(r => r.data),
  today: () => api.get<Task[]>("/api/tasks/today").then(r => r.data),
  get: (id: string) => api.get<Task>(`/api/tasks/${id}`).then(r => r.data),
  create: (data: Partial<TaskCreate>) =>
    api.post<Task>("/api/tasks/", data).then(r => r.data),
  update: (id: string, data: TaskUpdate) =>
    api.patch<Task>(`/api/tasks/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/tasks/${id}`),
  complete: (id: string) =>
    api.post<Task>(`/api/tasks/${id}/complete`).then(r => r.data),
  reorder: (ids: string[]) => api.post("/api/tasks/reorder", ids),
};

// ─── Projects ────────────────────────────────────────────
export const projectsApi = {
  list: (params?: Record<string, any>) =>
    api.get<ProjectSummary[]>("/api/projects/", { params }).then(r => r.data),
  get: (id: string) => api.get<Project>(`/api/projects/${id}`).then(r => r.data),
  create: (data: any) => api.post<Project>("/api/projects/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<Project>(`/api/projects/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/projects/${id}`),
};

// ─── Habits ────────────────────────────────────────────
export const habitsApi = {
  list: (params?: Record<string, any>) =>
    api.get<Habit[]>("/api/habits/", { params }).then(r => r.data),
  get: (id: string) => api.get<Habit>(`/api/habits/${id}`).then(r => r.data),
  create: (data: any) => api.post<Habit>("/api/habits/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<Habit>(`/api/habits/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/habits/${id}`),
  complete: (id: string, data: { completed_date: string; note?: string }) =>
    api.post<HabitCompletion>(`/api/habits/${id}/complete`, data).then(r => r.data),
  uncomplete: (id: string, date: string) =>
    api.delete(`/api/habits/${id}/complete/${date}`),
  streak: (id: string) =>
    api.get<{ habit_id: string; streak: number }>(`/api/habits/${id}/streak`).then(r => r.data),
};

// ─── Time Entries ─────────────────────────────────────────
export const timersApi = {
  active: () =>
    api.get<TimeEntry | null>("/api/time-entries/active").then(r => r.data),
  start: (data: { task_id?: string; habit_id?: string; started_at: string; note?: string }) =>
    api.post<TimeEntry>("/api/time-entries/start", data).then(r => r.data),
  stop: (id: string, data: { ended_at: string; note?: string }) =>
    api.post<TimeEntry>(`/api/time-entries/${id}/stop`, data).then(r => r.data),
  list: (params?: Record<string, any>) =>
    api.get<TimeEntry[]>("/api/time-entries/", { params }).then(r => r.data),
};

// ─── Braindump ───────────────────────────────────────────
export const braindumpApi = {
  list: () => api.get<BraindumpEntry[]>("/api/braindump/").then(r => r.data),
  create: (raw_text: string) =>
    api.post<BraindumpEntry>("/api/braindump/", { raw_text }).then(r => r.data),
  process: (id: string) =>
    api.post<BraindumpEntry>(`/api/braindump/${id}/process`).then(r => r.data),
};

// ─── Notes ─────────────────────────────────────────────
export const notesApi = {
  list: (params?: Record<string, any>) =>
    api.get<Note[]>("/api/notes/", { params }).then(r => r.data),
  create: (data: any) => api.post<Note>("/api/notes/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<Note>(`/api/notes/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/notes/${id}`),
};

// ─── CRM ───────────────────────────────────────────────
export const crmApi = {
  list: (params?: Record<string, any>) =>
    api.get<CRMPerson[]>("/api/crm/", { params }).then(r => r.data),
  get: (id: string) => api.get<CRMPerson>(`/api/crm/${id}`).then(r => r.data),
  create: (data: any) => api.post<CRMPerson>("/api/crm/", data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch<CRMPerson>(`/api/crm/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/crm/${id}`),
  markContacted: (id: string) =>
    api.post<CRMPerson>(`/api/crm/${id}/contacted`).then(r => r.data),
};

// ─── Tags ─────────────────────────────────────────────────
export const tagsApi = {
  list: () => api.get<Tag[]>("/api/tags/").then(r => r.data),
  create: (data: { name: string; color: string }) =>
    api.post<Tag>("/api/tags/", data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/tags/${id}`),
};

// ─── Categories ───────────────────────────────────────────
export const categoriesApi = {
  list: () => api.get<Category[]>("/api/categories/").then(r => r.data),
  create: (data: { name: string; color: string; icon?: string }) =>
    api.post<Category>("/api/categories/", data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/categories/${id}`),
};

// ─── Sports ────────────────────────────────────────────
export const sportsApi = {
  favorites: () =>
    api.get<FavoriteSportsTeam[]>("/api/sports/favorites/").then(r => r.data),
  addFavorite: (data: any) =>
    api.post<FavoriteSportsTeam>("/api/sports/favorites/", data).then(r => r.data),
  removeFavorite: (id: string) => api.delete(`/api/sports/favorites/${id}`),
};

export default api;
