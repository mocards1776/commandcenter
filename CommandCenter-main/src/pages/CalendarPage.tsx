import { useState, useEffect, useCallback } from "react";
import { Calendar, Plus, Clock, X, ChevronLeft, ChevronRight, RefreshCw, Link, Check, List } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";

const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 5 AM to 11 PM

const BLOCK_COLORS = [
  "#6366f1", "#8b5cf6", "#22c55e", "#f59e0b",
  "#f43f5e", "#38bdf8", "#fb923c", "#a78bfa",
];

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
  calendar_id?: string;
}

interface GCalEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  colorId?: string;
  htmlLink?: string;
}

interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
const GC_TOKEN_KEY = "gcal_access_token";
const GC_EXPIRY_KEY = "gcal_token_expiry";

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
  const [selectedCalendarIds, setSelectedSelectedCalendarIds] = useState<string[]>(["primary"]);
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [showCalendarList, setShowCalendarList] = useState(false);

  const dates: string[] = viewMode === "day"
    ? [selectedDate]
    : [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];

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
    setGcalLoading(true);
    const start = new Date(dates[0] + "T00:00:00").toISOString();
    const end = new Date(addDays(dates[dates.length - 1], 1) + "T00:00:00").toISOString();
    
    try {
      const allEvents = await Promise.all(
        calIds.map(async (calId) => {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=50`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = await res.json();
          return (data.items ?? []).map((item: any) => ({ ...item, calendar_id: calId }));
        })
      );
      setGcalEvents(allEvents.flat());
    } catch (e) {
      console.error(e);
      toast.error("Failed to fetch Google Calendar");
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

  const toggleCalendar = (id: string) => {
    setSelectedSelectedCalendarIds(prev => 
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
      scope: GCAL_SCOPES,
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const params = new URLSearchParams(hash.slice(1));
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
    <div className="sb-shell" style={{ minHeight: "100vh" }}>
      <div className="top-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📅</span>
          <div className="top-title">CALENDAR / SCHEDULE</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          {gcalToken ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
              <button 
                onClick={() => setShowCalendarList(!showCalendarList)}
                style={{ background: "#1e3629", border: "1px solid #e8a820", color: "#e8a820", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <List size={12} /> {selectedCalendarIds.length} CALENDARS
              </button>
              
              {showCalendarList && (
                <div style={{ position: "absolute", top: 35, right: 0, background: "#1e3629", border: "1px solid #e8a820", zIndex: 100, width: 200, padding: 8, borderRadius: 4, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
                  {calendars.map(cal => (
                    <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer", fontSize: 12 }}>
                      <input type="checkbox" checked={selectedCalendarIds.includes(cal.id)} onChange={() => toggleCalendar(cal.id)} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cal.summary}</span>
                    </label>
                  ))}
                </div>
              )}

              <button onClick={() => fetchGcalEvents(gcalToken, selectedCalendarIds)} style={{ background: "none", border: "none", color: "#e8a820", cursor: "pointer" }}>
                <RefreshCw size={14} className={gcalLoading ? "animate-spin" : ""} />
              </button>
            </div>
          ) : (
            <button onClick={handleConnect} style={{ background: "#e8a820", color: "#000", border: "none", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              CONNECT GOOGLE CALENDAR
            </button>
          )}
        </div>
      </div>
      <div className="stripe" />

      <div style={{ padding: "10px 20px", background: "#1e3629", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setSelectedDate(addDays(selectedDate, -1))} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}><ChevronLeft /></button>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#e8a820", minWidth: 150, textAlign: "center" }}>
          {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
        </div>
        <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}><ChevronRight /></button>
        <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])} style={{ marginLeft: 10, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>TODAY</button>
      </div>

      <div style={{ padding: 20, display: "grid", gridTemplateColumns: `repeat(${dates.length}, 1fr)`, gap: 20 }}>
        {dates.map(date => (
          <div key={date} style={{ background: "#1e3629", borderRadius: 8, padding: 15, border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 15 }}>{date === new Date().toISOString().split("T")[0] ? "TODAY" : ""}</div>
            
            <div style={{ display: "grid", gap: 10 }}>
              {gcalEvents.filter(e => (e.start.dateTime || e.start.date)?.startsWith(date)).map(event => {
                const start = event.start.dateTime ? new Date(event.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "ALL DAY";
                return (
                  <div key={event.id} className="sb-row" style={{ background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 4, borderLeft: "3px solid #4285f4" }}>
                    <div style={{ fontSize: 9, color: "#4285f4", fontWeight: 700, marginBottom: 4 }}>{start}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{event.summary}</div>
                  </div>
                );
              })}
              {gcalEvents.filter(e => (e.start.dateTime || e.start.date)?.startsWith(date)).length === 0 && (
                <div style={{ textAlign: "center", padding: 20, opacity: 0.2, fontSize: 12 }}>NO EVENTS</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
