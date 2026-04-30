import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Calendar as CalendarIcon,
  List,
  Maximize2,
  Minimize2,
  LogIn,
  LogOut,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import type { Task, TimeBlock } from "@/types";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5); // 5 AM – 11 PM
const BLOCK_COLORS = [
  "#4285f4","#0f9d58","#f4b400","#db4437",
  "#ab47bc","#00acc1","#ff7043","#e8a820",
  "#6366f1","#f43f5e",
];

type ViewMode = "day" | "2day" | "3day";

interface GoogleCalendar { id: string; summary: string; }
interface GCalEvent {
  id: string; summary: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  calendar_id: string;
}

const GC_TOKEN_KEY        = "gcal_access_token";
const GC_EXPIRY_KEY       = "gcal_token_expiry";
const GC_SELECTED_CALS_KEY = "gcal_selected_calendar_ids";

// Google OAuth constants
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function getStoredToken(): string | null {
  try {
    const token  = localStorage.getItem(GC_TOKEN_KEY);
    const expiry = localStorage.getItem(GC_EXPIRY_KEY);
    if (!token || !expiry || Date.now() > parseInt(expiry)) return null;
    return token;
  } catch {
    return null;
  }
}

function storeToken(token: string, expiresIn: number) {
  try {
    localStorage.setItem(GC_TOKEN_KEY, token);
    localStorage.setItem(GC_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
  } catch (e) {
    console.error("localStorage unavailable", e);
  }
}

function clearToken() {
  try {
    localStorage.removeItem(GC_TOKEN_KEY);
    localStorage.removeItem(GC_EXPIRY_KEY);
  } catch { /* ignore */ }
}

function connectGoogleCalendar() {
  if (!GOOGLE_CLIENT_ID) {
    alert("VITE_GOOGLE_CLIENT_ID is not set. Add it to your Vercel environment variables.");
    return;
  }
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: GCAL_SCOPE,
    include_granted_scopes: "true",
    prompt: "consent",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ── Greedy column-packing for overlapping events ──────────────────────────────
interface Slottable { startMin: number; endMin: number; }
function computeLayout<T extends Slottable>(
  items: T[]
): (T & { col: number; totalCols: number })[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  const colEnds: number[] = [];
  const assignments: { item: T; col: number }[] = [];

  for (const item of sorted) {
    let col = colEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) { col = colEnds.length; colEnds.push(item.endMin); }
    else colEnds[col] = item.endMin;
    assignments.push({ item, col });
  }

  return assignments.map(({ item, col }) => {
    const maxCol = Math.max(
      ...assignments
        .filter(({ item: b }) => b.startMin < item.endMin && b.endMin > item.startMin)
        .map((a) => a.col)
    );
    return { ...item, col, totalCols: maxCol + 1 };
  });
}

// ── Color-picker popover for local blocks ─────────────────────────────────────
function ColorPicker({
  current, onPick, onClose,
}: { current: string; onPick: (c: string) => void; onClose: () => void; }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
        background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 8, padding: "8px 10px",
        display: "flex", gap: 6, flexWrap: "wrap", width: 164,
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ width: "100%", fontSize: 9, color: "rgba(255,255,255,0.35)",
        letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2 }}>
        Change Color
      </div>
      {BLOCK_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => { onPick(c); onClose(); }}
          style={{
            width: 22, height: 22, borderRadius: "50%", backgroundColor: c,
            border: current === c ? "2px solid #fff" : "2px solid transparent",
            cursor: "pointer", padding: 0,
          }}
        />
      ))}
    </div>
  );
}

// ── Single day column ─────────────────────────────────────────────────────────
function DayColumn({
  date, zoom, gcalEvents, localBlocks, onColorChange, onDrop,
}: {
  date: string;
  zoom: number;
  gcalEvents: GCalEvent[];
  localBlocks: TimeBlock[];
  onColorChange: (id: string, color: string) => void;
  onDrop: (e: React.DragEvent, date: string, hour: number) => void;
}) {
  const [pickerBlockId, setPickerBlockId] = useState<string | null>(null);
  const START_HOUR = 5;

  const gcalForDay = useMemo(() => {
    return gcalEvents
      .filter((e) => {
        const dt = e.start.dateTime || (e.start.date ? e.start.date + "T00:00:00" : null);
        return dt?.startsWith(date);
      })
      .map((e) => {
        const start = new Date(e.start.dateTime || e.start.date + "T00:00:00");
        const end   = new Date(e.end.dateTime   || e.end.date   + "T23:59:59");
        return {
          ...e,
          startMin: start.getHours() * 60 + start.getMinutes(),
          endMin:   end.getHours()   * 60 + end.getMinutes(),
        };
      });
  }, [gcalEvents, date]);

  const localForDay = useMemo(() => {
    return localBlocks
      .filter((b) => {
        const bt = b.start_time || "";
        return bt.startsWith(date);
      })
      .map((b) => {
        const start = new Date(b.start_time);
        const end   = new Date(b.end_time);
        return {
          ...b,
          startMin: start.getHours() * 60 + start.getMinutes(),
          endMin:   end.getHours()   * 60 + end.getMinutes(),
        };
      });
  }, [localBlocks, date]);

  const gcalLayout   = computeLayout(gcalForDay);
  const localLayout  = computeLayout(localForDay);
  const totalH = HOURS.length * zoom;

  return (
    <div
      style={{ flex: 1, borderLeft: "1px solid rgba(255,255,255,0.03)", position: "relative", height: totalH }}
      onDragOver={(e) => e.preventDefault()}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          onDrop={(e) => onDrop(e, date, h)}
          onDragOver={(e) => e.preventDefault()}
          style={{ height: zoom, borderTop: "1px solid rgba(255,255,255,0.03)" }}
        />
      ))}

      {gcalLayout.map((ev) => {
        const top    = ((ev.startMin - START_HOUR * 60) / 60) * zoom;
        const height = Math.max(((ev.endMin - ev.startMin) / 60) * zoom, 18);
        const wPct   = 100 / ev.totalCols;
        const lPct   = ev.col * wPct;
        const start  = new Date(ev.start.dateTime || ev.start.date + "T00:00:00");
        return (
          <div
            key={ev.id}
            style={{
              position: "absolute",
              top, height,
              left:  `calc(${lPct}% + ${ev.col > 0 ? 2 : 2}px)`,
              width: `calc(${wPct}% - 4px)`,
              background: "rgba(66,133,244,0.12)",
              borderLeft: "3px solid #4285f4",
              borderRadius: "0 4px 4px 0",
              padding: "3px 5px",
              overflow: "hidden",
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: 9, color: "#4285f4", fontWeight: 700 }}>
              {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
            {height >= 28 && (
              <div style={{ fontSize: 10, fontWeight: 600, color: "#fff", lineHeight: 1.2 }}>
                {ev.summary}
              </div>
            )}
          </div>
        );
      })}

      {localLayout.map((block) => {
        const top    = ((block.startMin - START_HOUR * 60) / 60) * zoom;
        const height = Math.max(((block.endMin - block.startMin) / 60) * zoom, 18);
        const wPct   = 100 / block.totalCols;
        const lPct   = block.col * wPct;
        const color  = block.color || "#e8a820";
        return (
          <div
            key={block.id}
            onClick={() => setPickerBlockId(pickerBlockId === block.id ? null : block.id)}
            style={{
              position: "absolute",
              top, height,
              left:  `calc(${lPct}% + ${block.col > 0 ? 2 : 2}px)`,
              width: `calc(${wPct}% - 4px)`,
              background: color + "22",
              borderLeft: `3px solid ${color}`,
              borderRadius: "0 4px 4px 0",
              padding: "3px 5px",
              overflow: "visible",
              cursor: "pointer",
              zIndex: pickerBlockId === block.id ? 50 : 20,
            }}
          >
            {height >= 20 && (
              <div style={{ fontSize: 10, fontWeight: 700, color, whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "0.03em" }}>
                {block.title}
              </div>
            )}
            {pickerBlockId === block.id && (
              <ColorPicker
                current={color}
                onPick={(c) => onColorChange(block.id, c)}
                onClose={() => setPickerBlockId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function CalendarPage() {
  const [viewMode, setViewMode]     = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [gcalToken, setGcalToken]   = useState<string | null>(getStoredToken());
  const [calendars, setCalendars]   = useState<GoogleCalendar[]>([]);
  const [zoom, setZoom]             = useState(80);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(GC_SELECTED_CALS_KEY);
      return saved ? JSON.parse(saved) : ["primary"];
    } catch {
      return ["primary"];
    }
  });
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [showCalendarList, setShowCalendarList] = useState(false);

  const qc = useQueryClient();

  const dates: string[] = useMemo(() => {
    if (viewMode === "day")   return [selectedDate];
    if (viewMode === "2day")  return [selectedDate, addDays(selectedDate, 1)];
    return [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];
  }, [selectedDate, viewMode]);

  // ── Handle OAuth redirect: extract token from URL hash ──────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.slice(1));
      const token     = params.get("access_token");
      const expiresIn = parseInt(params.get("expires_in") || "3600", 10);
      const errorMsg  = params.get("error");

      if (errorMsg) {
        toast.error(`Google auth error: ${errorMsg}`);
      } else if (token) {
        storeToken(token, expiresIn);
        setGcalToken(token);
        toast.success("Google Calendar connected!");
      }
      // Clean up the hash from the URL
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GC_SELECTED_CALS_KEY, JSON.stringify(selectedCalendarIds));
    } catch { /* ignore */ }
  }, [selectedCalendarIds]);

  const fetchCalendars = useCallback(async (token: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          // Token expired — clear it
          clearToken();
          setGcalToken(null);
          toast.error("Google Calendar session expired. Please reconnect.");
        }
        return;
      }
      const data = await res.json();
      setCalendars(data.items ?? []);
    } catch (e) { console.error(e); }
  }, []);

  const fetchGcalEvents = useCallback(async (token: string, calIds: string[]) => {
    if (!calIds.length) { setGcalEvents([]); return; }
    setGcalLoading(true);
    const start = new Date(dates[0] + "T00:00:00").toISOString();
    const end   = new Date(addDays(dates[dates.length - 1], 1) + "T00:00:00").toISOString();
    try {
      const allResults = await Promise.all(
        calIds.map(async (calId) => {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) {
            if (res.status === 401) {
              clearToken();
              setGcalToken(null);
              toast.error("Google Calendar session expired. Please reconnect.");
            }
            return [];
          }
          const data = await res.json();
          return (data.items ?? []).map((item: any) => ({ ...item, calendar_id: calId }));
        })
      );
      setGcalEvents(allResults.flat());
    } finally { setGcalLoading(false); }
  }, [dates]);

  useEffect(() => {
    if (gcalToken) {
      fetchCalendars(gcalToken);
      fetchGcalEvents(gcalToken, selectedCalendarIds);
    }
  }, [gcalToken, selectedCalendarIds, fetchGcalEvents, fetchCalendars]);

  const handleDisconnect = () => {
    clearToken();
    setGcalToken(null);
    setCalendars([]);
    setGcalEvents([]);
    toast.success("Google Calendar disconnected.");
  };

  // ── Backlog ────────────────────────────────────────────────────────────────
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks-backlog-calendar"],
    queryFn: () =>
      axios
        .get(`${apiBase}/api/tasks/`, { params: { status: "today,in_progress,inbox", limit: 100 } })
        .then((r) => (Array.isArray(r.data) ? r.data : r.data.results ?? []))
        .catch(() => []),
    refetchInterval: 60_000,
  });
  const backlogTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");

  // ── Local time blocks ──────────────────────────────────────────────────────
  const { data: localBlocks = [] } = useQuery<TimeBlock[]>({
    queryKey: ["time-blocks", selectedDate, viewMode],
    queryFn: async () => {
      const results = await Promise.all(
        dates.map((d) =>
          axios.get(`${apiBase}/api/time-blocks/`, { params: { date: d } }).then((r) => r.data)
        )
      );
      return results.flat();
    },
  });

  const colorMutation = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) =>
      axios.patch(`${apiBase}/api/time-blocks/${id}/`, { color }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-blocks"] });
      toast.success("Color updated");
    },
    onError: () => toast.error("Failed to update color"),
  });

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("taskId", taskId);
  };

  const onDrop = async (e: React.DragEvent, date: string, hour: number) => {
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    try {
      await axios.post(`${apiBase}/api/time-blocks/`, {
        title:      task?.title || "Scheduled Task",
        date,
        start_time: `${date}T${String(hour).padStart(2, "0")}:00:00`,
        end_time:   `${date}T${String(hour + 1).padStart(2, "0")}:00:00`,
        task_id:    taskId,
        color:      "#e8a820",
      });
      qc.invalidateQueries({ queryKey: ["time-blocks"] });
      toast.success("Task scheduled");
    } catch { toast.error("Failed to schedule task"); }
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMin - 5 * 60) / 60) * zoom;

  return (
    <div className="sb-shell" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#162a1c" }}>
      {/* ── Top bar ── */}
      <div className="top-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CalendarIcon size={18} />
          <div className="top-title">CALENDAR / SCHEDULE</div>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: 2, marginLeft: 20 }}>
            {(["day","2day","3day"] as ViewMode[]).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                style={{ background: viewMode === m ? "#e8a820" : "transparent",
                  color: viewMode === m ? "#000" : "#fff", border: "none",
                  padding: "2px 8px", fontSize: 10, cursor: "pointer", borderRadius: 2 }}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 5 }}>
            <button onClick={() => setZoom((z) => Math.max(40, z - 20))}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: 5, borderRadius: 4, cursor: "pointer" }}>
              <Minimize2 size={12} />
            </button>
            <button onClick={() => setZoom((z) => Math.min(160, z + 20))}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: 5, borderRadius: 4, cursor: "pointer" }}>
              <Maximize2 size={12} />
            </button>
          </div>

          {/* ── Google Calendar connect / disconnect ── */}
          {!gcalToken ? (
            <button
              onClick={connectGoogleCalendar}
              title={!GOOGLE_CLIENT_ID ? "VITE_GOOGLE_CLIENT_ID not set" : "Connect Google Calendar"}
              style={{
                background: GOOGLE_CLIENT_ID ? "#4285f4" : "rgba(255,255,255,0.1)",
                border: "none", color: "#fff",
                padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
                opacity: GOOGLE_CLIENT_ID ? 1 : 0.5,
              }}
            >
              <LogIn size={12} /> CONNECT GCAL
            </button>
          ) : (
            <>
              {gcalLoading && (
                <span style={{ fontSize: 9, opacity: 0.4, color: "#4285f4" }}>loading…</span>
              )}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowCalendarList(!showCalendarList)}
                  style={{ background: "#1e3629", border: "1px solid #4285f4", color: "#4285f4",
                    padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 4 }}>
                  <List size={12} /> {selectedCalendarIds.length} CALS
                </button>
                {showCalendarList && (
                  <div style={{ position: "absolute", top: 35, right: 0, background: "#1e3629",
                    border: "1px solid #4285f4", zIndex: 100, width: 220, padding: 8, borderRadius: 4 }}>
                    {calendars.length === 0 && (
                      <div style={{ fontSize: 10, opacity: 0.5, padding: "4px 0" }}>No calendars found</div>
                    )}
                    {calendars.map((cal) => (
                      <label key={cal.id} style={{ display: "flex", alignItems: "center",
                        gap: 8, padding: "4px 0", fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox" checked={selectedCalendarIds.includes(cal.id)}
                          onChange={() =>
                            setSelectedCalendarIds((prev) =>
                              prev.includes(cal.id) ? prev.filter((x) => x !== cal.id) : [...prev, cal.id]
                            )}
                        />
                        <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {cal.summary}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                title="Disconnect Google Calendar"
                style={{
                  background: "rgba(255,255,255,0.08)", border: "none", color: "rgba(255,255,255,0.5)",
                  padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <LogOut size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="stripe" />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── Backlog sidebar ── */}
        <div style={{ width: 200, background: "#1e3629", borderRight: "2px solid #162a1c",
          padding: 15, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 4, letterSpacing: "0.1em" }}>BACKLOG</div>
          <div style={{ fontSize: 9, opacity: 0.3, marginBottom: 12 }}>Drag to schedule →</div>
          {backlogTasks.length === 0 ? (
            <div style={{ fontSize: 10, opacity: 0.25, fontStyle: "italic", textAlign: "center", marginTop: 20 }}>
              All clear
            </div>
          ) : (
            backlogTasks.map((task) => (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => onDragStart(e, task.id)}
                style={{ background: "rgba(0,0,0,0.2)", padding: "8px 10px", borderRadius: 4,
                  marginBottom: 7, fontSize: 11, borderLeft: "3px solid #e8a820", cursor: "grab",
                  lineHeight: 1.3 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{task.title}</div>
                <div style={{ fontSize: 9, opacity: 0.45, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {task.status === "today" ? "📌 Today"
                   : task.status === "in_progress" ? "⚡ Active"
                   : "📥 Inbox"}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Calendar grid ── */}
        <div style={{ flex: 1, overflowY: "auto", background: "#162a1c" }}>
          {/* Date headers */}
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: "#1e3629", position: "sticky", top: 0, zIndex: 50 }}>
            <div style={{ width: 60 }} />
            {dates.map((d) => (
              <div key={d} style={{ flex: 1, padding: 10, textAlign: "center",
                borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#e8a820" }}>
                  {new Date(d + "T12:00:00").toLocaleDateString("en-US",
                    { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div style={{ display: "flex", position: "relative" }}>
            {/* Hour labels */}
            <div style={{ width: 60, flexShrink: 0 }}>
              {HOURS.map((h) => (
                <div key={h} style={{ height: zoom, display: "flex", alignItems: "flex-start",
                  paddingTop: 4, paddingRight: 8, justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 9, opacity: 0.3 }}>
                    {h > 12 ? `${h - 12} PM` : h === 12 ? "12 PM" : `${h} AM`}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {dates.map((date) => (
              <DayColumn
                key={date}
                date={date}
                zoom={zoom}
                gcalEvents={gcalEvents}
                localBlocks={localBlocks}
                onColorChange={(id, color) => colorMutation.mutate({ id, color })}
                onDrop={onDrop}
              />
            ))}

            {/* Current time red line (day view only) */}
            {isToday && nowMin >= 5 * 60 && nowMin <= 23 * 60 && (
              <div style={{
                position: "absolute",
                top: nowTop,
                left: 60,
                right: 0,
                height: 2,
                background: "#f43f5e",
                zIndex: 30,
                pointerEvents: "none",
                opacity: 0.85,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%",
                  background: "#f43f5e", marginTop: -3, marginLeft: -4 }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
