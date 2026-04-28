import axios from "axios";
import type { /* ... all your types ... */ } from "@/types";

const api = axios.create({
  baseURL: "https://orca-app-v7oew.ondigitalocean.app/api",
  headers: { "Content-Type": "application/json" },
});

// Add this for auth (important)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
