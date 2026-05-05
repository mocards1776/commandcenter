import axios from "axios";

const api = axios.create({
  baseURL: "https://orca-app-v7oew.ondigitalocean.app/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token") || localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

// Dashboard
export const dashboardApi = {
  get: () => api.get("/dashboard/").then(r => r.data),
};

// Tasks
export const tasksApi = {
  list: (params?: any) => api.get("/tasks/", { params }).then(r => r.data),
  create: (data: any) => api.post("/tasks/", data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/tasks/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  complete: (id: string) => api.post(`/tasks/${id}/complete`).then(r => r.data),
};

// Projects
export const projectsApi = {
  list: () => api.get("/projects/").then(r => r.data),
};

// Categories
export const categoriesApi = {
  list: () => api.get("/categories/").then(r => r.data),
};

// Tags
export const tagsApi = {
  list: () => api.get("/tags/").then(r => r.data),
};

// Time Entries / Timer
// Backend routes: POST /time-entries/ (start), PATCH /time-entries/{id} (stop),
// GET /time-entries/ (list — we filter client-side for the active entry)
export const timersApi = {
  active: () =>
    api.get("/time-entries/").then(r => {
      const entries: any[] = r.data;
      return entries.find((e: any) => !e.ended_at) ?? null;
    }),
  start: (data: { task_id?: string; started_at: string }) =>
    api.post("/time-entries/", data).then(r => r.data),
  stop: (id: string, data: { ended_at: string }) =>
    api.patch(`/time-entries/${id}`, data).then(r => r.data),
};

// Legacy alias kept for any remaining imports
export const timeEntriesApi = timersApi;
