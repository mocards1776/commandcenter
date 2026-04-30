import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import {
  Calendar as CalendarIcon,
  List,
  Maximize2,
  Minimize2,
  LogIn,
  LogOut,
  X,
  MapPin,
  Clock,
  AlignLeft,
  EyeOff,
  Eye,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import { tasksApi } from "@/lib/api";
import { toast } from "react-hot-toast";
import type { Task, TimeBlock } from "@/types";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);
const BLOCK_COLORS = [
  "#4285f4","#0f9d58","#f4b400","#db4437",
  "#ab47bc","#00acc1","#ff7043","#e8a820",
  "#6366f1","#f43f5e",
];

type ViewMode = "day" | "2day" | "3day";

interface GoogleCalendar { id: string; summary: string; backgroundColor?: string; }
interface GCalEvent {
  id: string; summary: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  description?: string;
  location?: string;
  calendar_id: string;
}

const GC_TOKEN_KEY          = "gcal_access_token";
const GC_EXPIRY_KEY         = "gcal_token_expiry";
const GC_SELECTED_CALS_KEY  = "gcal_selected_calendar_ids";
const GC_EVENT_COLORS_KEY   = "gcal_event_color_overrides";
const CAL_ZOOM_KEY          = "cal_zoom_level";
const CAL_HIDDEN_TASKS_KEY  = "cal_hidden_task_ids";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GCAL_SCOPE       = "https://www.googleapis.com/auth/calendar.readonly";

// ── localStorage helpers ──────────────────────────────────────────────────────
function getStoredToken(): string | null {
  try {
    const token  = localStorage.getItem(GC_TOKEN_KEY);
    const expiry = localStorage.getItem(GC_EXPIRY_KEY);
    if (!token || !expiry || Date.now() > parseInt(expiry)) return null;
    return token;
  } catch { return null; }
}
function storeToken(token: string, expiresIn: number) {
  try {
    localStorage.setItem(GC_TOKEN_KEY, token);
    localStorage.setItem(GC_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
  } catch (e) { console.error("localStorage unavailable", e); }
}
function clearToken() {
  try { localStorage.removeItem(GC_TOKEN_KEY); localStorage.removeItem(GC_EXPIRY_KEY); } catch { /* */ }
}
function getEventColorOverrides(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(GC_EVENT_COLORS_KEY) || "{}"); } catch { return {}; }
}
function saveEventColorOverride(eventId: string, color: string) {
  try {
    const o = getEventColorOverrides(); o[eventId] = color;
    localStorage.setItem(GC_EVENT_COLORS_KEY, JSON.stringify(o));
  } catch { /* */ }
}
function getSavedZoom(): number {
  try { return parseInt(localStorage.getItem(CAL_ZOOM_KEY) || "80", 10) || 80; } catch { return 80; }
}
function getHiddenTaskIds(): string[] {
  try { return JSON.parse(localStorage.getItem(CAL_HIDDEN_TASKS_KEY) || "[]"); } catch { return []; }
}
function saveHiddenTaskIds(ids: string[]) {
  try { localStorage.setItem(CAL_HIDDEN_TASKS_KEY, JSON.stringify(ids)); } catch { /* */ }
}

function connectGoogleCalendar() {
  if (!GOOGLE_CLIENT_ID) {
    alert("VITE_GOOGLE_CLIENT_ID is not set. Add it to your Vercel environment variables.");
    return;
  }
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri,
    response_type: "token", scope: GCAL_SCOPE,
    include_granted_scopes: "true", prompt: "consent",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ── Greedy column-packing ─────────────────────────────────────────────────────
interface Slottable { startMin: number; endMin: number; }
function computeLayout<T extends Slottable>(items: T[]): (T & { col: number; totalCols: number })[] {
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

// ── Color picker ──────────────────────────────────────────────────────────────
function ColorPicker({ current, onPick, onClose }: {
  current: string; onPick: (c: string) => void; onClose: () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
        background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 8, padding: "8px 10px", display: "flex", gap: 6,
        flexWrap: "wrap", width: 164, boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ width: "100%", fontSize: 9, color: "rgba(255,255,255,0.35)",
        letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2 }}>Change Color</div>
      {BLOCK_COLORS.map((c) => (
        <button key={c} onClick={() => { onPick(c); onClose(); }}
          style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: c,
            border: current === c ? "2px solid #fff" : "2px solid transparent",
            cursor: "pointer", padding: 0 }} />
      ))}
    </div>
  );
}

// ── Event detail modal ────────────────────────────────────────────────────────
interface EventModalProps {
  event: GCalEvent; calColor: string; currentColor: string;
  onColorChange: (color: string) => void; onClose: () => void;
}
function EventModal({ event, calColor, currentColor, onColorChange, onClose }: EventModalProps) {
  const isAllDay = !event.start.dateTime;
  const startDt  = event.start.dateTime ? new Date(event.start.dateTime) : null;
  const endDt    = event.end.dateTime   ? new Date(event.end.dateTime)   : null;
  const color    = currentColor || calColor;
  const fmt      = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDate  = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric" });
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#1e3629", border: `1px solid ${color}44`,
          borderTop: `3px solid ${color}`, borderRadius: 10, padding: "20px 24px",
          width: 360, maxWidth: "90vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 10, right: 10,
          background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4 }}>
          <X size={14} />
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: color,
            marginTop: 3, flexShrink: 0 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1.3, flex: 1 }}>
            {event.summary || "(No title)"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
          fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
          <Clock size={12} style={{ flexShrink: 0, color }} />
          {isAllDay
            ? <span>All day · {fmtDate(event.start.date!)}</span>
            : <span>{startDt && fmt(startDt)} – {endDt && fmt(endDt)}</span>}
        </div>
        {event.location && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8,
            fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            <MapPin size={12} style={{ flexShrink: 0, marginTop: 2, color }} />
            <span>{event.location}</span>
          </div>
        )}
        {event.description && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10,
            fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            <AlignLeft size={12} style={{ flexShrink: 0, marginTop: 2, color }} />
            <span style={{ maxHeight: 80, overflowY: "auto" }}
              dangerouslySetInnerHTML={{ __html: event.description.replace(/<[^>]*>/g, "") }} />
          </div>
        )}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 9, opacity: 0.35, letterSpacing: "0.12em",
            textTransform: "uppercase", marginBottom: 6 }}>Override Color</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BLOCK_COLORS.map((c) => (
              <button key={c} onClick={() => onColorChange(c)}
                style={{ width: 20, height: 20, borderRadius: "50%", backgroundColor: c,
                  border: color === c ? "2px solid #fff" : "2px solid transparent",
                  cursor: "pointer", padding: 0 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Right-click context menu ──────────────────────────────────────────────────
interface CtxMenu { x: number; y: number; taskId: string; }
function TaskContextMenu({ menu, onHide, onClose }: {
  menu: CtxMenu; onHide: (id: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return (
    <div ref={ref}
      style={{
        position: "fixed", top: menu.y, left: menu.x, zIndex: 2000,
        background: "#1e3629", border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6, padding: "4px 0", minWidth: 160,
        boxShadow: "0 8px 28px rgba(0,0,0,0.6)",
      }}
    >
      <button
        onClick={() => { onHide(menu.taskId); onClose(); }}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "7px 14px", background: "none", border: "none",
          color: "rgba(255,255,255,0.75)", fontSize: 12, cursor: "pointer", textAlign: "left",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        <EyeOff size={13} /> Hide from Backlog
      </button>
    </div>
  );
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function EventTooltip({ text, color }: { text: string; color: string }) {
  return (
    <div style={{
      position: "absolute", bottom: "calc(100% + 4px)", left: 0,
      background: "#0d1f14", border: `1px solid ${color}55`,
      borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 600,
      color: "#fff", whiteSpace: "nowrap", zIndex: 300,
      pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.7)",
      maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
    }}>
      {text}
    </div>
  );
}

// ── Single day column ─────────────────────────────────────────────────────────
function DayColumn({
  date, zoom, gcalEvents, localBlocks, calColors, eventColorOverrides,
  onLocalColorChange, onDrop, onEventClick,
}: {
  date: string; zoom: number; gcalEvents: GCalEvent[]; localBlocks: TimeBlock[];
  calColors: Record<string, string>; eventColorOverrides: Record<string, string>;
  onLocalColorChange: (id: string, color: string) => void;
  onDrop: (e: React.DragEvent, date: string, hour: number) => void;
  onEventClick: (ev: GCalEvent) => void;
}) {
  const [pickerBlockId, setPickerBlockId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const START_HOUR = 5;

  const gcalForDay = useMemo(() =>
    gcalEvents
      .filter((e) => e.start.dateTime && e.start.dateTime.startsWith(date))
      .map((e) => {
        const s = new Date(e.start.dateTime!);
        const en = new Date(e.end.dateTime || e.end.date + "T23:59:59");
        return { ...e, startMin: s.getHours() * 60 + s.getMinutes(),
          endMin: en.getHours() * 60 + en.getMinutes() };
      })
  , [gcalEvents, date]);

  const localForDay = useMemo(() =>
    localBlocks
      .filter((b) => (b.start_time || "").startsWith(date))
      .map((b) => {
        const s = new Date(b.start_time); const en = new Date(b.end_time);
        return { ...b, startMin: s.getHours() * 60 + s.getMinutes(),
          endMin: en.getHours() * 60 + en.getMinutes() };
      })
  , [localBlocks, date]);

  const gcalLayout  = computeLayout(gcalForDay);
  const localLayout = computeLayout(localForDay);
  const totalH      = HOURS.length * zoom;

  return (
    <div style={{ flex: 1, borderLeft: "1px solid rgba(255,255,255,0.03)",
      position: "relative", height: totalH }}
      onDragOver={(e) => e.preventDefault()}>
      {HOURS.map((h) => (
        <div key={h} onDrop={(e) => onDrop(e, date, h)} onDragOver={(e) => e.preventDefault()}
          style={{ height: zoom, borderTop: "1px solid rgba(255,255,255,0.03)" }} />
      ))}

      {gcalLayout.map((ev) => {
        const rawH   = ((ev.endMin - ev.startMin) / 60) * zoom;
        const top    = ((ev.startMin - START_HOUR * 60) / 60) * zoom;
        // Min height 30px — keeps ultra-short events readable and clickable
        const height = Math.max(rawH, 30);
        // Compact single-line layout for events under ~48min rendered height
        const isShort = rawH < 48;
        const wPct   = 100 / ev.totalCols; const lPct = ev.col * wPct;
        const calColor = calColors[ev.calendar_id] || "#4285f4";
        const color    = eventColorOverrides[ev.id] || calColor;
        const start  = new Date(ev.start.dateTime!);
        const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const isHovered = hoveredEventId === ev.id;

        return (
          <div key={ev.id}
            onClick={() => onEventClick(ev)}
            onMouseEnter={() => setHoveredEventId(ev.id)}
            onMouseLeave={() => setHoveredEventId(null)}
            style={{
              position: "absolute", top, height,
              left: `calc(${lPct}% + 2px)`, width: `calc(${wPct}% - 4px)`,
              background: color + (isHovered ? "38" : "2c"),
              borderLeft: `3px solid ${color}`,
              borderRadius: "0 4px 4px 0",
              padding: isShort ? "1px 5px" : "3px 5px",
              overflow: "visible",
              zIndex: isHovered ? 40 : 10,
              cursor: "pointer",
              transition: "background 0.1s",
              display: "flex",
              alignItems: isShort ? "center" : "flex-start",
              flexDirection: isShort ? "row" : "column",
              gap: isShort ? 4 : 1,
            }}
          >
            {isShort ? (
              <>
                <span style={{ fontSize: 10, color, fontWeight: 700, flexShrink: 0, lineHeight: 1.1, whiteSpace: "nowrap" }}>
                  {timeStr}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#fff", lineHeight: 1.1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>
                  {ev.summary}
                </span>
                {isHovered && ev.summary && (
                  <EventTooltip text={`${timeStr} · ${ev.summary}`} color={color} />
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 10, color, fontWeight: 700, lineHeight: 1.3, whiteSpace: "nowrap" }}>
                  {timeStr}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#fff", lineHeight: 1.25,
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: Math.max(1, Math.floor((height - 20) / 14)),
                  WebkitBoxOrient: "vertical",
                }}>
                  {ev.summary}
                </div>
              </>
            )}
          </div>
        );
      })}

      {localLayout.map((block) => {
        const rawH   = ((block.endMin - block.startMin) / 60) * zoom;
        const top    = ((block.startMin - START_HOUR * 60) / 60) * zoom;
        const height = Math.max(rawH, 30);
        const isShort = rawH < 48;
        const wPct   = 100 / block.totalCols; const lPct = block.col * wPct;
        const color  = block.color || "#e8a820";
        const isHov  = hoveredEventId === block.id;
        return (
          <div key={block.id}
            onClick={() => setPickerBlockId(pickerBlockId === block.id ? null : block.id)}
            onMouseEnter={() => setHoveredEventId(block.id)}
            onMouseLeave={() => setHoveredEventId(null)}
            style={{
              position: "absolute", top, height,
              left: `calc(${lPct}% + 2px)`, width: `calc(${wPct}% - 4px)`,
              background: color + "2c",
              borderLeft: `3px solid ${color}`,
              borderRadius: "0 4px 4px 0",
              padding: isShort ? "1px 5px" : "3px 5px",
              overflow: "visible",
              cursor: "pointer",
              zIndex: pickerBlockId === block.id ? 50 : isHov ? 40 : 20,
              display: "flex", alignItems: isShort ? "center" : "flex-start",
              flexDirection: isShort ? "row" : "column",
            }}
          >
            {isShort ? (
              <>
                <span style={{
                  fontSize: 11, fontWeight: 700, color, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis", flex: 1,
                }}>
                  {block.title}
                </span>
                {isHov && block.title && <EventTooltip text={block.title} color={color} />}
              </>
            ) : (
              <div style={{
                fontSize: 11, fontWeight: 700, color, lineHeight: 1.25,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: Math.max(1, Math.floor((height - 8) / 14)),
                WebkitBoxOrient: "vertical",
              }}>
                {block.title}
              </div>
            )}
            {pickerBlockId === block.id && (
              <ColorPicker current={color}
                onPick={(c) => onLocalColorChange(block.id, c)}
                onClose={() => setPickerBlockId(null)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── All-day strip ─────────────────────────────────────────────────────────────
function AllDayStrip({ date, gcalEvents, calColors, eventColorOverrides, onEventClick }: {
  date: string; gcalEvents: GCalEvent[]; calColors: Record<string, string>;
  eventColorOverrides: Record<string, string>; onEventClick: (ev: GCalEvent) => void;
}) {
  const allDay = gcalEvents.filter((e) => {
    if (e.start.dateTime) return false;
    return date >= (e.start.date || "") && date < (e.end.date || e.start.date || "");
  });
  if (!allDay.length) return <div style={{ height: 4 }} />;
  return (
    <div style={{ padding: "2px 4px", display: "flex", flexDirection: "column",
      gap: 2, borderLeft: "1px solid rgba(255,255,255,0.03)" }}>
      {allDay.map((ev) => {
        const calColor = calColors[ev.calendar_id] || "#4285f4";
        const color    = eventColorOverrides[ev.id] || calColor;
        return (
          <div key={ev.id} onClick={() => onEventClick(ev)} title={ev.summary}
            style={{ background: color + "22", borderLeft: `2px solid ${color}`,
              borderRadius: "0 3px 3px 0", padding: "1px 5px", fontSize: 9,
              fontWeight: 600, color, whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", cursor: "pointer", lineHeight: "14px" }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.3)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "")}>
            {ev.summary}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function CalendarPage() {
  const [viewMode, setViewMode]         = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [gcalToken, setGcalToken]       = useState<string | null>(getStoredToken());
  const [calendars, setCalendars]       = useState<GoogleCalendar[]>([]);
  const [calColors, setCalColors]       = useState<Record<string, string>>({});
  const [zoom, setZoom]                 = useState<number>(getSavedZoom);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(() => {
    try { const s = localStorage.getItem(GC_SELECTED_CALS_KEY); return s ? JSON.parse(s) : ["primary"]; }
    catch { return ["primary"]; }
  });
  const [gcalEvents, setGcalEvents]     = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading]   = useState(false);
  const [showCalendarList, setShowCalendarList] = useState(false);
  const [eventModal, setEventModal]     = useState<GCalEvent | null>(null);
  const [eventColorOverrides, setEventColorOverrides] = useState<Record<string, string>>(getEventColorOverrides);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>(getHiddenTaskIds);
  const [showHidden, setShowHidden]       = useState(false);
  const [ctxMenu, setCtxMenu]             = useState<CtxMenu | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);

  const qc = useQueryClient();

  const dates: string[] = useMemo(() => {
    if (viewMode === "day")  return [selectedDate];
    if (viewMode === "2day") return [selectedDate, addDays(selectedDate, 1)];
    return [selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)];
  }, [selectedDate, viewMode]);

  // ── Date navigation helpers ────────────────────────────────────────────────
  const navDays = viewMode === "3day" ? 3 : viewMode === "2day" ? 2 : 1;
  const goBack  = () => setSelectedDate((d) => addDays(d, -navDays));
  const goFwd   = () => setSelectedDate((d) => addDays(d,  navDays));
  const goToday = () => setSelectedDate(new Date().toISOString().split("T")[0]);

  // Persist zoom
  useEffect(() => {
    try { localStorage.setItem(CAL_ZOOM_KEY, String(zoom)); } catch { /* */ }
  }, [zoom]);

  // Handle OAuth redirect
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params    = new URLSearchParams(hash.slice(1));
      const token     = params.get("access_token");
      const expiresIn = parseInt(params.get("expires_in") || "3600", 10);
      const errorMsg  = params.get("error");
      if (errorMsg) toast.error(`Google auth error: ${errorMsg}`);
      else if (token) { storeToken(token, expiresIn); setGcalToken(token); toast.success("Google Calendar connected!"); }
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(GC_SELECTED_CALS_KEY, JSON.stringify(selectedCalendarIds)); } catch { /* */ }
  }, [selectedCalendarIds]);

  // ── Auto-scroll to current time on first render ───────────────────────────
  // useLayoutEffect + rAF ensures the grid has painted and clientHeight is valid
  useLayoutEffect(() => {
    if (didAutoScroll.current) return;
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const now    = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const nowTop = ((nowMin - 5 * 60) / 60) * zoom;
      // Position the red "now" bar ~1/3 down from the top of the viewport
      const offset = Math.max(0, nowTop - el.clientHeight / 3);
      el.scrollTop = offset;
      didAutoScroll.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [zoom]);

  const fetchCalendars = useCallback(async (token: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList",
        { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 401) { clearToken(); setGcalToken(null); toast.error("Google Calendar session expired."); }
        return;
      }
      const data = await res.json();
      const items: GoogleCalendar[] = data.items ?? [];
      setCalendars(items);
      const map: Record<string, string> = {};
      items.forEach((cal) => { if (cal.backgroundColor) map[cal.id] = cal.backgroundColor; });
      setCalColors(map);
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
            if (res.status === 401) { clearToken(); setGcalToken(null); toast.error("Session expired."); }
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
    if (gcalToken) { fetchCalendars(gcalToken); fetchGcalEvents(gcalToken, selectedCalendarIds); }
  }, [gcalToken, selectedCalendarIds, fetchGcalEvents, fetchCalendars]);

  const handleDisconnect = () => {
    clearToken(); setGcalToken(null); setCalendars([]); setGcalEvents([]);
    toast.success("Google Calendar disconnected.");
  };

  const handleEventColorChange = (eventId: string, color: string) => {
    saveEventColorOverride(eventId, color);
    setEventColorOverrides((prev) => ({ ...prev, [eventId]: color }));
  };

  // ── Task hide / unhide helpers ─────────────────────────────────────────────
  const hideTask = (taskId: string) => {
    setHiddenTaskIds((prev) => {
      const next = [...prev, String(taskId)];
      saveHiddenTaskIds(next);
      return next;
    });
    toast("Task hidden from backlog", { icon: "👁" });
  };
  const unhideAll = () => {
    setHiddenTaskIds([]);
    saveHiddenTaskIds([]);
    setShowHidden(false);
    toast.success("All tasks restored");
  };
  const unhideOne = (taskId: string) => {
    setHiddenTaskIds((prev) => {
      const next = prev.filter((id) => id !== String(taskId));
      saveHiddenTaskIds(next);
      return next;
    });
  };

  // ── Backlog ────────────────────────────────────────────────────────────────
  // Use tasksApi (shared instance) so the correct backend baseURL is always used.
  // Raw axios.get with apiBase="" would hit the Vercel domain instead of DigitalOcean.
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const {
    data: tasks = [],
    isLoading: tasksLoading,
    isError: tasksError,
  } = useQuery<Task[]>({
    queryKey: ["tasks-backlog-calendar"],
    queryFn: async () => {
      const raw = await tasksApi.list({ limit: 200 });
      return Array.isArray(raw) ? raw : ((raw as any).results ?? []);
    },
    retry: 2,
    refetchInterval: 60_000,
  });

  // Normalise IDs to strings for comparison; show all non-terminal statuses
  const DONE_STATUSES = new Set(["done", "cancelled", "complete", "completed"]);
  const allActiveTasks = tasks.filter((t) => !DONE_STATUSES.has(String(t.status).toLowerCase()));
  const backlogTasks   = allActiveTasks.filter((t) => !hiddenTaskIds.includes(String(t.id)));
  const hiddenTasks    = allActiveTasks.filter((t) =>  hiddenTaskIds.includes(String(t.id)));

  // ── Local time blocks ─────────────────────────────────────────────────────
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["time-blocks"] }); toast.success("Color updated"); },
    onError:   () => toast.error("Failed to update color"),
  });

  const onDragStart = (e: React.DragEvent, taskId: string) => e.dataTransfer.setData("taskId", taskId);

  const onDrop = async (e: React.DragEvent, date: string, hour: number) => {
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;
    const task = tasks.find((t) => String(t.id) === taskId);
    try {
      await axios.post(`${apiBase}/api/time-blocks/`, {
        title: task?.title || "Scheduled Task", date,
        start_time: `${date}T${String(hour).padStart(2, "0")}:00:00`,
        end_time:   `${date}T${String(hour + 1).padStart(2, "0")}:00:00`,
        task_id: taskId, color: "#e8a820",
      });
      qc.invalidateQueries({ queryKey: ["time-blocks"] });
      toast.success("Task scheduled");
    } catch { toast.error("Failed to schedule task"); }
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];
  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const nowTop  = ((nowMin - 5 * 60) / 60) * zoom;

  const hasAllDayEvents = dates.some((d) =>
    gcalEvents.some((e) => !e.start.dateTime && d >= (e.start.date || "") && d < (e.end.date || e.start.date || ""))
  );

  // ── Formatted date range label ─────────────────────────────────────────────
  const dateLabel = useMemo(() => {
    const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US",
      { weekday: "short", month: "short", day: "numeric" });
    if (viewMode === "day") return fmt(selectedDate);
    return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
  }, [dates, selectedDate, viewMode]);

  return (
    <div className="sb-shell" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#162a1c" }}
      onClick={() => setCtxMenu(null)}>

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

          {/* ── Date navigation ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 16 }}>
            <button onClick={goBack}
              style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff",
                padding: "4px 6px", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <ChevronLeft size={13} />
            </button>
            <button onClick={goToday}
              title="Jump to today"
              style={{
                background: isToday ? "#e8a820" : "rgba(255,255,255,0.08)",
                border: "none",
                color: isToday ? "#000" : "rgba(255,255,255,0.7)",
                padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", minWidth: 130, textAlign: "center",
              }}>
              {dateLabel}
            </button>
            <button onClick={goFwd}
              style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff",
                padding: "4px 6px", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Zoom controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setZoom((z) => Math.max(40, z - 20))}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff",
                padding: 5, borderRadius: 4, cursor: "pointer" }}>
              <Minimize2 size={12} />
            </button>
            <span style={{ fontSize: 9, opacity: 0.4, minWidth: 28, textAlign: "center" }}>{zoom}px</span>
            <button onClick={() => setZoom((z) => Math.min(160, z + 20))}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff",
                padding: 5, borderRadius: 4, cursor: "pointer" }}>
              <Maximize2 size={12} />
            </button>
          </div>

          {!gcalToken ? (
            <button onClick={connectGoogleCalendar}
              title={!GOOGLE_CLIENT_ID ? "VITE_GOOGLE_CLIENT_ID not set" : "Connect Google Calendar"}
              style={{ background: GOOGLE_CLIENT_ID ? "#4285f4" : "rgba(255,255,255,0.1)",
                border: "none", color: "#fff", padding: "4px 10px", borderRadius: 4,
                fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                opacity: GOOGLE_CLIENT_ID ? 1 : 0.5 }}>
              <LogIn size={12} /> CONNECT GCAL
            </button>
          ) : (
            <>
              {gcalLoading && <span style={{ fontSize: 9, opacity: 0.4, color: "#4285f4" }}>loading…</span>}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowCalendarList(!showCalendarList)}
                  style={{ background: "#1e3629", border: "1px solid #4285f4", color: "#4285f4",
                    padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 4 }}>
                  <List size={12} /> {selectedCalendarIds.length} CALS
                </button>
                {showCalendarList && (
                  <div style={{ position: "absolute", top: 35, right: 0, background: "#1e3629",
                    border: "1px solid #4285f4", zIndex: 100, width: 240, padding: 8, borderRadius: 4 }}>
                    {calendars.length === 0 && (
                      <div style={{ fontSize: 10, opacity: 0.5, padding: "4px 0" }}>No calendars found</div>
                    )}
                    {calendars.map((cal) => {
                      const color = calColors[cal.id] || "#4285f4";
                      return (
                        <label key={cal.id} style={{ display: "flex", alignItems: "center",
                          gap: 8, padding: "5px 0", fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={selectedCalendarIds.includes(cal.id)}
                            onChange={() =>
                              setSelectedCalendarIds((prev) =>
                                prev.includes(cal.id) ? prev.filter((x) => x !== cal.id) : [...prev, cal.id]
                              )} />
                          <span style={{ width: 10, height: 10, borderRadius: "50%",
                            backgroundColor: color, flexShrink: 0, display: "inline-block" }} />
                          <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                            {cal.summary}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={handleDisconnect} title="Disconnect Google Calendar"
                style={{ background: "rgba(255,255,255,0.08)", border: "none",
                  color: "rgba(255,255,255,0.5)", padding: "4px 8px", borderRadius: 4,
                  fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <div style={{ fontSize: 9, opacity: 0.5, letterSpacing: "0.1em" }}>BACKLOG</div>
            {tasksLoading && <span style={{ fontSize: 8, opacity: 0.35, color: "#e8a820" }}>loading…</span>}
            {!tasksLoading && !tasksError && (
              <span style={{ fontSize: 8, opacity: 0.3 }}>{backlogTasks.length} task{backlogTasks.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div style={{ fontSize: 9, opacity: 0.3, marginBottom: 12 }}>Drag → schedule · Right-click → hide</div>

          {tasksError && (
            <div style={{ fontSize: 10, color: "#f43f5e", opacity: 0.7, background: "rgba(244,63,94,0.08)",
              borderRadius: 4, padding: "6px 8px", marginBottom: 8, lineHeight: 1.4 }}>
              ⚠ Could not load tasks.<br />
              <span style={{ opacity: 0.6 }}>Check API connection.</span>
            </div>
          )}

          {!tasksLoading && !tasksError && backlogTasks.length === 0 && hiddenTasks.length === 0 && (
            <div style={{ fontSize: 10, opacity: 0.25, fontStyle: "italic", textAlign: "center", marginTop: 20 }}>
              All clear
            </div>
          )}

          {backlogTasks.map((task) => (
            <div key={task.id} draggable
              onDragStart={(e) => onDragStart(e, String(task.id))}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, taskId: String(task.id) });
              }}
              style={{ background: "rgba(0,0,0,0.2)", padding: "8px 10px", borderRadius: 4,
                marginBottom: 7, fontSize: 11, borderLeft: "3px solid #e8a820",
                cursor: "grab", lineHeight: 1.3, userSelect: "none" }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{task.title}</div>
              <div style={{ fontSize: 9, opacity: 0.45, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {task.status === "today" ? "📌 Today"
                  : task.status === "in_progress" ? "⚡ Active"
                  : task.status === "inbox" ? "📥 Inbox"
                  : task.status}
              </div>
            </div>
          ))}

          {/* ── Hidden tasks footer ── */}
          {hiddenTasks.length > 0 && (
            <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={() => setShowHidden((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none",
                  border: "none", color: "rgba(255,255,255,0.35)", fontSize: 10,
                  cursor: "pointer", padding: 0, width: "100%" }}>
                {showHidden ? <EyeOff size={11} /> : <Eye size={11} />}
                {hiddenTasks.length} hidden task{hiddenTasks.length > 1 ? "s" : ""}
              </button>

              {showHidden && (
                <div style={{ marginTop: 8 }}>
                  {hiddenTasks.map((task) => (
                    <div key={task.id}
                      style={{ display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 6px", marginBottom: 4,
                        background: "rgba(0,0,0,0.15)", borderRadius: 4,
                        borderLeft: "3px solid rgba(255,255,255,0.1)" }}>
                      <span style={{ flex: 1, fontSize: 10, opacity: 0.4,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.title}
                      </span>
                      <button onClick={() => unhideOne(String(task.id))}
                        title="Restore"
                        style={{ background: "none", border: "none",
                          color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                        <Eye size={11} />
                      </button>
                    </div>
                  ))}
                  <button onClick={unhideAll}
                    style={{ width: "100%", marginTop: 4, padding: "4px 0",
                      background: "rgba(255,255,255,0.05)", border: "none",
                      color: "rgba(255,255,255,0.35)", fontSize: 9, cursor: "pointer",
                      borderRadius: 4, letterSpacing: "0.08em" }}>
                    RESTORE ALL
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Calendar grid ── */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", background: "#162a1c" }}>
          {/* Sticky date header */}
          <div style={{ background: "#1e3629", position: "sticky", top: 0, zIndex: 50,
            borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex" }}>
              <div style={{ width: 60 }} />
              {dates.map((d) => (
                <div key={d} style={{ flex: 1, padding: "10px 10px 4px", textAlign: "center",
                  borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700,
                    color: d === new Date().toISOString().split("T")[0] ? "#e8a820" : "rgba(255,255,255,0.6)" }}>
                    {new Date(d + "T12:00:00").toLocaleDateString("en-US",
                      { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
            {gcalToken && (
              <div style={{ display: "flex", minHeight: 6 }}>
                <div style={{ width: 60, display: "flex", alignItems: "center",
                  justifyContent: "flex-end", paddingRight: 6 }}>
                  {hasAllDayEvents && (
                    <span style={{ fontSize: 7, opacity: 0.3, letterSpacing: "0.08em" }}>ALL DAY</span>
                  )}
                </div>
                {dates.map((d) => (
                  <AllDayStrip key={d} date={d} gcalEvents={gcalEvents}
                    calColors={calColors} eventColorOverrides={eventColorOverrides}
                    onEventClick={setEventModal} />
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", position: "relative" }}>
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
            {dates.map((date) => (
              <DayColumn key={date} date={date} zoom={zoom}
                gcalEvents={gcalEvents} localBlocks={localBlocks}
                calColors={calColors} eventColorOverrides={eventColorOverrides}
                onLocalColorChange={(id, color) => colorMutation.mutate({ id, color })}
                onDrop={onDrop} onEventClick={setEventModal} />
            ))}
            {isToday && nowMin >= 5 * 60 && nowMin <= 23 * 60 && (
              <div style={{ position: "absolute", top: nowTop, left: 60, right: 0,
                height: 2, background: "#f43f5e", zIndex: 30, pointerEvents: "none", opacity: 0.85 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%",
                  background: "#f43f5e", marginTop: -3, marginLeft: -4 }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Event detail modal ── */}
      {eventModal && (
        <EventModal event={eventModal}
          calColor={calColors[eventModal.calendar_id] || "#4285f4"}
          currentColor={eventColorOverrides[eventModal.id] || ""}
          onColorChange={(color) => handleEventColorChange(eventModal.id, color)}
          onClose={() => setEventModal(null)} />
      )}

      {/* ── Right-click context menu ── */}
      {ctxMenu && (
        <TaskContextMenu menu={ctxMenu}
          onHide={hideTask}
          onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}
