import axios from "axios";

const api = axios.create({
  baseURL: "https://orca-app-v7oew.ondigitalocean.app/api",
  headers: { "Content-Type": "application/json" },
});

// Auth interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token") || localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

// You can add the individual api objects (tasksApi, projectsApi, etc.) later if needed.
// For now this gets the connection working.
