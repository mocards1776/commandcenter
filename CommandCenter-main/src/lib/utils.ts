import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Priority } from "@/types";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}

export function formatMinutes(min: number): string {
  if (!min || min <= 0) return "0m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function priorityColor(p: Priority): string {
  return { low:"#22c55e", medium:"#38bdf8", high:"#f4a21b", critical:"#e63946" }[p] ?? "#38bdf8";
}

export function focusScoreColor(score: number): string {
  if (score >= 20) return "#e63946";
  if (score >= 15) return "#f4a21b";
  if (score >= 10) return "#38bdf8";
  return "#2e4d9a";
}

export function todayStr(): string { return new Date().toISOString().split("T")[0]; }
export function battingAvgStr(avg: number): string {
  if (!avg || avg <= 0) return ".000";
  return avg.toFixed(3).replace(/^0/, "");
}
export function isOverdue(d?: string): boolean {
  return !!d && d < new Date().toISOString().split("T")[0];
}
export function relativeDate(s: string): string {
  const diff = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
export function calcPoints(task: { focus_score: number }): number {
  return Math.round(task.focus_score * 18);
}
