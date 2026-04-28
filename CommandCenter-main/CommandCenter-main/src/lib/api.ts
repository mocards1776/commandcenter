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

// Time Entries
export const timeEntriesApi = {
  active: () => api.get("/time-entries/active").then(r => r.data),
};
