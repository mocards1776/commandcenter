import { useEffect, useState, useRef } from "react";

const API       = (import.meta as any).env?.VITE_API_URL ?? "https://orca-app-v7oew.ondigitalocean.app";
const BG        = "#162a1c";
const ROW_BG    = "#1e3629";
const HEADER_BG = "#122016";
const GOLD      = "#e8a820";
const DIM       = "rgba(245,240,224,0.22)";
const MUTED     = "rgba(245,240,224,0.55)";
const FG        = "#f5f0e0";
const WIN_GRN   = "#4caf50";
const LOSS_RD   = "#d94040";
const FONT      = "'Oswald',Arial,sans-serif";

const LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: 8, fontWeight: 700,
  letterSpacing: "0.15em", textTransform: "uppercase", color: DIM,
};

// ─── LED Ribbon Board ────────────────────────────────────────────────────────
// Styled after real stadium LED ribbon boards — dark matrix background,
// amber LED text, scrolling ticker with discrete stat segments.

function LedDot({ lit, color = "#e8a820" }: { lit: boolean; color?: string }) {
  return (
    <div style={{
      width: 3, height: 3, borderRadius: "50%",
      background: lit ? color : "rgba(255,255,255,0.04)",
      boxShadow: lit ? `0 0 4px ${color}99` : "none",
      flexShrink: 0,
    }} />
  );
}

interface RibbonStat {
  label: string;
  value: string;
  color?: string;
  separator?: boolean;
}

function RibbonSegment({ stat }: { stat: RibbonStat }) {
  const c = stat.color ?? GOLD;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "0 14px" }}>
      {stat.separator && (
        <div style={{ display: "flex", gap: 2, alignItems: "center", marginRight: 6 }}>
          {[0,1,2].map(i => <LedDot key={i} lit color={GOLD} />)}
        </div>
      )}
      <span style={{
        fontFamily: FONT, fontSize: 10, fontWeight: 700,
        letterSpacing: "0.16em", textTransform: "uppercase",
        color: "rgba(232,168,32,0.5)",
      }}>{stat.label}</span>
      <span style={{ width: 1, height: 12, background: "rgba(232,168,32,0.2)", flexShrink: 0 }} />
      <span style={{
        fontFamily: FONT, fontSize: 13, fontWeight: 800,
        letterSpacing: "0.04em",
        color: c,
        textShadow: `0 0 8px ${c}88`,
        fontVariantNumeric: "tabular-nums",
      }}>{stat.value}</span>
    </div>
  );
}

function LedRibbonBoard({ stats, loading }: { stats: RibbonStat[]; loading: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const animRef  = useRef<number>(0);
  const speedPx  = 0.6; // px per frame

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let pos = 0;
    const half = track.scrollWidth / 2;

    const tick = () => {
      pos += speedPx;
      if (pos >= half) pos = 0;
      setOffset(pos);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [stats.length]);

  const items = [...stats, ...stats]; // duplicate for seamless loop

  return (
    <div style={{
      position: "relative",
      background: "#060e08",
      borderTop: "2px solid #0a1a0c",
      borderBottom: "2px solid #0a1a0c",
      overflow: "hidden",
      height: 32,
    }}>
      {/* Scanline overlay for LED matrix texture */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
        background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)",
      }} />

      {/* Left fade */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 28, zIndex: 3,
        background: "linear-gradient(to right, #060e08, transparent)",
        pointerEvents: "none",
      }} />
      {/* Right fade */}
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 28, zIndex: 3,
        background: "linear-gradient(to left, #060e08, transparent)",
        pointerEvents: "none",
      }} />

      {/* STL logo pill — left anchor */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 4,
        display: "flex", alignItems: "center",
        background: "linear-gradient(to right, #060e08 70%, transparent)",
        paddingLeft: 8, paddingRight: 20,
      }}>
        <div style={{
          background: "#0a1a0c", border: "1px solid rgba(232,168,32,0.3)", borderRadius: 2,
          padding: "2px 7px", display: "flex", alignItems: "center", gap: 4,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 800, letterSpacing: "0.2em",
            color: GOLD, textShadow: `0 0 6px ${GOLD}66` }}>STL</span>
        </div>
      </div>

      {/* Scrolling track */}
      <div style={{
        display: "flex", alignItems: "center",
        height: "100%", whiteSpace: "nowrap",
        transform: `translateX(${-offset}px)`,
        paddingLeft: 56,
        willChange: "transform",
      }} ref={trackRef}>
        {loading ? (
          <span style={{ fontFamily: FONT, fontSize: 10, color: "rgba(232,168,32,0.3)", letterSpacing: "0.15em", padding: "0 20px" }}>
            LOADING · PROJECTION DATA · · ·
          </span>
        ) : (
          items.map((s, i) => <RibbonSegment key={i} stat={s} />)
        )}
      </div>
    </div>
  );
}

// ─── Flip panel cell ────────────────────────────────────────────────────────
function FlipCell({ value, sub, color = "empty", small = false }: {
  value: string | number; sub?: string;
  color?: "gold" | "white" | "muted" | "empty" | "red" | "green";
  small?: boolean;
}) {
  const c = color === "gold" ? GOLD : color === "red" ? LOSS_RD : color === "green" ? WIN_GRN
          : color === "white" ? FG : color === "muted" ? MUTED : "rgba(255,255,255,0.12)";
  const v  = String(value);
  const fs = v.length > 5 ? 11 : v.length > 3 ? 15 : small ? 18 : 22;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div className="panel" style={{ width: small ? 44 : 52, height: small ? 38 : 46,
        boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}>
        <span className="panel-num" style={{ fontSize: fs, color: c }}>{v}</span>
      </div>
      {sub && <div className="panel-sub" style={{ fontSize: 7 }}>{sub}</div>}
    </div>
  );
}

// ─── Section header ─────────────────────────────────────────────────────────
function SBHead({ label }: { label: string }) {
  return (
    <div style={{
      background: HEADER_BG, padding: "4px 8px",
      borderBottom: "1px solid rgba(232,168,32,0.18)",
      borderTop: "1px solid rgba(0,0,0,0.4)",
      fontFamily: FONT, fontSize: 9, fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase" as const, color: GOLD,
    }}>{label}</div>
  );
}

// ─── Standings row ──────────────────────────────────────────────────────────
type Row = { abbr: string; wl: string; pct: string; gb: string; strk: string; l10: string; cards?: boolean };

function StandingsRow({ row, rank }: { row: Row; rank: number }) {
  const win = row.strk?.startsWith("W");
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "16px 52px 56px 40px 34px 40px 36px",
      alignItems: "center", padding: "3px 6px",
      background: row.cards ? "rgba(232,168,32,0.06)" : rank % 2 === 0 ? ROW_BG : BG,
      borderBottom: "1px solid rgba(0,0,0,0.35)",
      minHeight: 36,
    }}>
      <span style={{ fontFamily: FONT, fontSize: 9, color: row.cards ? GOLD : DIM, textAlign: "center" as const }}>{rank}</span>
      <div style={{
        background: "#0e1f14", border: `1px solid ${row.cards ? "rgba(232,168,32,0.35)" : "rgba(0,0,0,0.5)"}`,
        borderRadius: 3, boxShadow: "inset 0 2px 3px rgba(0,0,0,0.45)",
        padding: "2px 5px", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: row.cards ? 800 : 600,
          letterSpacing: "0.08em", textTransform: "uppercase" as const,
          color: row.cards ? GOLD : MUTED }}>{row.abbr}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          background: "#0e1f14", border: "1px solid rgba(0,0,0,0.45)", borderRadius: 3,
          boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4)",
          padding: "2px 5px", minWidth: 40, textAlign: "center" as const,
        }}>
          <span style={{ fontFamily: FONT, fontSize: row.cards ? 12 : 11,
            fontWeight: row.cards ? 800 : 600, color: row.cards ? FG : "rgba(245,240,224,0.6)",
            fontVariantNumeric: "tabular-nums" as const }}>{row.wl}</span>
        </div>
      </div>
      <div style={{ textAlign: "center" as const }}>
        <span style={{ fontFamily: FONT, fontSize: row.cards ? 11 : 10,
          fontWeight: row.cards ? 700 : 500, color: row.cards ? GOLD : "rgba(245,240,224,0.38)",
          fontVariantNumeric: "tabular-nums" as const }}>{row.pct}</span>
      </div>
      <div style={{ textAlign: "center" as const }}>
        <span style={{ fontFamily: FONT, fontSize: 10, color: "rgba(245,240,224,0.3)",
          fontVariantNumeric: "tabular-nums" as const }}>{row.gb}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          background: win ? "rgba(76,175,80,0.10)" : "rgba(217,64,64,0.10)",
          border: `1px solid ${win ? "rgba(76,175,80,0.25)" : "rgba(217,64,64,0.25)"}`,
          borderRadius: 3, padding: "2px 5px", minWidth: 26, textAlign: "center" as const,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700,
            color: win ? WIN_GRN : LOSS_RD }}>{row.strk}</span>
        </div>
      </div>
      <div style={{ textAlign: "center" as const }}>
        <span style={{ fontFamily: FONT, fontSize: 10, color: "rgba(245,240,224,0.32)",
          fontVariantNumeric: "tabular-nums" as const }}>{row.l10}</span>
      </div>
    </div>
  );
}

// ─── Game block ──────────────────────────────────────────────────────────────
function GameBlock({ game, label }: { game: any; label: string }) {
  if (!game) return (
    <div>
      <SBHead label={label} />
      <div style={{ padding: "8px 10px", fontFamily: FONT, fontSize: 10, color: DIM }}>Loading…</div>
    </div>
  );

  const isFinal = game.status === "Final";
  const isLive  = game.status === "Live";
  const stlWon  = isFinal && game.stl_score > game.opp_score;

  const headerLabel = isFinal
    ? `${label} — Final`
    : isLive
    ? `${label} — Live`
    : `${label} — ${game.date_label ?? ""}`;

  return (
    <div>
      <SBHead label={headerLabel} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 20px 1fr", gap: 4, padding: "5px 8px 3px", alignItems: "center" }}>
        <div style={{
          background: "#0e1f14", border: `1px solid ${isFinal && stlWon ? "rgba(232,168,32,0.4)" : isFinal ? "rgba(217,64,64,0.25)" : "rgba(232,168,32,0.25)"}`,
          borderRadius: 3, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.45)",
          padding: "5px 8px", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
            color: isFinal && stlWon ? GOLD : isFinal ? "rgba(245,240,224,0.55)" : GOLD }}>
            STL · CARDINALS
          </span>
          {(isFinal || isLive) && (
            <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800,
              color: isFinal && stlWon ? GOLD : "rgba(245,240,224,0.55)",
              fontVariantNumeric: "tabular-nums" as const }}>{game.stl_score}</span>
          )}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 8, color: DIM, textAlign: "center" as const }}>
          {!isFinal && !isLive ? (game.stl_is_home ? "vs" : "@") : ""}
        </div>
        <div style={{
          background: "#0e1f14", border: "1px solid rgba(0,0,0,0.5)",
          borderRadius: 3, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.4)",
          padding: "5px 8px", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: MUTED }}>
            {game.opp_abbr} · {(game.opp_name ?? "").toUpperCase()}
          </span>
          {(isFinal || isLive) && (
            <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700,
              color: isFinal && !stlWon ? "#d94040" : "rgba(245,240,224,0.5)",
              fontVariantNumeric: "tabular-nums" as const }}>{game.opp_score}</span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 8px 6px" }}>
        {isFinal ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 800,
              background: stlWon ? "rgba(76,175,80,0.12)" : "rgba(217,64,64,0.12)",
              color: stlWon ? WIN_GRN : LOSS_RD,
              border: `1px solid ${stlWon ? "rgba(76,175,80,0.4)" : "rgba(217,64,64,0.4)"}`,
              borderRadius: 3, padding: "1px 8px",
            }}>{stlWon ? "W" : "L"}</div>
            <span style={{ fontFamily: FONT, fontSize: 9, color: stlWon ? "rgba(76,175,80,0.65)" : "rgba(217,64,64,0.65)" }}>
              {game.result}
            </span>
          </div>
        ) : isLive ? (
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: WIN_GRN }}>{game.result}</span>
        ) : (
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: GOLD }}>{game.game_time}</span>
        )}
        <span style={{ fontFamily: FONT, fontSize: 8, color: DIM, textAlign: "right" as const }}>
          {game.venue}{game.city ? ` · ${game.city}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Projection data fetcher ─────────────────────────────────────────────────
// Uses FanGraphs/Baseball Reference projection consensus via public APIs.
// Falls back to graceful static estimates if unavailable.
async function fetchProjections(): Promise<RibbonStat[]> {
  try {
    // Try FanGraphs depth charts endpoint (public, no auth)
    const res = await fetch(
      "https://www.fangraphs.com/api/depth-charts/data?type=steamer&teamid=28",
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const d = await res.json();
      const wins = d?.total_wins ?? d?.projected_wins;
      if (wins) {
        return buildStats(Math.round(wins), null, null);
      }
    }
  } catch {}

  // Fallback: derive from live standings W-L pace
  return null as any;
}

function buildStats(
  projWins: number | null,
  playoffPct: number | null,
  divPct: number | null,
  record?: { w: number; l: number }
): RibbonStat[] {
  const stats: RibbonStat[] = [];

  // If we have live record, compute pace projection
  if (record && !projWins) {
    const gp = record.w + record.l;
    if (gp > 0) projWins = Math.round((record.w / gp) * 162);
  }

  stats.push({
    label: "2026 Projected Wins",
    value: projWins != null ? `${projWins} W` : "— W",
    color: projWins != null && projWins >= 86 ? WIN_GRN : projWins != null && projWins >= 81 ? GOLD : LOSS_RD,
    separator: false,
  });

  // Playoff % — derive from projected wins if no direct data
  if (playoffPct == null && projWins != null) {
    // Rough logistic curve: 90W ≈ 75%, 85W ≈ 45%, 80W ≈ 20%
    playoffPct = Math.min(99, Math.max(1, Math.round(1 / (1 + Math.exp(-0.22 * (projWins - 84))) * 100)));
  }
  stats.push({
    label: "Playoff Chances",
    value: playoffPct != null ? `${playoffPct}%` : "—",
    color: playoffPct != null && playoffPct >= 60 ? WIN_GRN : playoffPct != null && playoffPct >= 35 ? GOLD : LOSS_RD,
    separator: true,
  });

  // Division title % — rough model
  if (divPct == null && projWins != null) {
    divPct = Math.min(95, Math.max(1, Math.round(1 / (1 + Math.exp(-0.28 * (projWins - 89))) * 100)));
  }
  stats.push({
    label: "Division Title",
    value: divPct != null ? `${divPct}%` : "—",
    color: divPct != null && divPct >= 40 ? WIN_GRN : divPct != null && divPct >= 20 ? GOLD : LOSS_RD,
    separator: true,
  });

  // Wild card % (complement)
  const wcPct = playoffPct != null && divPct != null
    ? Math.max(0, Math.min(playoffPct - divPct, playoffPct))
    : null;
  if (wcPct != null) {
    stats.push({
      label: "Wild Card",
      value: `${Math.max(0, wcPct)}%`,
      color: wcPct >= 30 ? WIN_GRN : wcPct >= 15 ? GOLD : MUTED,
      separator: true,
    });
  }

  // World Series %
  const wsPct = projWins != null
    ? Math.round(1 / (1 + Math.exp(-0.18 * (projWins - 92))) * 18)
    : null;
  if (wsPct != null) {
    stats.push({
      label: "World Series",
      value: `${Math.max(1, wsPct)}%`,
      color: wsPct >= 10 ? WIN_GRN : wsPct >= 5 ? GOLD : MUTED,
      separator: true,
    });
  }

  return stats;
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function BaseballPanel() {
  const [data, setData]           = useState<any>(null);
  const [ribbonStats, setRibbon]  = useState<RibbonStat[]>([]);
  const [ribbonLoading, setRibbonLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch(`${API}/sports/mlb/cardinals`)
        .then(r => r.json())
        .then(d => {
          setData(d);
          // Build ribbon from live data + projections
          const stl = d?.nl_central?.find((r: Row) => r.cards);
          const wlParts = stl?.wl?.split("-").map(Number);
          const record = wlParts?.length === 2 ? { w: wlParts[0], l: wlParts[1] } : undefined;
          const stats = buildStats(null, null, null, record);
          setRibbon(stats);
          setRibbonLoading(false);
          // Also try external projections in background
          fetchProjections().then(ext => { if (ext) setRibbon(ext); }).catch(() => {});
        })
        .catch(console.error);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const standings   = data?.nl_central   ?? [];
  const currentGame = data?.current_game ?? null;
  const nextGame    = data?.next_game    ?? null;
  const today       = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div style={{ background: BG, borderTop: "3px solid #122016" }}>

      {/* ── Two-column grid: standings + Cardinals ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 3px 1fr" }}>

        {/* LEFT: NL Central Standings */}
        <div>
          <SBHead label={`NL Central Standings · ${today}`} />
          <div style={{
            display: "grid", gridTemplateColumns: "16px 52px 56px 40px 34px 40px 36px",
            padding: "2px 6px", background: HEADER_BG,
            borderBottom: "1px solid rgba(0,0,0,0.4)",
          }}>
            {["", "TEAM", "W-L", "PCT", "GB", "STRK", "L10"].map((h, i) => (
              <div key={i} style={{
                ...LABEL, color: "rgba(232,168,32,0.35)",
                textAlign: i <= 1 ? "left" as const : "center" as const,
                padding: "1px 2px",
              }}>{h}</div>
            ))}
          </div>
          {standings.length > 0
            ? standings.map((row: Row, i: number) => <StandingsRow key={row.abbr} row={row} rank={i + 1} />)
            : [1,2,3,4,5].map(i => (
                <div key={i} style={{ height: 36, background: i % 2 === 0 ? ROW_BG : BG,
                  borderBottom: "1px solid rgba(0,0,0,0.3)",
                  display: "flex", alignItems: "center", padding: "0 8px" }}>
                  <div style={{ width: "60%", height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 2 }} />
                </div>
              ))
          }
        </div>

        {/* Center divider */}
        <div style={{ background: "#122016" }} />

        {/* RIGHT: Cardinals games */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <SBHead label="St. Louis Cardinals" />
          <GameBlock game={currentGame} label="Current Game" />
          <div style={{ height: 1, background: "rgba(232,168,32,0.10)" }} />
          <GameBlock game={nextGame} label="Next Game" />
        </div>
      </div>

      {/* ── LED Ribbon Board ── */}
      <LedRibbonBoard stats={ribbonStats} loading={ribbonLoading} />
    </div>
  );
}
