import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { gamificationApi, tasksApi } from "@/lib/api";
import type { Task } from "@/types";
import { todayStr } from "@/lib/utils";

const GC_TOKEN_KEY = "gcal_access_token";
const GC_EXPIRY_KEY = "gcal_token_expiry";
const GC_SELECTED_CALS_KEY = "gcal_selected_calendar_ids";

type GEvent = {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  calendar_id: string;
};

function dateKey(value?: string): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getStoredGcalToken(): string | null {
  try {
    const token = localStorage.getItem(GC_TOKEN_KEY);
    const expiry = Number(localStorage.getItem(GC_EXPIRY_KEY) || 0);
    if (!token || !expiry || Date.now() > expiry) return null;
    return token;
  } catch {
    return null;
  }
}

function getSelectedCalendarIds(): string[] {
  try {
    const raw = localStorage.getItem(GC_SELECTED_CALS_KEY);
    if (!raw) return ["primary"];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : ["primary"];
  } catch {
    return ["primary"];
  }
}

export function DailySummaryPage() {
  const todayISO = todayStr();
  const tomorrow = addDays(todayISO, 1);
  const day3 = addDays(todayISO, 3);
  const yesterdayISO = addDays(todayISO, -1);
  const gcalToken = getStoredGcalToken();
  const selectedCalIds = getSelectedCalendarIds();

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["daily-summary-tasks"],
    queryFn: () => tasksApi.list({ limit: 400 }),
    refetchInterval: 60_000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["daily-summary-history"],
    queryFn: () => gamificationApi.history(365),
    staleTime: 60_000,
  });

  const { data: gcalEvents = [], isLoading: gcalLoading } = useQuery<GEvent[]>({
    queryKey: ["daily-summary-gcal", todayISO, gcalToken, selectedCalIds.join(",")],
    enabled: !!gcalToken && selectedCalIds.length > 0,
    queryFn: async () => {
      const start = new Date(`${todayISO}T00:00:00`).toISOString();
      const end = new Date(`${addDays(day3, 1)}T00:00:00`).toISOString();
      const result = await Promise.all(
        selectedCalIds.map(async (calId) => {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${gcalToken}` } }
          );
          if (!res.ok) return [];
          const data = await res.json();
          return (data.items ?? []).map((item: any) => ({ ...item, calendar_id: calId }));
        })
      );
      return result.flat();
    },
    refetchInterval: 60_000,
  });

  const scheduledToday = useMemo(
    () =>
      tasks
        .filter((t) => dateKey(t.scheduled_start_at) === todayISO)
        .sort((a, b) => new Date(a.scheduled_start_at || "").getTime() - new Date(b.scheduled_start_at || "").getTime()),
    [tasks, todayISO]
  );

  const gcalToday = useMemo(
    () =>
      gcalEvents
        .filter((e) => dateKey(e.start.dateTime || e.start.date) === todayISO)
        .sort((a, b) => new Date(a.start.dateTime || `${a.start.date}T00:00:00`).getTime() - new Date(b.start.dateTime || `${b.start.date}T00:00:00`).getTime()),
    [gcalEvents, todayISO]
  );

  const nextThreeDays = useMemo(() => {
    const keys = [tomorrow, addDays(todayISO, 2), day3];
    return keys.map((k) => ({
      date: k,
      events: gcalEvents
        .filter((e) => dateKey(e.start.dateTime || e.start.date) === k)
        .sort((a, b) => new Date(a.start.dateTime || `${a.start.date}T00:00:00`).getTime() - new Date(b.start.dateTime || `${b.start.date}T00:00:00`).getTime()),
    }));
  }, [gcalEvents, todayISO, tomorrow, day3]);

  const yesterday = history.find((h: any) => h.stat_date === yesterdayISO);
  const taskRank = useMemo(() => {
    if (!yesterday) return null;
    const vals = [...history].map((h: any) => h.tasks_completed ?? 0).sort((a: number, b: number) => b - a);
    return vals.findIndex((v: number) => v === (yesterday.tasks_completed ?? 0)) + 1;
  }, [history, yesterday]);
  const focusRank = useMemo(() => {
    if (!yesterday) return null;
    const vals = [...history].map((h: any) => h.total_focus_minutes ?? 0).sort((a: number, b: number) => b - a);
    return vals.findIndex((v: number) => v === (yesterday.total_focus_minutes ?? 0)) + 1;
  }, [history, yesterday]);

  return (
    <div>
      <div className="top-bar">
        <div className="top-title">Daily Summary</div>
      </div>
      <div className="stripe" />

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ background: "#1e3629", border: "1px solid rgba(232,168,32,0.25)", padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#e8a820", marginBottom: 8 }}>Today Scheduled Tasks</div>
          {tasksLoading ? <div style={{ opacity: 0.5 }}>Loading…</div> : scheduledToday.length === 0 ? <div style={{ opacity: 0.55 }}>No tasks scheduled today.</div> : (
            <div style={{ display: "grid", gap: 6 }}>
              {scheduledToday.map((t) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                  <span>{t.title}</span>
                  <span style={{ color: "rgba(245,240,224,0.6)" }}>{new Date(t.scheduled_start_at || "").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#1e3629", border: "1px solid rgba(66,133,244,0.35)", padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7db1ff", marginBottom: 8 }}>Google Calendar Events Today</div>
          {!gcalToken ? <div style={{ opacity: 0.55 }}>Connect Google Calendar on Calendar page to show events.</div> : gcalLoading ? <div style={{ opacity: 0.5 }}>Loading…</div> : gcalToday.length === 0 ? <div style={{ opacity: 0.55 }}>No Google events today.</div> : (
            <div style={{ display: "grid", gap: 6 }}>
              {gcalToday.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                  <span>{e.summary || "(No title)"}</span>
                  <span style={{ color: "rgba(245,240,224,0.6)" }}>{e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "All day"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#1e3629", border: "1px solid rgba(232,168,32,0.25)", padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#e8a820", marginBottom: 8 }}>Yesterday Rundown</div>
          {!yesterday ? (
            <div style={{ opacity: 0.55 }}>No history available for yesterday.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(120px,1fr))", gap: 10 }}>
              <div><div style={{ opacity: 0.55, fontSize: 10 }}>Tasks Done</div><div style={{ fontSize: 20, color: "#e8a820" }}>{yesterday.tasks_completed ?? 0}</div></div>
              <div><div style={{ opacity: 0.55, fontSize: 10 }}>Focus Minutes</div><div style={{ fontSize: 20, color: "#e8a820" }}>{yesterday.total_focus_minutes ?? 0}</div></div>
              <div><div style={{ opacity: 0.55, fontSize: 10 }}>Batting Avg</div><div style={{ fontSize: 20, color: "#e8a820" }}>{(yesterday.batting_average ?? 0).toFixed(3).replace(/^0/, ".")}</div></div>
              <div><div style={{ opacity: 0.55, fontSize: 10 }}>Task Rank (All-time)</div><div style={{ fontSize: 16 }}>#{taskRank ?? "-"}</div></div>
              <div><div style={{ opacity: 0.55, fontSize: 10 }}>Focus Rank (All-time)</div><div style={{ fontSize: 16 }}>#{focusRank ?? "-"}</div></div>
              <div><div style={{ opacity: 0.55, fontSize: 10 }}>Attempts</div><div style={{ fontSize: 16 }}>{yesterday.tasks_attempted ?? 0}</div></div>
            </div>
          )}
        </div>

        <div style={{ background: "#1e3629", border: "1px solid rgba(66,133,244,0.35)", padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7db1ff", marginBottom: 8 }}>Next 3 Days (Google Calendar)</div>
          {!gcalToken ? <div style={{ opacity: 0.55 }}>Connect Google Calendar to show this section.</div> : (
            <div style={{ display: "grid", gap: 10 }}>
              {nextThreeDays.map((day) => (
                <div key={day.date}>
                  <div style={{ fontSize: 11, color: "rgba(245,240,224,0.8)", marginBottom: 4 }}>{new Date(`${day.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</div>
                  {day.events.length === 0 ? (
                    <div style={{ opacity: 0.45, fontSize: 11 }}>No events</div>
                  ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                      {day.events.map((e) => (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                          <span>{e.summary || "(No title)"}</span>
                          <span style={{ color: "rgba(245,240,224,0.6)" }}>{e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "All day"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
