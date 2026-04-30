import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Calendar as CalendarIcon, Plus, Clock, X, ChevronLeft, ChevronRight, 
  RefreshCw, List, Settings, GripVertical, Maximize2, Minimize2 
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import type { Task, TaskUpdate, TimeBlock, ProjectSummary } from "@/types";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5); // 5 AM to 11 PM
const GCAL_COLORS = ["#4285f4", "#0f9d58", "#f4b400", "#db4437", "#ab47bc", "#00acc1", "#ff7043", "#9e9e9e"];

type ViewMode = "day" | "2day" | "3day";

interface GoogleCalendar {
  id: string;
  summary: string;
}

interface GCalEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  calendar_id: string;
}

const GC_TOKEN_KEY = "gcal_access_token";
const GC_EXPIRY_KEY = "gcal_token_expiry";
const GC_SELECTED_CALS_KEY = "gcal_selected_calendar_ids";

function getStoredToken(): string | null {
  const token = localStorage.getItem(GC_TOKEN_KEY);
  const expiry = localStorage.getItem(GC_EXPIRY_KEY);
  if (!token || !expiry || Date.now() > parseInt(expiry)) return null;
  return token;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [gcalToken, setGcalToken] = useState<string | null>(getStoredToken());
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [zoom, setZoom] = useState(80); // pixels per hour
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(GC_SELECTED_CALS_KEY);
    return saved ? JSON.parse(saved) : ["primary"];
  });
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [showCalendarList, setShowCalendarList] = useState(false);

  const qc = useQueryClient();

  const dates: string[] = useMemo(() => {
    if (viewMode === "day") return [selectedDate];
    if (viewMode === "2day") return [selectedDate, addDays(selectedDate, 1)];
    return [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];
  }, [selectedDate, viewMode]);

  useEffect(() => {
    localStorage.setItem(GC_SELECTED_CALS_KEY, JSON.stringify(selectedCalendarIds));
  }, [selectedCalendarIds]);

  const fetchCalendars = useCallback(async (token: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setCalendars(data.items ?? []);
    } catch (e) { console.error(e); }
  }, []);

  const fetchGcalEvents = useCallback(async (token: string, calIds: string[]) => {
    if (calIds.length === 0) { setGcalEvents([]); return; }
    setGcalLoading(true);
    const start = new Date(dates[0] + "T00:00:00").toISOString();
    const end = new Date(addDays(dates[dates.length - 1], 1) + "T00:00:00").toISOString();
    try {
      const allResults = await Promise.all(
        calIds.map(async (calId) => {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
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

  // Fetch Unscheduled Tasks
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks-unscheduled"],
    queryFn: () => axios.get("/tasks/?status=today,in_progress").then(r => r.data),
  });

  const { data: localBlocks = [] } = useQuery<TimeBlock[]>({
    queryKey: ["time-blocks", selectedDate, viewMode],
    queryFn: async () => {
      const results = await Promise.all(dates.map(d => axios.get(`/api/time-blocks/?date=${d}`).then(r => r.data)));
      return results.flat();
    },
  });

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("taskId", taskId);
  };

  const onDrop = async (e: React.DragEvent, date: string, hour: number) => {
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;
    
    const start = `${hour.toString().padStart(2, '0')}:00:00`;
    const end = `${(hour + 1).toString().padStart(2, '0')}:00:00`;
    
    try {
      await axios.post("/api/time-blocks/", {
        title: tasks.find(t => t.id === taskId)?.title || "Scheduled Task",
        date,
        start_time: start,
        end_time: end,
        task_id: taskId,
        color: "#e8a820"
      });
      qc.invalidateQueries({ queryKey: ["time-blocks"] });
      toast.success("Task scheduled");
    } catch (err) { toast.error("Failed to schedule task"); }
  };

  return (
    <div className="sb-shell" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#162a1c" }}>
      <div className="top-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CalendarIcon size={18} />
          <div className="top-title">CALENDAR / SCHEDULE</div>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: 2, marginLeft: 20 }}>
            {["day", "2day", "3day"].map(m => (
              <button 
                key={m} 
                onClick={() => setViewMode(m as ViewMode)}
                style={{ background: viewMode === m ? "#e8a820" : "transparent", color: viewMode === m ? "#000" : "#fff", border: "none", padding: "2px 8px", fontSize: 10, cursor: "pointer", borderRadius: 2 }}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 5, marginRight: 10 }}>
            <button onClick={() => setZoom(z => Math.max(40, z - 20))} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: 5, borderRadius: 4 }}><Minimize2 size={12}/></button>
            <button onClick={() => setZoom(z => Math.min(160, z + 20))} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: 5, borderRadius: 4 }}><Maximize2 size={12}/></button>
          </div>
          {gcalToken && (
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowCalendarList(!showCalendarList)} style={{ background: "#1e3629", border: "1px solid #e8a820", color: "#e8a820", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
                <List size={12} /> {selectedCalendarIds.length} CALS
              </button>
              {showCalendarList && (
                <div style={{ position: "absolute", top: 35, right: 0, background: "#1e3629", border: "1px solid #e8a820", zIndex: 100, width: 220, padding: 8, borderRadius: 4 }}>
                  {calendars.map(cal => (
                    <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
                      <input type="checkbox" checked={selectedCalendarIds.includes(cal.id)} onChange={() => setSelectedCalendarIds(prev => prev.includes(cal.id) ? prev.filter(x => x !== cal.id) : [...prev, cal.id])} />
                      <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{cal.summary}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="stripe" />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Sidebar: Unscheduled Tasks */}
        <div style={{ width: 200, background: "#1e3629", borderRight: "2px solid #162a1c", padding: 15, overflowY: "auto" }}>
          <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 15, letterSpacing: "0.1em" }}>BACKLOG</div>
          {tasks.filter(t => t.status !== "done").map(task => (
            <div 
              key={task.id} 
              draggable 
              onDragStart={(e) => onDragStart(e, task.id)}
              style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: 4, marginBottom: 8, fontSize: 12, borderLeft: "3px solid #e8a820", cursor: "grab" }}
            >
              {task.title}
            </div>
          ))}
        </div>

        {/* Main Grid */}
        <div style={{ flex: 1, overflowY: "auto", background: "#162a1c" }}>
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#1e3629", position: "sticky", top: 0, zIndex: 50 }}>
            <div style={{ width: 60 }} />
            {dates.map(d => (
              <div key={d} style={{ flex: 1, padding: 10, textAlign: "center", borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#e8a820" }}>{new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</div>
              </div>
            ))}
          </div>

          <div style={{ position: "relative" }}>
            {HOURS.map(hour => (
              <div key={hour} style={{ display: "flex", height: zoom, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div style={{ width: 60, fontSize: 10, opacity: 0.3, textAlign: "right", paddingRight: 10, paddingTop: 5 }}>
                  {hour > 12 ? `${hour-12} PM` : hour === 12 ? "12 PM" : `${hour} AM`}
                </div>
                {dates.map(date => (
                  <div 
                    key={`${date}-${hour}`} 
                    onDragOver={(e) => e.preventDefault()} 
                    onDrop={(e) => onDrop(e, date, hour)}
                    style={{ flex: 1, borderLeft: "1px solid rgba(255,255,255,0.03)", position: "relative" }}
                  >
                    {/* Render Events */}
                    {gcalEvents.filter(e => (e.start.dateTime || e.start.date)?.startsWith(date)).map(event => {
                      const start = new Date(event.start.dateTime || event.start.date + "T00:00:00");
                      const end = new Date(event.end.dateTime || event.end.date + "T23:59:59");
                      if (start.getHours() !== hour) return null;
                      const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                      return (
                        <div key={event.id} style={{ position: "absolute", inset: "2px 4px", height: duration * zoom - 4, background: "rgba(66,133,244,0.1)", borderLeft: "3px solid #4285f4", borderRadius: "0 4px 4px 0", padding: 5, zIndex: 10, overflow: "hidden" }}>
                          <div style={{ fontSize: 9, color: "#4285f4", fontWeight: 700 }}>{start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{event.summary}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
