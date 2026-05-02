import { useEffect, useState } from "react";

const API       = (import.meta as any).env?.VITE_API_URL ?? "https://orca-app-v7oew.ondigitalocean.app";
const BG        = "#243d28";   // same medium green as batting avg rows
const ROW_BG    = "#1e3422";   // slightly darker alt row
const HEADER_BG = "#182c1c";   // section header
const PANEL     = "#111f14";   // dark inset panel — same as flip-digit boxes
const GOLD      = "#c9a832";
const DIM       = "rgba(200,195,160,0.30)";
const MUTED     = "rgba(200,195,160,0.65)";
const FG        = "#d8d0b8";
const WIN_GRN   = "#3a9140";
const LOSS_RD   = "#c83030";
const FONT      = "'Oswald',Arial,sans-serif";



// ─── LED Ribbon Board ────────────────────────────────────────────────────────
// Static ribbon board — dark LED matrix, Cardinals logo, patriotic red/white/blue,
// stat blocks for projected wins / playoff % / division title.

interface RibbonStat {
  label: string;
  value: string;
  valueColor: string;
  glowColor: string;
}

// Cardinals logo — official MLB CDN
function CardinalsLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="https://www.mlbstatic.com/team-logos/138.svg"
      alt="St. Louis Cardinals"
      width={size}
      height={size}
      style={{ objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(196,30,58,0.5))" }}
    />
  );
}

// Patriotic stripe: repeating red / white / blue pixel columns
function PatrioticStripe({ height = 4 }: { height?: number }) {
  // 3-pixel repeating pattern via gradient
  return (
    <div style={{
      height,
      background: "repeating-linear-gradient(90deg, #c41e3a 0px, #c41e3a 3px, #f5f0e0 3px, #f5f0e0 6px, #002868 6px, #002868 9px)",
      opacity: 0.85,
    }} />
  );
}

// Vertical divider between stat blocks
function RibbonDivider() {
  return (
    <div style={{
      width: 1, alignSelf: "stretch", margin: "6px 0",
      background: "linear-gradient(to bottom, transparent, rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.12) 70%, transparent)",
    }} />
  );
}

function RibbonStatBlock({ stat }: { stat: RibbonStat }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "0 18px", gap: 2, flex: 1,
    }}>
      <span style={{
        fontFamily: FONT, fontSize: 8, fontWeight: 700,
        letterSpacing: "0.18em", textTransform: "uppercase" as const,
        color: "rgba(245,240,224,0.38)",
      }}>{stat.label}</span>
      <span style={{
        fontFamily: FONT, fontSize: 16, fontWeight: 900,
        letterSpacing: "0.03em",
        color: stat.valueColor,
        textShadow: `0 0 10px ${stat.glowColor}`,
        fontVariantNumeric: "tabular-nums" as const,
        lineHeight: 1,
      }}>{stat.value}</span>
    </div>
  );
}

function LedRibbonBoard({ stats, loading }: { stats: RibbonStat[]; loading: boolean }) {
  return (
    <div style={{ position: "relative", background: "#06080e" }}>
      {/* Top patriotic stripe */}
      <PatrioticStripe height={3} />

      {/* Main board */}
      <div style={{
        position: "relative",
        background: "linear-gradient(180deg, #0a0c14 0%, #060810 100%)",
        overflow: "hidden",
        height: 52,
        display: "flex", alignItems: "center",
      }}>
        {/* LED scanline matrix texture */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
          background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.14) 3px, rgba(0,0,0,0.14) 4px)",
        }} />
        {/* Subtle vertical column texture */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
          background: "repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 5px)",
        }} />

        {/* Content row */}
        <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", width: "100%", height: "100%" }}>

          {/* Cardinals logo block */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "0 16px 0 12px",
            borderRight: "1px solid rgba(255,255,255,0.07)",
            height: "100%",
            background: "linear-gradient(90deg, rgba(196,30,58,0.12) 0%, transparent 100%)",
            flexShrink: 0,
          }}>
            <CardinalsLogo size={34} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 800, letterSpacing: "0.2em",
                color: "#c41e3a", textShadow: "0 0 6px rgba(196,30,58,0.6)" }}>ST. LOUIS</span>
              <span style={{ fontFamily: FONT, fontSize: 7, fontWeight: 700, letterSpacing: "0.16em",
                color: "rgba(232,168,32,0.7)" }}>CARDINALS · 2026</span>
            </div>
          </div>

          {/* Stars separator */}
          <div style={{ padding: "0 10px", flexShrink: 0 }}>
            <span style={{ fontFamily: "Arial,sans-serif", fontSize: 8, color: "#002868",
              textShadow: "0 0 4px rgba(0,40,104,0.8)", letterSpacing: "3px" }}>★★★</span>
          </div>

          {/* Stat blocks */}
          {loading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "rgba(245,240,224,0.2)", letterSpacing: "0.2em" }}>
                LOADING PROJECTIONS…
              </span>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-evenly" }}>
              {stats.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                  {i > 0 && <RibbonDivider />}
                  <RibbonStatBlock stat={s} />
                </div>
              ))}
            </div>
          )}

          {/* Right patriotic flag accent */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 2, padding: "0 10px",
            borderLeft: "1px solid rgba(255,255,255,0.07)", height: "100%",
            justifyContent: "center", flexShrink: 0,
          }}>
            {["#c41e3a","#f5f0e0","#002868","#f5f0e0","#c41e3a"].map((c, i) => (
              <div key={i} style={{ width: 6, height: 4, background: c, opacity: 0.7 }} />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom patriotic stripe */}
      <PatrioticStripe height={3} />
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
type Row = { abbr?: string; full?: string; teamName?: string; team_id?: number; wl: string; pct: string; gb: string; strk: string; l10: string; cards?: boolean };

// Abbr + short name fallback keyed by team_id
const ID_MAP: Record<number,[string,string]> = {
  112:["CHC","Cubs"],     113:["CIN","Reds"],      138:["STL","Cardinals"],
  158:["MIL","Brewers"],  134:["PIT","Pirates"],   137:["SF","Giants"],
  119:["LAD","Dodgers"],  135:["SD","Padres"],     109:["ARI","D-backs"],
  115:["COL","Rockies"],  144:["ATL","Braves"],    121:["NYM","Mets"],
  143:["PHI","Phillies"], 146:["MIA","Marlins"],   120:["WSH","Nats"],
  147:["NYY","Yankees"],  111:["BOS","Red Sox"],   141:["TOR","Blue Jays"],
  139:["TB","Rays"],      110:["BAL","Orioles"],   117:["HOU","Astros"],
  140:["TEX","Rangers"],  136:["SEA","Mariners"],  108:["LAA","Angels"],
  133:["OAK","Athletics"],145:["CHW","White Sox"], 114:["CLE","Guardians"],
  116:["DET","Tigers"],   118:["KC","Royals"],     142:["MIN","Twins"],
};

function StandingsRow({ row, rank }: { row: Row; rank: number }) {
  const win     = row.strk?.startsWith("W");
  const tid     = row.team_id as number;
  // Always use ID_MAP for abbr and short name — avoids any backend inconsistency
  const abbr      = ID_MAP[tid]?.[0] ?? row.abbr ?? "???";
  const shortName = ID_MAP[tid]?.[1] ?? row.full ?? "";

  // Shared dark inset panel — matches the flip-digit boxes at top of dashboard
  const statPanel = (content: React.ReactNode, gold = false) => (
    <div style={{
      background: PANEL,
      border: `1px solid ${gold ? "rgba(201,168,50,0.28)" : "rgba(0,0,0,0.55)"}`,
      borderRadius: 2,
      boxShadow: "inset 0 2px 5px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(255,255,255,0.03)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "3px 6px", minHeight: 28,
    }}>{content}</div>
  );

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "22px 44px 1fr 62px 46px 36px 46px 38px",
      alignItems: "center",
      columnGap: 6,
      padding: "4px 10px 4px 8px",
      background: row.cards
        ? "linear-gradient(90deg,rgba(201,168,50,0.10),rgba(201,168,50,0.04))"
        : rank % 2 === 0 ? ROW_BG : BG,
      borderBottom: "1px solid rgba(0,0,0,0.4)",
      borderLeft: row.cards ? "3px solid rgba(201,168,50,0.6)" : "3px solid transparent",
      minHeight: 40,
    }}>

      {/* Rank */}
      <span style={{ fontFamily:FONT, fontSize:11, fontWeight:700, textAlign:"center" as const,
        color: row.cards ? GOLD : DIM }}>{rank}</span>

      {/* Abbr — dark inset panel */}
      {statPanel(
        <span style={{ fontFamily:FONT, fontSize:12, fontWeight:800,
          letterSpacing:"0.08em", textTransform:"uppercase" as const,
          color: row.cards ? GOLD : MUTED }}>{abbr}</span>,
        row.cards
      )}

      {/* Short team name — plain text, full visibility */}
      <span style={{
        fontFamily:FONT, fontSize:12, fontWeight: row.cards ? 700 : 600,
        letterSpacing:"0.07em", textTransform:"uppercase" as const,
        color: row.cards ? FG : "rgba(200,195,160,0.55)",
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const,
        paddingLeft: 2,
      }}>{shortName}</span>

      {/* W-L — dark inset panel */}
      {statPanel(
        <span style={{ fontFamily:FONT, fontSize: row.cards ? 14 : 13, fontWeight: row.cards ? 900 : 700,
          fontVariantNumeric:"tabular-nums" as const, letterSpacing:"0.02em",
          color: row.cards ? FG : "rgba(200,195,160,0.70)" }}>{row.wl}</span>,
        row.cards
      )}

      {/* PCT — dark inset panel */}
      {statPanel(
        <span style={{ fontFamily:FONT, fontSize:11, fontWeight: row.cards ? 700 : 500,
          fontVariantNumeric:"tabular-nums" as const,
          color: row.cards ? GOLD : "rgba(200,195,160,0.50)" }}>{row.pct}</span>
      )}

      {/* GB — dark inset panel */}
      {statPanel(
        <span style={{ fontFamily:FONT, fontSize:11,
          fontVariantNumeric:"tabular-nums" as const,
          color:"rgba(200,195,160,0.38)" }}>{row.gb}</span>
      )}

      {/* STRK — dark inset panel with color tint */}
      <div style={{
        background: win ? "rgba(10,40,14,0.9)" : "rgba(60,10,10,0.8)",
        border:`1px solid ${win ? "rgba(58,145,64,0.5)" : "rgba(200,48,48,0.45)"}`,
        borderRadius: 2,
        boxShadow: "inset 0 2px 5px rgba(0,0,0,0.65)",
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:"3px 6px", minHeight:28,
      }}>
        <span style={{ fontFamily:FONT, fontSize:13, fontWeight:800, letterSpacing:"0.05em",
          color: win ? WIN_GRN : LOSS_RD,
          textShadow: win ? "0 0 8px rgba(58,145,64,0.65)" : "0 0 8px rgba(200,48,48,0.55)",
        }}>{row.strk}</span>
      </div>

      {/* L10 — dark inset panel */}
      {statPanel(
        <span style={{ fontFamily:FONT, fontSize:11,
          fontVariantNumeric:"tabular-nums" as const,
          color:"rgba(200,195,160,0.40)" }}>{row.l10}</span>
      )}

    </div>
  );
}

// ─── Game block ──────────────────────────────────────────────────────────────
// Small muted label used for "Current Game — Final", "Next Game — ...", etc.
function GameLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontFamily: FONT, fontSize: 8, fontWeight: 600,
      letterSpacing: "0.18em", textTransform: "uppercase" as const,
      color: "rgba(200,195,160,0.40)",
      padding: "5px 0 3px",
      textAlign: "center" as const,
      borderTop: "1px solid rgba(0,0,0,0.35)",
    }}>{text}</div>
  );
}

function GameBlock({ game, label }: { game: any; label: string }) {
  if (!game) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: FONT, fontSize: 9, color: DIM }}>Loading…</span>
    </div>
  );

  const isFinal = game.status === "Final";
  const isLive  = game.status === "Live";
  const stlWon  = isFinal && game.stl_score > game.opp_score;

  const statusSuffix = isFinal ? "Final" : isLive ? "Live" : (game.date_label ?? "");
  const headerText   = statusSuffix ? `${label} — ${statusSuffix}` : label;

  return (
    <div style={{ padding: "0 8px 6px" }}>
      <GameLabel text={headerText} />

      {/* Team rows — centered grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 18px 1fr", gap: 4, alignItems: "center", marginTop: 2 }}>

        {/* STL box */}
        <div style={{
          background: PANEL,
          border: `1px solid ${isFinal && stlWon ? "rgba(201,168,50,0.45)" : isFinal ? "rgba(200,48,48,0.20)" : "rgba(201,168,50,0.22)"}`,
          borderRadius: 3,
          boxShadow: "inset 0 2px 5px rgba(0,0,0,0.65)",
          padding: "6px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
            color: isFinal && stlWon ? GOLD : isFinal ? "rgba(200,195,160,0.45)" : GOLD }}>
            STL · CARDINALS
          </span>
          {(isFinal || isLive) && (
            <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 900,
              color: isFinal && stlWon ? GOLD : "rgba(200,195,160,0.55)",
              fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{game.stl_score}</span>
          )}
        </div>

        {/* vs / @ */}
        <div style={{ fontFamily: FONT, fontSize: 8, color: DIM, textAlign: "center" as const }}>
          {!isFinal && !isLive ? (game.stl_is_home ? "vs" : "@") : ""}
        </div>

        {/* OPP box */}
        <div style={{
          background: PANEL,
          border: "1px solid rgba(0,0,0,0.5)",
          borderRadius: 3,
          boxShadow: "inset 0 2px 5px rgba(0,0,0,0.65)",
          padding: "6px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: MUTED }}>
            {game.opp_abbr} · {(game.opp_name ?? "").toUpperCase()}
          </span>
          {(isFinal || isLive) && (
            <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700,
              color: isFinal && !stlWon ? LOSS_RD : "rgba(200,195,160,0.45)",
              fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{game.opp_score}</span>
          )}
        </div>
      </div>

      {/* Footer row: W/L badge + result + venue */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5 }}>
        {isFinal ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              fontFamily: FONT, fontSize: 10, fontWeight: 800,
              background: stlWon ? "rgba(58,145,64,0.15)" : "rgba(200,48,48,0.15)",
              color: stlWon ? WIN_GRN : LOSS_RD,
              border: `1px solid ${stlWon ? "rgba(58,145,64,0.45)" : "rgba(200,48,48,0.40)"}`,
              borderRadius: 2, padding: "1px 8px",
              textShadow: stlWon ? "0 0 8px rgba(58,145,64,0.5)" : "0 0 8px rgba(200,48,48,0.4)",
            }}>{stlWon ? "W" : "L"}</div>
            <span style={{ fontFamily: FONT, fontSize: 9,
              color: stlWon ? "rgba(58,145,64,0.60)" : "rgba(200,48,48,0.55)" }}>
              {game.result}
            </span>
          </div>
        ) : isLive ? (
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: WIN_GRN }}>{game.result}</span>
        ) : (
          <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 800, color: GOLD,
            letterSpacing: "0.04em" }}>{game.game_time}</span>
        )}
        <span style={{ fontFamily: FONT, fontSize: 8, color: DIM, textAlign: "right" as const }}>
          {game.venue}{game.city ? ` · ${game.city}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Projection data fetcher ─────────────────────────────────────────────────
// Fetches Cardinals playoff odds from Baseball Reference via backend proxy.
async function fetchProjections(): Promise<RibbonStat[] | null> {
  try {
    const res = await fetch(`${API}/sports/mlb/cardinals/projections`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const d = await res.json();
      return buildStats(d.proj_wins, d.playoff_pct, d.div_pct, d.wc_pct, d.ws_pct, d.best, d.record);
    }
  } catch {}
  return null;
}

function statColor(val: number, good: number, ok: number): { valueColor: string; glowColor: string } {
  if (val >= good) return { valueColor: WIN_GRN, glowColor: "rgba(76,175,80,0.5)" };
  if (val >= ok)   return { valueColor: GOLD,    glowColor: "rgba(232,168,32,0.5)" };
  return             { valueColor: LOSS_RD,  glowColor: "rgba(217,64,64,0.4)" };
}

function buildStats(
  projWins: number | null,
  playoffPct: number | null,
  divPct: number | null,
  wcPct: number | null,
  wsPct: number | null,
  best: string | null,
  record: string | null,
): RibbonStat[] {
  return [
    {
      label: "Proj. Wins",
      value: projWins != null ? `${projWins}` : "—",
      ...statColor(projWins ?? 0, 86, 81),
    },
    {
      label: "Playoff %",
      value: playoffPct != null ? `${playoffPct}%` : "—",
      ...statColor(playoffPct ?? 0, 50, 25),
    },
    {
      label: "Div. Title",
      value: divPct != null ? `${divPct}%` : "—",
      ...statColor(divPct ?? 0, 30, 10),
    },
    {
      label: "Wild Card",
      value: wcPct != null ? `${wcPct}%` : "—",
      ...statColor(wcPct ?? 0, 30, 10),
    },
    {
      label: "World Series",
      value: wsPct != null ? `${wsPct}%` : "—",
      ...statColor(wsPct ?? 0, 5, 2),
    },
  ];
}

// Seed with real BBRef data scraped today (refreshed by backend)
const SEED_STATS = buildStats(76, 8.6, 0.3, 8.3, 0.3, "86-76", "19-13");

// ─── Main export ─────────────────────────────────────────────────────────────
export function BaseballPanel() {
  const [data, setData]           = useState<any>(null);
  const [ribbonStats, setRibbon]  = useState<RibbonStat[]>(SEED_STATS);
  const [ribbonLoading, setRibbonLoading] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`${API}/sports/mlb/cardinals`)
        .then(r => r.json())
        .then(d => { setData(d); })
        .catch(console.error);
    load();
    const id = setInterval(load, 60_000);
    // Refresh projections every 30 min
    fetchProjections().then(ext => { if (ext) { setRibbon(ext); } }).catch(() => {});
    const projId = setInterval(() => {
      fetchProjections().then(ext => { if (ext) setRibbon(ext); }).catch(() => {});
    }, 30 * 60_000);
    return () => { clearInterval(id); clearInterval(projId); };
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
            display: "grid",
            gridTemplateColumns: "22px 44px 1fr 62px 46px 36px 46px 38px",
            alignItems: "center",
            columnGap: 6,
            padding: "3px 10px 3px 8px",
            background: HEADER_BG,
            borderBottom: "1px solid rgba(0,0,0,0.5)",
          }}>
            {[
              {l:"",     a:"center"},{l:"TEAM", a:"center"},{l:"",    a:"left"},
              {l:"W-L",  a:"center"},{l:"PCT",  a:"center"},{l:"GB",  a:"center"},
              {l:"STRK", a:"center"},{l:"L10",  a:"center"},
            ].map((h,i) => (
              <div key={i} style={{
                fontFamily:FONT, fontSize:8, fontWeight:700,
                letterSpacing:"0.16em", textTransform:"uppercase" as const,
                color:"rgba(201,168,50,0.40)", textAlign:h.a as any,
              }}>{h.l}</div>
            ))}
          </div>
                    {standings.length > 0
            ? standings.map((row: Row, i: number) => <StandingsRow key={row.team_id ?? row.abbr ?? i} row={row} rank={i + 1} />)
            : [1,2,3,4,5].map(i => (
                <div key={i} style={{ height: 36, background: i % 2 === 0 ? ROW_BG : BG,
                  borderBottom: "1px solid rgba(0,0,0,0.4)",
                  display: "flex", alignItems: "center", padding: "0 8px" }}>
                  <div style={{ width: "60%", height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 2 }} />
                </div>
              ))
          }
        </div>

        {/* Center divider */}
        <div style={{ background: "#122016" }} />

        {/* RIGHT: Cardinals games */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <GameBlock game={currentGame} label="Current Game" />
          <div style={{ height: 1, background: "rgba(0,0,0,0.35)", margin: "2px 8px" }} />
          <GameBlock game={nextGame} label="Next Game" />
        </div>
      </div>

      {/* ── LED Ribbon Board ── */}
      <LedRibbonBoard stats={ribbonStats} loading={ribbonLoading} />
    </div>
  );
}
