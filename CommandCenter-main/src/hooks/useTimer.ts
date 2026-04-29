import { useEffect, useRef, useCallback } from "react";
import { useTimerStore } from "@/store";
import { timersApi } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

export function useActiveTimer() {
  const { activeTimer, activeTask, elapsedSeconds, startedAtMs, setElapsed, setActiveTimer, clearTimer } = useTimerStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtMsRef = useRef<number | null>(startedAtMs);
  const qc = useQueryClient();

  // Keep ref in sync so interval callback always has fresh value
  useEffect(() => { startedAtMsRef.current = startedAtMs; }, [startedAtMs]);

  const tick = useCallback(() => {
    if (!startedAtMsRef.current) return;
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAtMsRef.current) / 1000)));
  }, [setElapsed]);

  useQuery({
    queryKey: ["active-timer"],
    queryFn: async () => {
      const timer = await timersApi.active();
      if (timer) setActiveTimer(timer);
      else clearTimer();
      return timer;
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (!activeTimer || !startedAtMs) { setElapsed(0); return; }
    tick(); // immediate first tick
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [activeTimer?.id, startedAtMs, tick]);

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
