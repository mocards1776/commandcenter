import { useState, useEffect, useCallback } from "react";
import { Calendar, Plus, Clock, X, ChevronLeft, ChevronRight, RefreshCw, Link, Check } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

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
}

interface GCalEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  colorId?: string;
  htmlLink?: string;
}

// ── Google OAuth config ────────────────────────────────────────────────
const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
const GCAL_DISCOVERY = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";

// Storage helpers
const GC_TOKEN_KEY = "gcal_access_token";
const GC_EXPIRY_KEY = "gcal_token_expiry";

function getStoredToken(): string | null {
  const token = localStorage.getItem(GC_TOKEN_KEY);
  const expiry = localStorage.getItem(GC_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry)) { localStorage.removeItem(GC_TOKEN_KEY); localStorage.removeItem(GC_EXPIRY_KEY); return null; }
  return token;
}

function gcalColorToHex(colorId?: string): string {
  const map: Record<string, string> = {
    "1": "#ac725e", "2": "#d06c00", "3": "#f6c026", "4": "#33b679",
    "5": "#0b8043", "6": "#039be5", "7": "#3f51b5", "8": "#7986cb",
    "9": "#8e24aa", "10": "#616161", "11": "#e67c73",
  };
  return colorId && map[colorId] ? map[colorId] : "#4285f4";
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function formatDayLabel(dateStr: string): { day: string; date: string; isToday: boolean } {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date().toISOString().split("T")[0];
  return {
    day: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    date: d.getDate().toString(),
    isToday: dateStr === today,
  };
}

// ── Time slot block ───────────────────────────────────────────────────
function TimeSlotBlock({ block, columnIndex, totalColumns }: { block: Block; columnIndex?: number; totalColumns?: number }) {
  const start = new Date(block.start_time);
  const end = new Date(block.end_time);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  const top = ((startMin - 5 * 60) / 60) * 64;
  const height = ((endMin - startMin) / 60) * 64;
  const cols = totalColumns ?? 1;
  const idx = columnIndex ?? 0;
  const widthPct = 100 / cols;
  const leftPct = idx * widthPct;

  return (
    <div
      className="absolute rounded overflow-hidden cursor-pointer hover:brightness-110 transition-all z-10"
      style={{
        top,
        height: Math.max(height, 22),
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: block.color + "28",
        borderLeft: `3px solid ${block.color}`,
        boxShadow: block.source === "google" ? `0 0 0 1px ${block.color}40` : undefined,
      }}
      title={`${block.title}${block.source === "google" ? " (Google)" : ""}`}
    >
      {block.source === "google" && (
        <div style={{ position: "absolute", top: 2, right: 3, opacity: 0.5 }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill={block.color}><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        </div>
      )}
      <p className="text-[10px] font-bold truncate px-1 pt-0.5" style={{ color: block.color }}>{block.title}</p>
      <p className="text-[9px] px-1 opacity-60" style={{ color: block.color }}>
        {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

// ── New block form ───────────────────────────────────────────────────
function NewBlockForm({ onClose, selectedDate }: { onClose: () => void; selectedDate: string }) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [color, setColor] = useState(BLOCK_COLORS[0]);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => axios.post("/api/time-blocks/", {
      title,
      start_time: `${selectedDate}T${startTime}:00`,
      end_time: `${selectedDate}T${endTime}:00`,
      color,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["time-blocks"] }); toast.success("Block added!"); onClose(); },
  });

  return (
    <div style={{ background: "#1e3629", border: "2px solid rgba(232,168,32,0.3)", padding: 14, marginBottom: 8 }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#e8a820" }}>New Block</span>
        <button onClick={onClose}><X className="w-4 h-4" style={{ color: "rgba(245,240,224,0.3)" }} /></button>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Block title…" autoFocus
        style={{ width: "100%", padding: "7px 10px", marginBottom: 8, fontSize: 14 }} />
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(232,168,32,0.5)", marginBottom: 4 }}>Start</div>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={{ width: "100%", padding: "6px 8px", fontSize: 13 }} />
        </div>
        <div className="flex-1">
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(232,168,32,0.5)", marginBottom: 4 }}>End</div>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={{ width: "100%", padding: "6px 8px", fontSize: 13 }} />
        </div>
      </div>
      <div className="flex gap-2 items-center mb-3">
        <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(245,240,224,0.3)" }}>Color:</span>
        {BLOCK_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)}
            className={cn("w-5 h-5 rounded-full transition-all", color === c && "ring-2 ring-white ring-offset-1 ring-offset-[#1e3629]")}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <button onClick={() => title.trim() && createMutation.mutate()} disabled={!title.trim() || createMutation.isPending}
        className="btn btn-gold w-full" style={{ justifyContent: "center", opacity: !title.trim() ? 0.4 : 1 }}>
        Create Block
      </button>
    </div>
  );
}

// ── Google Calendar connect panel ────────────────────────────────────
function GCalConnect({ onConnected }: { onConnected: (token: string) => void }) {
  const [clientId, setClientId] = useState(localStorage.getItem("gcal_client_id") ?? "");
  const [showInput, setShowInput] = useState(false);

  const handleConnect = useCallback(() => {
    if (!clientId.trim()) { setShowInput(true); return; }
    localStorage.setItem("gcal_client_id", clientId.trim());

    // Use Google Identity Services popup flow
    const params = new URLSearchParams({
      client_id: clientId.trim(),
      redirect_uri: window.location.origin + window.location.pathname,
      response_type: "token",
      scope: GCAL_SCOPES,
      include_granted_scopes: "true",
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    const popup = window.open(url, "gcal_auth", "width=500,height=600,left=200,top=100");

    const listener = (e: MessageEvent) => {
      if (e.data?.type === "gcal_token") {
        localStorage.setItem(GC_TOKEN_KEY, e.data.token);
        localStorage.setItem(GC_EXPIRY_KEY, String(Date.now() + e.data.expiresIn * 1000));
        onConnected(e.data.token);
        window.removeEventListener("message", listener);
      }
    };
    window.addEventListener("message", listener);

    // Poll for redirect
    const poll = setInterval(() => {
      try {
        if (!popup || popup.closed) { clearInterval(poll); return; }
        const hash = popup.location.hash;
        if (hash && hash.includes("access_token")) {
          const params = new URLSearchParams(hash.slice(1));
          const token = params.get("access_token");
          const expiresIn = parseInt(params.get("expires_in") ?? "3600");
          if (token) {
            localStorage.setItem(GC_TOKEN_KEY, token);
            localStorage.setItem(GC_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
            onConnected(token);
            popup.close();
          }
          clearInterval(poll);
        }
      } catch { /* cross-origin, keep polling */ }
    }, 500);

    setTimeout(() => clearInterval(poll), 120_000);
  }, [clientId, onConnected]);

  return (
    <div style={{ background: "rgba(66,133,244,0.08)", border: "1px solid rgba(66,133,244,0.25)", padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      {showInput ? (
        <>
          <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Paste Google OAuth Client ID…"
            style={{ flex: 1, minWidth: 200, padding: "5px 8px", fontSize: 11, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(66,133,244,0.4)" }} />
          <button onClick={handleConnect} className="btn" style={{ background: "#4285f4", color: "#fff", border: "none", fontSize: 10, padding: "5px 10px" }}>Connect</button>
          <button onClick={() => setShowInput(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(245,240,224,0.3)", fontSize: 10 }}>Cancel</button>
        </>
      ) : (
        <>
          <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, letterSpacing: "0.1em", color: "rgba(245,240,224,0.5)", flex: 1 }}>
            Sync your Google Calendar events
          </span>
          <button onClick={handleConnect} className="btn" style={{ background: "#4285f4", color: "#fff", border: "none", fontSize: 10, padding: "5px 12px", gap: 5 }}>
            <Link size={10} /> Connect Google Calendar
          </button>
        </>
      )}
    </div>
  );
}

// ── Day column ───────────────────────────────────────────────────────
function DayColumn({ date, blocks, showLabels }: { date: string; blocks: Block[]; showLabels: boolean }) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMin - 5 * 60) / 60) * 64;
  const isToday = date === new Date().toISOString().split("T")[0];
  const label = formatDayLabel(date);

  // Group overlapping blocks into columns
  const sorted = [...blocks].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const groups: Array<{ block: Block; col: number; total: number }> = [];
  const cols: number[] = [];

  for (const block of sorted) {
    const bs = new Date(block.start_time).getTime();
    const be = new Date(block.end_time).getTime();
    let assigned = -1;
    for (let c = 0; c < cols.length; c++) {
      if (cols[c] <= bs) { cols[c] = be; assigned = c; break; }
    }
    if (assigned === -1) { assigned = cols.length; cols.push(be); }
    groups.push({ block, col: assigned, total: 1 });
  }
  const maxCols = cols.length || 1;
  groups.forEach(g => g.total = maxCols);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Day header */}
      <div style={{ textAlign: "center", padding: "6px 4px", borderBottom: "2px solid #1e3629", background: isToday ? "rgba(232,168,32,0.1)" : "transparent", borderTop: isToday ? "2px solid #e8a820" : "2px solid transparent", flexShrink: 0 }}>
        <div style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: isToday ? "#e8a820" : "rgba(245,240,224,0.3)" }}>{label.day}</div>
        <div style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 20, fontWeight: 700, color: isToday ? "#e8a820" : "#f5f0e0", lineHeight: 1.1 }}>{label.date}</div>
      </div>

      {/* Blocks */}
      <div style={{ flex: 1, position: "relative" }}>
        {HOURS.map(h => (
          <div key={h} style={{ height: 64, borderBottom: "1px solid rgba(30,54,41,0.6)" }} />
        ))}
        {isToday && nowMin >= 300 && nowMin <= 1380 && (
          <div style={{ position: "absolute", left: 0, right: 0, top: nowTop, display: "flex", alignItems: "center", zIndex: 20 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d94040", flexShrink: 0, marginLeft: -3 }} />
            <div style={{ flex: 1, height: 1, background: "#d94040", opacity: 0.7 }} />
          </div>
        )}
        {groups.map(({ block, col, total }) => (
          <TimeSlotBlock key={block.id} block={block} columnIndex={col} totalColumns={total} />
        ))}
        {blocks.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <Clock size={14} style={{ color: "rgba(245,240,224,0.08)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Calendar Page ───────────────────────────────────────────────
export function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [showNew, setShowNew] = useState(false);
  const [gcalToken, setGcalToken] = useState<string | null>(getStoredToken);
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const qc = useQueryClient();

  const today = new Date().toISOString().split("T")[0];

  // Dates to show based on view
  const dates: string[] = viewMode === "day"
    ? [selectedDate]
    : [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];

  // Local blocks
  const { data: blocksRaw } = useQuery<Block[]>({
    queryKey: ["time-blocks-multi", selectedDate, viewMode],
    queryFn: async () => {
      const results = await Promise.all(
        dates.map(d => axios.get(`/api/time-blocks/?date=${d}`).then(r => r.data).catch(() => []))
      );
      return results.flat();
    },
  });

  // Fetch Google Calendar events
  const fetchGcalEvents = useCallback(async (token: string) => {
    if (!token) return;
    setGcalLoading(true);
    try {
      const start = new Date(dates[0] + "T00:00:00").toISOString();
      const end = new Date(addDays(dates[dates.length - 1], 1) + "T00:00:00").toISOString();
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        if (res.status === 401) { localStorage.removeItem(GC_TOKEN_KEY); localStorage.removeItem(GC_EXPIRY_KEY); setGcalToken(null); }
        throw new Error("GCal fetch failed");
      }
      const data = await res.json();
      setGcalEvents(data.items ?? []);
    } catch (e) {
      console.error("GCal error:", e);
    } finally {
      setGcalLoading(false);
    }
  }, [dates.join(",")]);

  useEffect(() => {
    if (gcalToken) fetchGcalEvents(gcalToken);
  }, [gcalToken, fetchGcalEvents]);

  // Merge local + google events into blocks per date
  const allBlocksByDate = (date: string): Block[] => {
    const local: Block[] = (blocksRaw ?? []).filter(b => b.start_time.startsWith(date)).map(b => ({ ...b, source: "local" as const }));
    const gcal: Block[] = gcalEvents
      .filter(e => {
        const dt = e.start.dateTime ?? e.start.date;
        return dt && dt.startsWith(date);
      })
      .map(e => ({
        id: `gcal_${e.id}`,
        title: e.summary ?? "(No title)",
        start_time: e.start.dateTime ?? `${date}T00:00:00`,
        end_time: e.end.dateTime ?? `${date}T01:00:00`,
        color: gcalColorToHex(e.colorId),
        source: "google" as const,
        gcal_event_id: e.id,
      }));
    return [...local, ...gcal];
  };

  const navigate = (dir: 1 | -1) => {
    setSelectedDate(prev => addDays(prev, dir * (viewMode === "3day" ? 3 : 1)));
  };

  const disconnectGcal = () => {
    localStorage.removeItem(GC_TOKEN_KEY);
    localStorage.removeItem(GC_EXPIRY_KEY);
    setGcalToken(null);
    setGcalEvents([]);
    toast.success("Google Calendar disconnected");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Top bar */}
      <div className="top-bar">
        <span style={{ fontSize: 18 }}>📅</span>
        <div className="top-title">Calendar</div>
        {gcalToken && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", marginRight: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "rgba(66,133,244,0.15)", border: "1px solid rgba(66,133,244,0.3)", borderRadius: 2 }}>
              <Check size={9} color="#4285f4" />
              <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#4285f4" }}>Google Synced</span>
            </div>
            <button onClick={() => gcalToken && fetchGcalEvents(gcalToken)} disabled={gcalLoading}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(245,240,224,0.3)", padding: 2 }}>
              <RefreshCw size={12} style={{ animation: gcalLoading ? "spin 1s linear infinite" : "none", color: "rgba(66,133,244,0.6)" }} />
            </button>
            <button onClick={disconnectGcal} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(245,240,224,0.2)", fontSize: 9, fontFamily: "'Oswald',Arial,sans-serif", letterSpacing: "0.1em", textTransform: "uppercase" }}>Disconnect</button>
          </div>
        )}
      </div>
      <div className="stripe" />

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#1e3629", borderBottom: "2px solid #162a1c", flexShrink: 0, flexWrap: "wrap" }}>
        {/* View toggle */}
        <div style={{ display: "flex", border: "1px solid rgba(232,168,32,0.2)", borderRadius: 2, overflow: "hidden" }}>
          {(["day", "3day"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              style={{ padding: "5px 12px", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", border: "none", background: viewMode === v ? "rgba(232,168,32,0.15)" : "transparent", color: viewMode === v ? "#e8a820" : "rgba(245,240,224,0.3)", transition: "all 0.1s" }}>
              {v === "day" ? "Day" : "3 Day"}
            </button>
          ))}
        </div>

        {/* Nav arrows */}
        <button onClick={() => navigate(-1)} className="btn" style={{ padding: "4px 8px", border: "1px solid rgba(232,168,32,0.2)" }}>
          <ChevronLeft size={14} />
        </button>
        <button onClick={() => navigate(1)} className="btn" style={{ padding: "4px 8px", border: "1px solid rgba(232,168,32,0.2)" }}>
          <ChevronRight size={14} />
        </button>
        <button onClick={() => setSelectedDate(today)} className="btn" style={{ border: "1px solid rgba(232,168,32,0.2)", fontSize: 10, padding: "4px 10px", color: selectedDate === today ? "#e8a820" : "rgba(245,240,224,0.4)" }}>
          Today
        </button>

        {/* Date display */}
        <div style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,240,224,0.5)" }}>
          {viewMode === "day"
            ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase()
            : `${new Date(dates[0] + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(dates[2] + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          }
        </div>

        {/* Add block */}
        <button onClick={() => setShowNew(!showNew)} className="btn btn-gold" style={{ marginLeft: "auto", gap: 5 }}>
          <Plus size={12} /> New Block
        </button>
      </div>

      {/* GCal connect / new form */}
      {(!gcalToken || showNew) && (
        <div style={{ padding: "8px 12px", background: "#2a4a3a", flexShrink: 0 }}>
          {!gcalToken && <GCalConnect onConnected={token => { setGcalToken(token); toast.success("Google Calendar connected!"); }} />}
          {showNew && <NewBlockForm onClose={() => setShowNew(false)} selectedDate={selectedDate} />}
        </div>
      )}

      {/* Calendar grid */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Hour labels */}
        <div style={{ width: 48, flexShrink: 0, borderRight: "2px solid #1e3629", overflowY: "auto" }}>
          <div style={{ height: 50, flexShrink: 0 }} /> {/* header spacer */}
          {HOURS.map(h => (
            <div key={h} style={{ height: 64, display: "flex", alignItems: "flex-start", paddingTop: 3, paddingLeft: 6 }}>
              <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 9, color: "rgba(245,240,224,0.25)", letterSpacing: "0.06em" }}>
                {h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`}
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div style={{ flex: 1, display: "flex", overflowY: "auto", overflowX: "hidden" }}>
          {dates.map(date => (
            <DayColumn
              key={date}
              date={date}
              blocks={allBlocksByDate(date)}
              showLabels={viewMode !== "day"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
