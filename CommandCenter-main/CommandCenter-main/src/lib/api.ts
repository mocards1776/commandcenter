import axios from "axios";

const api = axios.create({
  baseURL: "https://orca-app-v7oew.ondigitalocean.app/api",
  headers: { "Content-Type": "application/json" },
});

// Auth interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token") || localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

// TODO: Add the rest of your api objects (tasksApi, projectsApi, etc.) later
// For now this should at least stop the CORS errors and let us test the connection.
