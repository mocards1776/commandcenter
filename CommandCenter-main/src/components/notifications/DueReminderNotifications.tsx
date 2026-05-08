import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { tasksApi } from "@/lib/api";

function toMs(v?: string) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export function DueReminderNotifications() {
  const sentKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", "notifications"],
    queryFn: () => tasksApi.list({}),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const now = Date.now();
    for (const task of tasks) {
      if (task.status === "done" || task.status === "cancelled") continue;
      const dueMs = toMs(task.due_date);
      const startMs = toMs((task as any).scheduled_start_at);

      if (dueMs && now >= dueMs && now - dueMs <= 5 * 60_000) {
        const k = `due:${task.id}:${new Date(dueMs).toISOString().slice(0, 16)}`;
        if (!sentKeys.current.has(k)) {
          sentKeys.current.add(k);
          toast(`Due now: ${task.title}`, { icon: "⏰" });
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification("Task due now", { body: task.title });
          }
        }
      }

      if (startMs && now >= startMs && now - startMs <= 5 * 60_000) {
        const k = `start:${task.id}:${new Date(startMs).toISOString().slice(0, 16)}`;
        if (!sentKeys.current.has(k)) {
          sentKeys.current.add(k);
          toast(`Start time: ${task.title}`, { icon: "🔔" });
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification("Task start reminder", { body: task.title });
          }
        }
      }
    }
  }, [tasks]);

  return null;
}
