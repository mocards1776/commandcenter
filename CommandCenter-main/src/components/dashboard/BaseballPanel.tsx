import { useEffect, useState } from "react";

const API       = (import.meta as any).env?.VITE_API_URL ?? "https://orca-app-v7oew.ondigitalocean.app";
const BG        = "#111d14";          // matches scoreboard panel bg
const ROW_BG    = "#172219";          // alternating row — just a hair lighter
const HEADER_BG = "#0c1810";          // section header, darkest
const GOLD      = "#c9a832";          // Cardinals gold — matches reference screenshot
const DIM       = "rgba(210,200,170,0.28)";
const MUTED     = "rgba(210,200,170,0.60)";
const FG        = "#ddd8c4";          // off-white cream text
const WIN_GRN   = "#4db858";          // STRK green — matches reference badge
const LOSS_RD   = "#d94040";
const FONT      = "'Oswald',Arial,sans-serif";

const LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: 8, fontWeight: 700,
  letterSpacing: "0.15em", textTransform: "uppercase", color: DIM,
};

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
type Row = { abbr: string; wl: string; pct: string; gb: string; strk: string; l10: string; cards?: boolean };

// Full team name map
const TEAM_NAMES: Record<string, string> = {
  STL: "Cardinals", MIL: "Brewers", CHC: "Cubs", CIN: "Reds", PIT: "Pirates",
  LAD: "Dodgers", SF: "Giants", SD: "Padres", ARI: "D-backs", COL: "Rockies",
  ATL: "Braves", NYM: "Mets", PHI: "Phillies", MIA: "Marlins", WSH: "Nationals",
  NYY: "Yankees", BOS: "Red Sox", TOR: "Blue Jays", TB: "Rays", BAL: "Orioles",
  HOU: "Astros", TEX: "Rangers", SEA: "Mariners", LAA: "Angels", OAK: "Athletics",
  CHW: "White Sox", CLE: "Guardians", DET: "Tigers", KC: "Royals", MIN: "Twins",
};

function StandingsRow({ row, rank }: { row: Row; rank: number }) {
  const win = row.strk?.startsWith("W");
  const teamName = TEAM_NAMES[row.abbr] ?? row.abbr;

  // Flip-panel style box used for W-L
  const Panel = ({ children, highlight = false }: { children: React.ReactNode; highlight?: boolean }) => (
    <div style={{
      background: "#090f0b",
      border: `1px solid ${highlight ? "rgba(201,168,50,0.3)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 2,
      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.03)",
      padding: "3px 7px",
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 26,
    }}>{children}</div>
  );

  return (
    <div style={{
      display: "grid",
      // rank | team-abbr+name (flex) | W-L | PCT | GB | STRK | L10
      gridTemplateColumns: "20px 1fr 64px 42px 36px 48px 36px",
      alignItems: "center",
      padding: "4px 10px 4px 6px",
      gap: "0 6px",
      background: row.cards
        ? `linear-gradient(90deg, rgba(201,168,50,0.07) 0%, rgba(201,168,50,0.03) 100%)`
        : rank % 2 === 0 ? ROW_BG : BG,
      borderBottom: "1px solid rgba(0,0,0,0.4)",
      borderLeft: row.cards ? "2px solid rgba(201,168,50,0.5)" : "2px solid transparent",
      minHeight: 40,
    }}>

      {/* Rank */}
      <span style={{
        fontFamily: FONT, fontSize: 10, fontWeight: 700,
        color: row.cards ? GOLD : DIM,
        textAlign: "center" as const,
      }}>{rank}</span>

      {/* Team — abbr + full name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Panel highlight={row.cards}>
          <span style={{
            fontFamily: FONT, fontSize: 11, fontWeight: row.cards ? 900 : 700,
            letterSpacing: "0.1em", textTransform: "uppercase" as const,
            color: row.cards ? GOLD : MUTED,
            whiteSpace: "nowrap" as const,
          }}>{row.abbr}</span>
        </Panel>
        <span style={{
          fontFamily: FONT, fontSize: 11, fontWeight: row.cards ? 700 : 500,
          letterSpacing: "0.06em", textTransform: "uppercase" as const,
          color: row.cards ? FG : "rgba(210,200,170,0.45)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
        }}>{teamName}</span>
      </div>

      {/* W-L — flip panel */}
      <Panel highlight={row.cards}>
        <span style={{
          fontFamily: FONT, fontSize: row.cards ? 13 : 12,
          fontWeight: row.cards ? 900 : 700,
          color: row.cards ? FG : "rgba(210,200,170,0.7)",
          fontVariantNumeric: "tabular-nums" as const,
          letterSpacing: "0.04em",
        }}>{row.wl}</span>
      </Panel>

      {/* PCT */}
      <div style={{ textAlign: "center" as const }}>
        <span style={{
          fontFamily: FONT, fontSize: row.cards ? 12 : 11,
          fontWeight: row.cards ? 700 : 500,
          color: row.cards ? GOLD : "rgba(210,200,170,0.42)",
          fontVariantNumeric: "tabular-nums" as const,
        }}>{row.pct}</span>
      </div>

      {/* GB */}
      <div style={{ textAlign: "center" as const }}>
        <span style={{
          fontFamily: FONT, fontSize: 11,
          color: "rgba(210,200,170,0.30)",
          fontVariantNumeric: "tabular-nums" as const,
        }}>{row.gb}</span>
      </div>

      {/* STRK — flip-panel badge, scoreboard style */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          background: win ? "rgba(30,80,36,0.55)" : "rgba(100,20,20,0.45)",
          border: `1px solid ${win ? "rgba(77,184,88,0.35)" : "rgba(217,64,64,0.35)"}`,
          borderRadius: 2,
          boxShadow: win
            ? "inset 0 1px 3px rgba(0,0,0,0.5), 0 0 6px rgba(77,184,88,0.12)"
            : "inset 0 1px 3px rgba(0,0,0,0.5), 0 0 6px rgba(217,64,64,0.08)",
          padding: "3px 8px", minWidth: 34, textAlign: "center" as const,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 12, fontWeight: 800, letterSpacing: "0.06em",
            color: win ? WIN_GRN : LOSS_RD,
            textShadow: win ? `0 0 8px rgba(77,184,88,0.5)` : `0 0 8px rgba(217,64,64,0.4)`,
          }}>{row.strk}</span>
        </div>
      </div>

      {/* L10 — right-justified */}
      <div style={{ textAlign: "right" as const }}>
        <span style={{
          fontFamily: FONT, fontSize: 11,
          color: "rgba(210,200,170,0.38)",
          fontVariantNumeric: "tabular-nums" as const,
        }}>{row.l10}</span>
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
