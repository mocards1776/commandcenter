import { useEffect, useRef, useCallback } from "react";
import { useTimerStore } from "@/store";
import { timersApi, tasksApi } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

export function useActiveTimer() {
  const { activeTimer, activeTask, elapsedSeconds, startedAtMs, setElapsed, setActiveTimer, clearTimer } = useTimerStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Initialise ref directly from store so first tick is always correct
  const startedAtMsRef = useRef<number | null>(startedAtMs);
  const qc = useQueryClient();
  const autoStoppedRef = useRef(false);

  // Keep ref in sync so interval callback always has fresh value
  useEffect(() => { startedAtMsRef.current = startedAtMs; }, [startedAtMs]);

  const tick = useCallback(() => {
    const s = startedAtMsRef.current;
    if (!s || isNaN(s)) return;
    const diff = Math.floor((Date.now() - s) / 1000);
    if (diff < 0 || diff > 86400 * 7) return; // sanity guard
    setElapsed(diff);
  }, [setElapsed]);

  useQuery({
    queryKey: ["active-timer"],
    queryFn: async () => {
      const timer = await timersApi.active();
      if (timer) {
        // Ensure started_at is treated as UTC before storing
        if (timer.started_at && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(timer.started_at)) {
          timer.started_at = timer.started_at + "Z";
        }
        let task = null;
        if (timer.task_id) {
          try { task = await tasksApi.get(timer.task_id); } catch {}
        }
        setActiveTimer(timer, task);
      } else {
        clearTimer();
      }
      return timer;
    },
    refetchInterval: 60_000,
  });

  // ─── Auto-stop: poll active task every 8s; stop if it's been completed ───
  const stopRef = useRef<() => void>(() => {});

  useQuery({
    queryKey: ["active-task-watch", activeTimer?.task_id],
    queryFn: async () => {
      if (!activeTimer?.task_id) return null;
      const task = await tasksApi.get(activeTimer.task_id);
      if (task.status === "done" && !autoStoppedRef.current) {
        autoStoppedRef.current = true;
        stopRef.current();
        toast.success("✅ Task completed — timer stopped");
      }
      return task;
    },
    refetchInterval: 8_000,
    enabled: !!activeTimer?.task_id,
  });

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (!activeTimer || !startedAtMs) { setElapsed(0); return; }
    // Sync ref immediately before starting interval so first tick is never stale
    startedAtMsRef.current = startedAtMs;
    autoStoppedRef.current = false;
    tick(); // immediate first tick
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [activeTimer?.id, startedAtMs, tick]);

  const startMutation = useMutation({
    mutationFn: (data: { task_id?: string }) =>
      timersApi.start({ ...data, started_at: new Date().toISOString() }),
    onSuccess: async (timer, variables) => {
      let task = null;
      if (variables.task_id) {
        try { task = await tasksApi.get(variables.task_id); } catch {}
      }
      setActiveTimer(timer, task);
      qc.invalidateQueries({ queryKey: ["active-timer"] });
    },
    onError: () => toast.error("Failed to start timer"),
  });

  const stopMutation = useMutation({
    mutationFn: () => {
      if (!activeTimer) throw new Error("No active timer");
      return timersApi.stop(activeTimer.id, { ended_at: new Date().toISOString() });
    },
    onSuccess: () => {
      clearTimer();
      qc.invalidateQueries({ queryKey: ["active-timer"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("⏹ Timer stopped");
    },
    onError: () => toast.error("Failed to stop timer"),
  });

  // Keep stopRef current so the auto-stop watcher can call it
  stopRef.current = () => stopMutation.mutate();

  // Complete task + stop timer in one action (used by FocusMode)
  const completeAndStop = useCallback(async () => {
    const taskId = activeTimer?.task_id ?? activeTask?.id;

    if (!taskId) {
      toast.error("No task linked to this timer");
      return;
    }

    let freshTask = activeTask;
    try {
      freshTask = await tasksApi.get(taskId);
    } catch {}

    if (!freshTask?.id) {
      toast.error("Could not load task — please try again");
      return;
    }

    try {
      await tasksApi.complete(freshTask.id);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? "Failed to complete task";
      toast.error(msg);
      return;
    }

    if (activeTimer) {
      stopMutation.mutate();
    }
  }, [activeTask, activeTimer, stopMutation, qc]);

  return {
    activeTimer, activeTask, elapsedSeconds,
    isRunning: !!activeTimer,
    start: (data?: { task_id?: string }) => startMutation.mutate(data ?? {}),
    stop: () => stopMutation.mutate(),
    completeAndStop,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
