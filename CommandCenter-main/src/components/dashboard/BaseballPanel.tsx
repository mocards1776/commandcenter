import { useEffect, useState } from "react";

const BG        = "#243d28";
const ROW_BG    = "#1e3422";
const HEADER_BG = "#182c1c";
const PANEL     = "#111f14";
const GOLD      = "#c9a832";
const DIM       = "rgba(200,195,160,0.30)";
const MUTED     = "rgba(200,195,160,0.65)";
const FG        = "#d8d0b8";
const WIN_GRN   = "#3a9140";
const LOSS_RD   = "#c83030";
const FONT      = "'Oswald',Arial,sans-serif";

const STL_ID = 138;
const NL_CENTRAL_IDS = [112, 113, 138, 158, 134]; // CHC, CIN, STL, MIL, PIT

const ID_MAP: Record<number, [string, string]> = {
  112: ["CHC", "Cubs"],      113: ["CIN", "Reds"],       138: ["STL", "Cardinals"],
  158: ["MIL", "Brewers"],   134: ["PIT", "Pirates"],    137: ["SF", "Giants"],
  119: ["LAD", "Dodgers"],   135: ["SD", "Padres"],      109: ["ARI", "D-backs"],
  115: ["COL", "Rockies"],   144: ["ATL", "Braves"],     121: ["NYM", "Mets"],
  143: ["PHI", "Phillies"],  146: ["MIA", "Marlins"],    120: ["WSH", "Nats"],
  147: ["NYY", "Yankees"],   111: ["BOS", "Red Sox"],    141: ["TOR", "Blue Jays"],
  139: ["TB", "Rays"],       110: ["BAL", "Orioles"],    117: ["HOU", "Astros"],
  140: ["TEX", "Rangers"],   136: ["SEA", "Mariners"],   108: ["LAA", "Angels"],
  133: ["OAK", "Athletics"], 145: ["CHW", "White Sox"],  114: ["CLE", "Guardians"],
  116: ["DET", "Tigers"],    118: ["KC", "Royals"],       142: ["MIN", "Twins"],
};

const ID_MAP_REVERSE: Record<string, number> = Object.fromEntries(
  Object.entries(ID_MAP).map(([id, [abbr]]) => [abbr, Number(id)])
);

// ─── MLB Stats API helpers (public, no auth, CORS-safe) ─────────────────────

async function fetchStandings(): Promise<Row[]> {
  const url =
    "https://statsapi.mlb.com/api/v1/standings?leagueId=104&season=2026&standingsTypes=regularSeason&hydrate=team";
  const res = await fetch(url);
  const json = await res.json();

  const rows: Row[] = [];
  for (const record of json.records ?? []) {
    for (const tr of record.teamRecords ?? []) {
      const tid: number = tr.team?.id;
      if (!NL_CENTRAL_IDS.includes(tid)) continue;
      const wins   = tr.wins   ?? 0;
      const losses = tr.losses ?? 0;
      const gb     = tr.gamesBack ?? "0";
      const strk   = tr.streak?.streakCode ?? "";
      const last10 = tr.records?.splitRecords?.find((s: any) => s.type === "lastTen");
      rows.push({
        team_id: tid,
        wl:  `${wins}-${losses}`,
        pct: tr.winningPercentage ?? ".000",
        gb:  gb === "-" ? "0" : String(gb),
        strk,
        l10: last10 ? `${last10.wins}-${last10.losses}` : "",
        cards: tid === STL_ID,
      });
    }
  }

  rows.sort((a, b) => {
    const [aw, al] = a.wl.split("-").map(Number);
    const [bw, bl] = b.wl.split("-").map(Number);
    return bw !== aw ? bw - aw : al - bl;
  });

  return rows;
}

async function fetchCardinalsGames(): Promise<{ current_game: GameData | null; next_game: GameData | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${STL_ID}&startDate=${today}&endDate=${today}&hydrate=linescore,probablePitcher,team`;
  const res  = await fetch(url);
  const json = await res.json();

  const todayGames = json.dates?.[0]?.games ?? [];
  let current_game: GameData | null = null;

  if (todayGames.length > 0) {
    const g = todayGames[0];
    const isHome   = g.teams?.home?.team?.id === STL_ID;
    const opp      = isHome ? g.teams?.away : g.teams?.home;
    const oppId    = opp?.team?.id ?? 0;
    const [oppAbbr] = ID_MAP[oppId] ?? ["???", "Unknown"];
    const status   = g.status?.abstractGameState ?? "";
    const ls       = g.linescore ?? {};
    const stlTeam  = isHome ? g.teams?.home : g.teams?.away;
    const oppTeam  = isHome ? g.teams?.away : g.teams?.home;

    const gameTimeRaw: string | undefined = g.gameDate;
    let gameTimeFmt = "TBD";
    if (gameTimeRaw) {
      const d = new Date(gameTimeRaw);
      gameTimeFmt = d.toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
      }) + " CT";
    }

    current_game = {
      game_pk:      g.gamePk,
      status:       status === "Final" ? "Final" : status === "Live" ? "Live" : "Scheduled",
      is_home:      isHome,
      opp_name:     opp?.team?.teamName ?? "",
      opp_abbr:     oppAbbr,
      stl_score:    stlTeam?.score ?? null,
      opp_score:    oppTeam?.score ?? null,
      inning:       ls.currentInning ?? null,
      inning_half:  ls.inningHalf ?? null,
      outs:         ls.outs ?? null,
      balls:        ls.balls ?? null,
      strikes:      ls.strikes ?? null,
      stl_pitcher:  (isHome ? g.teams?.home : g.teams?.away)?.probablePitcher?.fullName ?? null,
      opp_pitcher:  (isHome ? g.teams?.away : g.teams?.home)?.probablePitcher?.fullName ?? null,
      game_time:    gameTimeFmt,
      venue:        g.venue?.name ?? null,
    };
  }

  let next_game: GameData | null = null;
  if (!current_game || current_game.status === "Final") {
    const start = new Date();
    start.setDate(start.getDate() + (current_game ? 1 : 0));
    const end   = new Date(start);
    end.setDate(end.getDate() + 7);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const nUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${STL_ID}&startDate=${fmt(start)}&endDate=${fmt(end)}&hydrate=probablePitcher,team`;
    const nRes  = await fetch(nUrl);
    const nJson = await nRes.json();
    const nextGames = nJson.dates?.[0]?.games ?? [];
    if (nextGames.length > 0) {
      const g      = nextGames[0];
      const isHome = g.teams?.home?.team?.id === STL_ID;
      const opp    = isHome ? g.teams?.away : g.teams?.home;
      const oppId  = opp?.team?.id ?? 0;
      const [oppAbbr] = ID_MAP[oppId] ?? ["???", "Unknown"];
      const gameTimeRaw: string | undefined = g.gameDate;
      let gameTimeFmt = "TBD";
      if (gameTimeRaw) {
        const d = new Date(gameTimeRaw);
        gameTimeFmt = d.toLocaleTimeString("en-US", {
          hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
        }) + " CT";
      }
      const dateLabel = gameTimeRaw
        ? new Date(gameTimeRaw).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" })
        : "";

      next_game = {
        game_pk:     g.gamePk,
        status:      "Scheduled",
        is_home:     isHome,
        opp_name:    opp?.team?.teamName ?? "",
        opp_abbr:    oppAbbr,
        stl_score:   null,
        opp_score:   null,
        stl_pitcher: (isHome ? g.teams?.home : g.teams?.away)?.probablePitcher?.fullName ?? null,
        opp_pitcher: (isHome ? g.teams?.away : g.teams?.home)?.probablePitcher?.fullName ?? null,
        game_time:   gameTimeFmt,
        venue:       g.venue?.name ?? null,
        date_label:  dateLabel,
      };
    }
  }

  return { current_game, next_game };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RibbonStat {
  label: string;
  value: string;
  valueColor: string;
  glowColor: string;
}

type Row = {
  abbr?: string; full?: string; teamName?: string; team_id?: number;
  wl: string; pct: string; gb: string; strk: string; l10: string; cards?: boolean;
};

interface GameData {
  game_pk?: number;
  status?: string;
  is_home?: boolean;
  opp_name?: string;
  opp_abbr?: string;
  stl_score?: number | null;
  opp_score?: number | null;
  inning?: number | null;
  inning_half?: string | null;
  outs?: number | null;
  balls?: number | null;
  strikes?: number | null;
  stl_pitcher?: string | null;
  opp_pitcher?: string | null;
  game_time?: string;
  venue?: string;
  date_label?: string;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

function PatrioticStripe({ height = 4 }: { height?: number }) {
  return (
    <div style={{
      height,
      background: "repeating-linear-gradient(90deg, #c41e3a 0px, #c41e3a 3px, #f5f0e0 3px, #f5f0e0 6px, #002868 6px, #002868 9px)",
      opacity: 0.85,
    }} />
  );
}

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
      <PatrioticStripe height={3} />
      <div style={{
        position: "relative",
        background: "linear-gradient(180deg, #0a0c14 0%, #060810 100%)",
        overflow: "hidden",
        height: 52,
        display: "flex", alignItems: "center",
      }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
          background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.14) 3px, rgba(0,0,0,0.14) 4px)",
        }} />
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
          background: "repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 5px)",
        }} />
        <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", width: "100%", height: "100%" }}>
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
          <div style={{ padding: "0 10px", flexShrink: 0 }}>
            <span style={{ fontFamily: "Arial,sans-serif", fontSize: 8, color: "#002868",
              textShadow: "0 0 4px rgba(0,40,104,0.8)", letterSpacing: "3px" }}>★★★</span>
          </div>
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
      <PatrioticStripe height={3} />
    </div>
  );
}

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

function StandingsRow({ row, rank }: { row: Row; rank: number }) {
  const win      = row.strk?.startsWith("W");
  const tid      = row.team_id as number;
  const abbr     = ID_MAP[tid]?.[0] ?? row.abbr ?? "???";
  const shortName = ID_MAP[tid]?.[1] ?? row.full ?? "";

  const statPanel = (content: React.ReactNode, gold = false) => (
    <div style={{
      background: PANEL,
      border: `1px solid ${gold ? "rgba(201,168,50,0.28)" : "rgba(0,0,0,0.55)"}`,
      borderRadius: 2,
      boxShadow: "inset 0 2px 5px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(255,255,255,0.03)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "2px 6px", minWidth: 38, height: 22,
    }}>{content}</div>
  );

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "18px 32px 1fr 54px 38px 52px 40px",
      alignItems: "center", gap: 4,
      padding: "4px 8px",
      background: row.cards ? "rgba(196,30,58,0.07)" : rank % 2 === 0 ? BG : ROW_BG,
      borderBottom: "1px solid rgba(0,0,0,0.3)",
      borderLeft: row.cards ? "2px solid rgba(196,30,58,0.6)" : "2px solid transparent",
    }}>
      <span style={{ fontFamily: FONT, fontSize: 9, color: DIM, textAlign: "center" }}>{rank}</span>
      {statPanel(<span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 800,
        color: row.cards ? "#c41e3a" : GOLD, letterSpacing: "0.05em" }}>{abbr}</span>, row.cards)}
      <span style={{ fontFamily: FONT, fontSize: 9, color: row.cards ? FG : MUTED,
        fontWeight: row.cards ? 700 : 400, whiteSpace: "nowrap" as const, overflow: "hidden",
        textOverflow: "ellipsis" }}>{shortName}</span>
      {statPanel(<span style={{ fontFamily: FONT, fontSize: 11, color: row.cards ? GOLD : FG,
        fontWeight: row.cards ? 700 : 400 }}>{row.wl}</span>)}
      {statPanel(<span style={{ fontFamily: FONT, fontSize: 10, color: MUTED }}>{row.pct}</span>)}
      {statPanel(<span style={{ fontFamily: FONT, fontSize: 10, color: DIM }}>{row.gb === "0" || row.gb === "0.0" ? "—" : row.gb}</span>)}
      {statPanel(
        <span style={{ fontFamily: FONT, fontSize: 10,
          color: win ? WIN_GRN : LOSS_RD,
          textShadow: win ? "0 0 6px rgba(58,145,64,0.5)" : "0 0 6px rgba(200,48,48,0.4)" }}>
          {row.strk || "—"}
        </span>
      )}
    </div>
  );
}

function GameBlock({ game, label }: { game: GameData; label: string }) {
  if (!game) return null;
  const isFinal  = game.status === "Final";
  const isLive   = game.status === "Live";
  const hasScore = game.stl_score != null && game.opp_score != null;
  const stlWin   = hasScore && isFinal && (game.stl_score! > game.opp_score!);
  const stlLoss  = hasScore && isFinal && (game.stl_score! < game.opp_score!);

  return (
    <div>
      <SBHead label={label} />
      <div style={{ padding: "6px 8px", background: BG }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: FONT, fontSize: 9, color: MUTED }}>
              {game.is_home ? "VS" : "@"}
            </span>
            <img
              src={`https://www.mlbstatic.com/team-logos/${ID_MAP_REVERSE[game.opp_abbr ?? ""] ?? 0}.svg`}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              width={20} height={20}
              style={{ objectFit: "contain" }}
              alt=""
            />
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: FG }}>
              {game.opp_abbr} {game.opp_name}
            </span>
          </div>
          <span style={{
            fontFamily: FONT, fontSize: 9, fontWeight: 700,
            color: isLive ? "#4ade80" : isFinal ? (stlWin ? WIN_GRN : stlLoss ? LOSS_RD : MUTED) : MUTED,
            textShadow: isLive ? "0 0 8px rgba(74,222,128,0.6)" : "none",
            letterSpacing: "0.1em",
          }}>
            {isLive ? `▶ ${game.inning_half?.toUpperCase() ?? ""} ${game.inning ?? ""}` : game.status}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          {hasScore ? (
            <>
              <FlipCell value={game.stl_score!} sub="STL"
                color={isFinal ? (stlWin ? "green" : stlLoss ? "red" : "white") : "gold"} />
              <div style={{ fontFamily: FONT, fontSize: 18, color: DIM, marginBottom: 12 }}>–</div>
              <FlipCell value={game.opp_score!} sub={game.opp_abbr ?? "OPP"}
                color={isFinal ? (stlLoss ? "green" : stlWin ? "red" : "white") : "white"} />
            </>
          ) : (
            <div style={{ flex: 1 }}>
              {game.date_label && (
                <div style={{ fontFamily: FONT, fontSize: 9, color: DIM, marginBottom: 2 }}>{game.date_label}</div>
              )}
              <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: GOLD, letterSpacing: "0.04em" }}>
                {game.game_time ?? "TBD"}
              </div>
              {game.venue && (
                <div style={{ fontFamily: FONT, fontSize: 8, color: DIM, marginTop: 2 }}>{game.venue}</div>
              )}
            </div>
          )}

          {isLive && game.balls != null && (
            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <FlipCell value={`${game.balls}-${game.strikes}`} sub="B-S" color="muted" small />
              <FlipCell value={`${game.outs} OUT`} sub="" color="muted" small />
            </div>
          )}
        </div>

        {(game.stl_pitcher || game.opp_pitcher) && (
          <div style={{ marginTop: 4, display: "flex", gap: 12 }}>
            {game.stl_pitcher && (
              <span style={{ fontFamily: FONT, fontSize: 8, color: DIM }}>STL: {game.stl_pitcher}</span>
            )}
            {game.opp_pitcher && (
              <span style={{ fontFamily: FONT, fontSize: 8, color: DIM }}>{game.opp_abbr}: {game.opp_pitcher}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SEED_STATS: RibbonStat[] = [
  { label: "Proj Wins",    value: "—", valueColor: GOLD,      glowColor: "rgba(201,168,50,0.4)" },
  { label: "Playoffs",     value: "—", valueColor: "#c41e3a", glowColor: "rgba(196,30,58,0.4)" },
  { label: "NL Central",   value: "—", valueColor: "#f5f0e0", glowColor: "rgba(245,240,224,0.3)" },
  { label: "Wild Card",    value: "—", valueColor: "#4ade80", glowColor: "rgba(74,222,128,0.3)" },
  { label: "World Series", value: "—", valueColor: "#60a5fa", glowColor: "rgba(96,165,250,0.3)" },
];

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function BaseballPanel() {
  const [standings,    setStandings]    = useState<Row[]>([]);
  const [currentGame,  setCurrentGame]  = useState<GameData | null>(null);
  const [nextGame,     setNextGame]     = useState<GameData | null>(null);
  const [standingsErr, setStandingsErr] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await fetchStandings();
        setStandings(rows);
        setStandingsErr(false);
      } catch (err) {
        console.error("[BaseballPanel] standings fetch failed:", err);
        setStandingsErr(true);
      }

      try {
        const { current_game, next_game } = await fetchCardinalsGames();
        setCurrentGame(current_game);
        setNextGame(next_game);
      } catch (err) {
        console.error("[BaseballPanel] schedule fetch failed:", err);
      }
    };

    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ fontFamily: FONT, background: BG, borderRadius: 6, overflow: "hidden",
      border: "1px solid rgba(232,168,32,0.15)" }}>

      {/* ── Two-column body: standings LEFT, Cardinals games RIGHT ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>

        {/* LEFT — NL Central Standings */}
        <div style={{ borderRight: "1px solid rgba(232,168,32,0.12)" }}>
          <SBHead label="NL Central Standings" />
          <div style={{ background: BG }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "18px 32px 1fr 54px 38px 52px 40px",
              gap: 4, padding: "3px 8px",
              background: HEADER_BG,
              borderBottom: "1px solid rgba(232,168,32,0.1)",
            }}>
              {["#", "", "Team", "W-L", "PCT", "GB", "STRK"].map((h, i) => (
                <span key={i} style={{ fontFamily: FONT, fontSize: 7, fontWeight: 700,
                  letterSpacing: "0.12em", color: DIM, textAlign: i === 0 ? "center" : "left" as any }}>{h}</span>
              ))}
            </div>
            {standings.length > 0 ? (
              standings.map((row, i) => (
                <StandingsRow key={row.team_id ?? i} row={row} rank={i + 1} />
              ))
            ) : (
              <div style={{ padding: "12px 8px", fontFamily: FONT, fontSize: 9, color: DIM, textAlign: "center" }}>
                {standingsErr ? "Failed to load standings" : "Loading standings…"}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Cardinals game(s) */}
        <div>
          {currentGame && <GameBlock game={currentGame} label="Today's Game" />}
          {nextGame    && <GameBlock game={nextGame}    label="Next Game" />}
          {!currentGame && !nextGame && (
            <div style={{ padding: "12px 8px", fontFamily: FONT, fontSize: 9, color: DIM, textAlign: "center" }}>
              Loading schedule…
            </div>
          )}
        </div>

      </div>

      <LedRibbonBoard stats={SEED_STATS} loading={false} />
    </div>
  );
}

export default BaseballPanel;
