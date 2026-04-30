/**
 * Natural-language task parser – zero external dependencies.
 *
 * Handles:
 *   "Message Dr. Morgan at 830am"
 *   "Finish report tomorrow 2pm"
 *   "Call mom next Friday 10am"
 *   "Gym in 45 minutes"
 *   "Team standup monday morning"
 *   "Doctor tuesday noon"
 *   "Submit invoice eod"
 *   "Review PR in 2 hours"
 *   "Deploy next week"
 *   "Dentist jan 15 at 3pm"
 */

export interface NLPResult {
  /** Title with all date/time tokens removed and cleaned up */
  cleanTitle: string;
  /** ISO date string "YYYY-MM-DD" or null */
  dueDate: string | null;
  /** "HH:MM" 24-hour or null */
  dueTime: string | null;
  /** Human-readable label: "Today 8:30 AM", "Tomorrow", "Next Friday 2:00 PM" */
  humanLabel: string | null;
  /** Detected estimate in minutes (from "in 45 minutes") or null */
  estimateMinutes: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const MONTHS = ["january","february","march","april","may","june",
               "july","august","september","october","november","december"];
const MONTH_SHORT = ["jan","feb","mar","apr","may","jun",
                     "jul","aug","sep","oct","nov","dec"];

// ─── Date helpers ──────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Returns the ISO date of the next occurrence of dayIdx (0=Sun…6=Sat).
 *  If today is that day, returns next week's occurrence. */
function nextWeekday(dayIdx: number, allowToday = false): string {
  const now = new Date();
  let diff = dayIdx - now.getDay();
  if (diff < 0 || (!allowToday && diff === 0)) diff += 7;
  if (diff === 0 && allowToday) diff = 0;
  return addDays(diff);
}

/** Returns the ISO date of the "this" weekday (upcoming, possibly today). */
function thisWeekday(dayIdx: number): string {
  return nextWeekday(dayIdx, true);
}

// ─── Time helpers ──────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function toHHMM(h: number, m: number): string {
  return `${pad2(h)}:${pad2(m)}`;
}

function fmtTime(h: number, m: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${pad2(m)} ${ampm}`;
}

function fmtDate(iso: string): string {
  const todayISO = toISO(new Date());
  const tomISO   = addDays(1);
  if (iso === todayISO) return "Today";
  if (iso === tomISO)   return "Tomorrow";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Parse a raw time string (without surrounding context) to {h, m} or null.
 *  Handles: "8am" "8:30am" "830am" "1430" "14:30" "noon" "midnight" */
function parseRawTime(raw: string): { h: number; m: number } | null {
  const s = raw.toLowerCase().trim().replace(/\s+/g, "");

  if (s === "noon")      return { h: 12, m: 0 };
  if (s === "midnight")  return { h: 0,  m: 0 };

  // HH:MM am/pm  or  HH:MM (24-hr)
  let mt = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (mt) {
    let h = parseInt(mt[1]), m = parseInt(mt[2]);
    if (mt[3] === "pm" && h < 12) h += 12;
    if (mt[3] === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return { h, m };
  }

  // HHMM + am/pm  e.g. "830am" "1030pm"
  mt = s.match(/^(\d{3,4})\s*(am|pm)$/);
  if (mt) {
    const digits = mt[1];
    let h: number, m: number;
    if (digits.length === 3) {
      h = parseInt(digits[0]);
      m = parseInt(digits.slice(1));
    } else {
      h = parseInt(digits.slice(0, 2));
      m = parseInt(digits.slice(2));
    }
    if (mt[2] === "pm" && h < 12) h += 12;
    if (mt[2] === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return { h, m };
  }

  // H or HH + am/pm  e.g. "8am" "2pm"
  mt = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (mt) {
    let h = parseInt(mt[1]);
    if (mt[2] === "pm" && h < 12) h += 12;
    if (mt[2] === "am" && h === 12) h = 0;
    if (h > 23) return null;
    return { h, m: 0 };
  }

  // Plain 4-digit 24-hr time "1430"
  mt = s.match(/^(\d{4})$/);
  if (mt) {
    const h = parseInt(s.slice(0, 2)), m = parseInt(s.slice(2));
    if (h > 23 || m > 59) return null;
    return { h, m };
  }

  return null;
}

/**
 * Business-hours heuristic: if a bare number like "9" is given with no am/pm,
 * assume AM if >= 7, PM if <= 6.
 */
function guessAMPM(h: number): number {
  if (h >= 1 && h <= 6)  return h + 12; // 1–6 → PM (1pm–6pm)
  return h;                              // 7–12 → AM as-is
}

// ─── Token marker ──────────────────────────────────────────────────────────────
// We mark consumed tokens with a rare Unicode char so we can strip them cleanly.
const MARK = "\u0000";

function mark(s: string, regex: RegExp): string {
  return s.replace(regex, (m) => MARK.repeat(m.length));
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseTask(input: string): NLPResult {
  if (!input.trim()) {
    return { cleanTitle: "", dueDate: null, dueTime: null, humanLabel: null, estimateMinutes: null };
  }

  let s        = " " + input + " "; // pad for word-boundary matching
  let dateISO: string | null = null;
  let timeHH:  number | null = null;
  let timeMM:  number | null = null;
  let estMins: number | null = null;
  let dateFrom: "today" | "relative" | "named" = "today";

  // ── Pass 1: Relative offsets ─ "in 45 minutes" "in 2 hours" "in 3 days" ──
  const relRx = /\bin\s+(\d+)\s+(minute|min|hour|hr|day|week)s?\b/i;
  const relM  = s.match(relRx);
  if (relM) {
    const n    = parseInt(relM[1]);
    const unit = relM[2].toLowerCase();
    const now  = new Date();
    let ms = 0;
    if (unit.startsWith("min")) { ms = n * 60_000; estMins = n; }
    else if (unit.startsWith("hr") || unit === "hour") ms = n * 3_600_000;
    else if (unit === "day")  ms = n * 86_400_000;
    else if (unit === "week") ms = n * 7 * 86_400_000;
    const target = new Date(now.getTime() + ms);
    dateISO  = toISO(target);
    timeHH   = target.getHours();
    timeMM   = target.getMinutes();
    dateFrom = "relative";
    s = mark(s, relRx);
  }

  // ── Pass 2: Named date expressions ──────────────────────────────────────
  if (!dateISO) {
    // "next friday"
    const nextDayRx = new RegExp(`\\bnext\\s+(${WEEKDAYS.join("|")})\\b`, "i");
    const ndM = s.match(nextDayRx);
    if (ndM) {
      const idx = WEEKDAYS.findIndex(d => d === ndM[1].toLowerCase());
      dateISO  = nextWeekday(idx);
      dateFrom = "named";
      s = mark(s, nextDayRx);
    }
  }

  if (!dateISO) {
    // "this friday"
    const thisDayRx = new RegExp(`\\bthis\\s+(${WEEKDAYS.join("|")})\\b`, "i");
    const tdM = s.match(thisDayRx);
    if (tdM) {
      const idx = WEEKDAYS.findIndex(d => d === tdM[1].toLowerCase());
      dateISO  = thisWeekday(idx);
      dateFrom = "named";
      s = mark(s, thisDayRx);
    }
  }

  if (!dateISO) {
    // bare weekday "friday"
    const dayRx = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "i");
    const dM = s.match(dayRx);
    if (dM) {
      const idx = WEEKDAYS.findIndex(d => d === dM[1].toLowerCase());
      dateISO  = nextWeekday(idx);
      dateFrom = "named";
      s = mark(s, dayRx);
    }
  }

  if (!dateISO) {
    // "tomorrow"
    if (/\btomorrow\b/i.test(s)) {
      dateISO  = addDays(1);
      dateFrom = "named";
      s = mark(s, /\btomorrow\b/i);
    }
  }

  if (!dateISO) {
    // "today"
    if (/\btoday\b/i.test(s)) {
      dateISO  = toISO(new Date());
      dateFrom = "today";
      s = mark(s, /\btoday\b/i);
    }
  }

  if (!dateISO) {
    // "next week"
    if (/\bnext\s+week\b/i.test(s)) {
      dateISO  = addDays(7);
      dateFrom = "named";
      s = mark(s, /\bnext\s+week\b/i);
    }
  }

  if (!dateISO) {
    // Month + day: "jan 15" "january 15" "15 jan" "15 january"
    const allMonths = [...MONTHS, ...MONTH_SHORT].join("|");
    const mdRx = new RegExp(`\\b(${allMonths})\\s+(\\d{1,2})\\b|\\b(\\d{1,2})\\s+(${allMonths})\\b`, "i");
    const mdM  = s.match(mdRx);
    if (mdM) {
      let monthStr: string, day: number;
      if (mdM[1]) { monthStr = mdM[1]; day = parseInt(mdM[2]); }
      else        { monthStr = mdM[4]; day = parseInt(mdM[3]); }
      const mIdx = MONTHS.findIndex(m => m.startsWith(monthStr.toLowerCase().slice(0, 3)));
      if (mIdx >= 0 && day >= 1 && day <= 31) {
        const now = new Date();
        let year  = now.getFullYear();
        const tgt = new Date(year, mIdx, day);
        if (tgt < now) year++;
        dateISO  = toISO(new Date(year, mIdx, day));
        dateFrom = "named";
        s = mark(s, mdRx);
      }
    }
  }

  // ── Pass 3: Time expressions ─────────────────────────────────────────────
  if (timeHH === null) {
    // "eod" / "end of day"
    if (/\b(eod|end\s+of\s+day)\b/i.test(s)) {
      timeHH = 17; timeMM = 0;
      s = mark(s, /\b(eod|end\s+of\s+day)\b/i);
    }
  }

  if (timeHH === null) {
    // "noon" / "midday"
    if (/\b(noon|midday)\b/i.test(s)) {
      timeHH = 12; timeMM = 0;
      s = mark(s, /\b(noon|midday)\b/i);
    }
  }

  if (timeHH === null) {
    // "midnight"
    if (/\bmidnight\b/i.test(s)) {
      timeHH = 0; timeMM = 0;
      s = mark(s, /\bmidnight\b/i);
    }
  }

  if (timeHH === null) {
    // "morning"
    if (/\bmorning\b/i.test(s)) {
      timeHH = 9; timeMM = 0;
      s = mark(s, /\bmorning\b/i);
    }
  }

  if (timeHH === null) {
    // "afternoon"
    if (/\bafternoon\b/i.test(s)) {
      timeHH = 14; timeMM = 0;
      s = mark(s, /\bafternoon\b/i);
    }
  }

  if (timeHH === null) {
    // "tonight" / "this evening" / "evening"
    if (/\b(tonight|this\s+evening|evening)\b/i.test(s)) {
      timeHH = 18; timeMM = 0;
      s = mark(s, /\b(tonight|this\s+evening|evening)\b/i);
    }
  }

  if (timeHH === null) {
    // "at 8:30am" "at 830am" "at 8am" "at 8" "at 14:30"
    const atRx = /\bat\s+(\d{3,4}(?:am|pm)|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)/i;
    const atM  = s.match(atRx);
    if (atM) {
      const parsed = parseRawTime(atM[1]);
      if (parsed) {
        timeHH = parsed.h;
        timeMM = parsed.m;
      } else {
        // bare number like "at 9" — use heuristic
        const bare = parseInt(atM[1]);
        if (!isNaN(bare) && bare >= 1 && bare <= 23) {
          timeHH = guessAMPM(bare);
          timeMM = 0;
        }
      }
      if (timeHH !== null) s = mark(s, atRx);
    }
  }

  if (timeHH === null) {
    // Standalone time without "at": "2pm" "8:30am" "830am" "14:30"
    // Must be followed by word boundary and not part of a longer number
    const standaloneRx = /(?<![\d:])\b(\d{3,4}(?:am|pm)|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b(?!\s*(?:min|hour|hr|day|week))/i;
    const stM = s.match(standaloneRx);
    if (stM) {
      const parsed = parseRawTime(stM[1]);
      if (parsed) {
        timeHH = parsed.h;
        timeMM = parsed.m;
        s = mark(s, standaloneRx);
      }
    }
  }

  // ── Pass 4: Clean up title ────────────────────────────────────────────────
  // Remove MARK characters, collapse whitespace, strip leading connectors
  let cleanTitle = s
    .replace(/\u0000+/g, " ")       // marked zones → space
    .replace(/\s+/g, " ")            // collapse whitespace
    .replace(/^[\s,;:at]+/i, "")     // strip leading "at" / punctuation
    .replace(/[\s,;:]+$/,  "")       // strip trailing punctuation
    .trim();

  // ── Assemble result ───────────────────────────────────────────────────────
  const finalDate = dateISO;
  const finalTime = timeHH !== null
    ? toHHMM(timeHH, timeMM ?? 0)
    : null;

  let humanLabel: string | null = null;
  if (finalDate || finalTime) {
    const datePart = finalDate ? fmtDate(finalDate) : "";
    const timePart = timeHH !== null ? fmtTime(timeHH, timeMM ?? 0) : "";
    humanLabel = [datePart, timePart].filter(Boolean).join(" ");
  }

  return {
    cleanTitle,
    dueDate:        finalDate,
    dueTime:        finalTime,
    humanLabel,
    estimateMinutes: estMins,
  };
}
