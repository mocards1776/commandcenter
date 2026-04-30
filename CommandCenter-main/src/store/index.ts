import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TimeEntry, Task } from "@/types";

interface TimerState {
  activeTimer: TimeEntry | null;
  activeTask: Task | null;
  elapsedSeconds: number;
  startedAtMs: number | null;
  setActiveTimer: (timer: TimeEntry | null, task?: Task | null) => void;
  setElapsed: (s: number) => void;
  clearTimer: () => void;
}
export const useTimerStore = create<TimerState>()(
  persist(
    (set) => ({
      activeTimer: null, activeTask: null, elapsedSeconds: 0, startedAtMs: null,
      setActiveTimer: (timer, task = null) => set((s) => {
        if (!timer) return { activeTimer: null, activeTask: null, elapsedSeconds: 0, startedAtMs: null };
        // Backend may return naive ISO without "Z" — treat as UTC
        const raw = timer.started_at;
        const iso = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : raw + "Z";
        const startedAtMs = new Date(iso).getTime();
        return {
          activeTimer: timer,
          activeTask: task ?? s.activeTask,
          startedAtMs,
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
        };
      }),
      setElapsed: (s) => set({ elapsedSeconds: s }),
      clearTimer: () => set({ activeTimer: null, activeTask: null, elapsedSeconds: 0, startedAtMs: null }),
    }),
    {
      name: "timer-store",
      // Only persist the timer + task identity — elapsed is always recalculated from startedAtMs
      partialize: (state) => ({
        activeTimer: state.activeTimer,
        activeTask: state.activeTask,
        startedAtMs: state.startedAtMs,
      }),
    }
  )
);

interface FocusState {
  isFocusMode: boolean;
  setFocus: (v: boolean) => void;
}
export const useFocusStore = create<FocusState>((set) => ({
  isFocusMode: false,
  setFocus: (v) => set({ isFocusMode: v }),
}));

interface CelebrationState {
  celebrating: boolean;
  celebrationTask: Task | null;
  pointsEarned: number;
  triggerCelebration: (task: Task, points: number) => void;
  clearCelebration: () => void;
}
export const useCelebrationStore = create<CelebrationState>((set) => ({
  celebrating: false, celebrationTask: null, pointsEarned: 0,
  triggerCelebration: (task, points) => set({ celebrating: true, celebrationTask: task, pointsEarned: points }),
  clearCelebration: () => set({ celebrating: false, celebrationTask: null, pointsEarned: 0 }),
}));

interface UIState {
  sidebarCollapsed: boolean;
  activePage: string;
  toggleSidebar: () => void;
  setActivePage: (page: string) => void;
}
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false, activePage: "dashboard",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActivePage: (page) => set({ activePage: page }),
    }),
    { name: "ui-store" }
  )
);
