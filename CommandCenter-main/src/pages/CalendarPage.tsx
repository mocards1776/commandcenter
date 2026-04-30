import { useState, useEffect, useCallback, useMemo } from "react";
import { Calendar, Plus, Clock, X, ChevronLeft, ChevronRight, RefreshCw, List, Settings } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5); // 5 AM to 11 PM

const GCAL_COLORS = ["#4285f4", "#0f9d58", "#f4b400", "#db4437", "#ab47bc", "#00acc1", "#ff7043", "#9e9e9e"];

type ViewMode = "day" | "3day";

interface Block {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  color: string;
  source?: "local" | "google";
  gcal_event_id?: string;
}

interface GCalEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  colorId?: string;
  calendar_id: string;
}

interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

const GC_TOKEN_KEY = "gcal_access_token";
const GC_EXPIRY_KEY = "gcal_token_expiry";
const GC_SELECTED_CALS_KEY = "gcal_selected_calendar_ids";

function getStoredToken(): string | null {
  const token = localStorage.getItem(GC_TOKEN_KEY);
  const expiry = localStorage.getItem(GC_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry)) {
    localStorage.removeItem(GC_TOKEN_KEY);
    localStorage.removeItem(GC_EXPIRY_KEY);
    return null;
  }
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
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(GC_SELECTED_CALS_KEY);
    return saved ? JSON.parse(saved) : ["primary"];
  });
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [showCalendarList, setShowCalendarList] = useState(false);

  const dates: string[] = viewMode === "day"
    ? [selectedDate]
    : [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];

  // Save calendar selections
  useEffect(() => {
    localStorage.setItem(GC_SELECTED_CALS_KEY, JSON.stringify(selectedCalendarIds));
  }, [selectedCalendarIds]);

  const fetchCalendars = useCallback(async (token: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) { setGcalToken(null); return; }
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
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=50`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = await res.json();
          return (data.items ?? []).map((item: any) => ({ ...item, calendar_id: calId }));
        })
      );
      setGcalEvents(allResults.flat());
    } catch (e) {
      console.error(e);
    } finally {
      setGcalLoading(false);
    }
  }, [dates.join(",")]);

  useEffect(() => {
    if (gcalToken) {
      fetchCalendars(gcalToken);
      fetchGcalEvents(gcalToken, selectedCalendarIds);
    }
  }, [gcalToken, selectedCalendarIds, fetchGcalEvents, fetchCalendars]);

  const { data: localBlocks = [] } = useQuery<Block[]>({
    queryKey: ["time-blocks-multi", selectedDate, viewMode],
    queryFn: async () => {
      const results = await Promise.all(
        dates.map(d => axios.get(`/api/time-blocks/?date=${d}`).then(r => r.data).catch(() => []))
      );
      return results.flat();
    },
  });

  const toggleCalendar = (id: string) => {
    setSelectedCalendarIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleConnect = () => {
    const clientId = localStorage.getItem("gcal_client_id");
    if (!clientId) {
      const input = prompt("Enter Google Client ID:");
      if (input) localStorage.setItem("gcal_client_id", input);
      else return;
    }
    const params = new URLSearchParams({
      client_id: localStorage.getItem("gcal_client_id") || "",
      redirect_uri: window.location.origin + window.location.pathname,
      response_type: "token",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  useEffect(() => {
    if (window.location.hash.includes("access_token")) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get("access_token");
      const expiresIn = params.get("expires_in");
      if (token && expiresIn) {
        localStorage.setItem(GC_TOKEN_KEY, token);
        localStorage.setItem(GC_EXPIRY_KEY, String(Date.now() + parseInt(expiresIn) * 1000));
        setGcalToken(token);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  return (
    <div className="sb-shell" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="top-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Calendar size={18} />
          <div className="top-title">CALENDAR / SCHEDULE</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {gcalToken && (
            <div style={{ position: "relative" }}>
              <button 
                onClick={() => setShowCalendarList(!showCalendarList)}
                style={{ background: "#1e3629", border: "1px solid #e8a820", color: "#e8a820", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <List size={12} /> {selectedCalendarIds.length} CALENDARS
              </button>
              {showCalendarList && (
                <div style={{ position: "absolute", top: 35, right: 0, background: "#1e3629", border: "1px solid #e8a820", zIndex: 100, width: 220, padding: 8, borderRadius: 4, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
                  <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 8, letterSpacing: "0.1em" }}>SELECT CALENDARS</div>
                  {calendars.map(cal => (
                    <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 12 }}>
                      <input type="checkbox" checked={selectedCalendarIds.includes(cal.id)} onChange={() => toggleCalendar(cal.id)} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cal.summary}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {!gcalToken ? (
            <button onClick={handleConnect} style={{ background: "#e8a820", color: "#000", border: "none", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>CONNECT GOOGLE</button>
          ) : (
            <button onClick={() => fetchGcalEvents(gcalToken, selectedCalendarIds)} style={{ background: "none", border: "none", color: "#e8a820", cursor: "pointer" }}>
              <RefreshCw size={14} className={gcalLoading ? "animate-spin" : ""} />
            </button>
          )}
        </div>
      </div>
      <div className="stripe" />

      {/* Date Navigation */}
      <div style={{ padding: "8px 20px", background: "#1e3629", display: "flex", alignItems: "center", gap: 15, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={() => setSelectedDate(addDays(selectedDate, -1))} style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "#fff", p: 4, borderRadius: 4, cursor: "pointer" }}><ChevronLeft size={16}/></button>
          <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "#fff", p: 4, borderRadius: 4, cursor: "pointer" }}><ChevronRight size={16}/></button>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#e8a820" }}>
          {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
        </div>
        <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 10 }}>TODAY</button>
      </div>

      {/* Timeblock Layout (Scrollable) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 40px 20px", background: "#162a1c" }}>
        <div style={{ position: "relative", marginTop: 20 }}>
          {HOURS.map(hour => (
            <div key={hour} style={{ display: "flex", height: 80, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
              <div style={{ width: 60, fontSize: 10, color: "rgba(255,255,255,0.3)", paddingTop: 5, textAlign: "right", paddingRight: 10 }}>
                {hour > 12 ? `${hour-12} PM` : hour === 12 ? "12 PM" : `${hour} AM`}
              </div>
              <div style={{ flex: 1, position: "relative" }}>
                {/* Local & GCal Events will be absolute positioned here */}
                {gcalEvents.filter(e => {
                  const startStr = e.start.dateTime || e.start.date;
                  if (!startStr) return false;
                  return startStr.startsWith(selectedDate);
                }).map(event => {
                  const start = new Date(event.start.dateTime || event.start.date + "T00:00:00");
                  const end = new Date(event.end.dateTime || event.end.date + "T23:59:59");
                  
                  const startHour = start.getHours() + start.getMinutes()/60;
                  const endHour = end.getHours() + end.getMinutes()/60;
                  
                  // Only render if it touches this hour block
                  if (Math.floor(startHour) !== hour) return null;

                  const top = 0; // Relative to current hour div
                  const height = (endHour - startHour) * 80;

                  return (
                    <div 
                      key={event.id}
                      style={{ 
                        position: "absolute", 
                        left: 5, 
                        right: 5, 
                        top: (startHour % 1) * 80, 
                        height: Math.max(height, 25), 
                        background: "#1e3629", 
                        borderLeft: "4px solid #4285f4",
                        borderRadius: "0 4px 4px 0",
                        padding: "4px 10px",
                        zIndex: 10,
                        boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
                        overflow: "hidden"
                      }}
                    >
                      <div style={{ fontSize: 9, color: "#4285f4", fontWeight: 700 }}>
                        {start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{event.summary}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
