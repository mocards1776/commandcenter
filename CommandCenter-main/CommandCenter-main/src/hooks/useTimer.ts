import { useEffect, useRef, useCallback } from "react";
import { useTimerStore } from "@/store";
import { timersApi } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

export function useActiveTimer() {
  const { activeTimer, activeTask, elapsedSeconds, startedAtMs, setElapsed, setActiveTimer, clearTimer } = useTimerStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qc = useQueryClient();

  const tick = useCallback(() => {
    if (!startedAtMs) return;
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
  }, [startedAtMs, setElapsed]);

  useQuery({
    queryKey: ["active-timer"],
    queryFn: async () => {
      const timer = await timersApi.active();
      if (timer) setActiveTimer(timer);
      return timer;
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (!activeTimer || !startedAtMs) { setElapsed(0); return; }
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [activeTimer?.id, startedAtMs]); // eslint-disable-line

  const startMutation = useMutation({
    mutationFn: (data: { task_id?: string }) =>
      timersApi.start({ ...data, started_at: new Date().toISOString() }),
    onSuccess: (timer) => { setActiveTimer(timer); qc.invalidateQueries({ queryKey: ["active-timer"] }); },
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

  return {
    activeTimer, activeTask, elapsedSeconds,
    isRunning: !!activeTimer,
    start: (data?: { task_id?: string }) => startMutation.mutate(data ?? {}),
    stop: () => stopMutation.mutate(),
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
