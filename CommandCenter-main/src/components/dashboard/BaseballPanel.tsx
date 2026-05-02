import { useEffect, useState } from "react";

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

      {/* TEAM */}
      <div style={{
        background: "#0e1f14", border: `1px solid ${row.cards ? "rgba(232,168,32,0.35)" : "rgba(0,0,0,0.5)"}`,
        borderRadius: 3, boxShadow: "inset 0 2px 3px rgba(0,0,0,0.45)",
        padding: "2px 5px", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: row.cards ? 800 : 600,
          letterSpacing: "0.08em", textTransform: "uppercase" as const,
          color: row.cards ? GOLD : MUTED }}>{row.abbr}</span>
      </div>

      {/* W-L */}
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

      {/* PCT */}
      <div style={{ textAlign: "center" as const }}>
        <span style={{ fontFamily: FONT, fontSize: row.cards ? 11 : 10,
          fontWeight: row.cards ? 700 : 500, color: row.cards ? GOLD : "rgba(245,240,224,0.38)",
          fontVariantNumeric: "tabular-nums" as const }}>{row.pct}</span>
      </div>

      {/* GB — plain, no flip panel */}
      <div style={{ textAlign: "center" as const }}>
        <span style={{ fontFamily: FONT, fontSize: 10, color: "rgba(245,240,224,0.3)",
          fontVariantNumeric: "tabular-nums" as const }}>{row.gb}</span>
      </div>

      {/* STRK */}
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

      {/* L10 */}
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

      {/* STL + Opponent on same row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 20px 1fr", gap: 4, padding: "5px 8px 3px", alignItems: "center" }}>
        {/* STL tile */}
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

        {/* vs / @ */}
        <div style={{ fontFamily: FONT, fontSize: 8, color: DIM, textAlign: "center" as const }}>
          {!isFinal && !isLive ? (game.stl_is_home ? "vs" : "@") : ""}
        </div>

        {/* Opponent tile */}
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

      {/* Status / time row + venue */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "3px 8px 6px",
      }}>
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

// ─── Main export ─────────────────────────────────────────────────────────────
export function BaseballPanel() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const load = () =>
      fetch(`${API}/sports/mlb/cardinals`)
        .then(r => r.json())
        .then(setData)
        .catch(console.error);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const standings    = data?.nl_central    ?? [];
  const currentGame  = data?.current_game  ?? null;
  const nextGame     = data?.next_game     ?? null;

  // Derive today's date label for standings header
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 3px 1fr",
      background: BG, borderTop: "3px solid #122016",
    }}>

      {/* ── LEFT: NL Central Standings ── */}
      <div>
        <SBHead label={`NL Central Standings · ${today}`} />

        {/* Column headers */}
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

      {/* Divider */}
      <div style={{ background: "#122016" }} />

      {/* ── RIGHT: Cardinals ── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <SBHead label="St. Louis Cardinals" />
        <GameBlock game={currentGame} label="Current Game" />
        <div style={{ height: 1, background: "rgba(232,168,32,0.10)", margin: "0" }} />
        <GameBlock game={nextGame} label="Next Game" />
      </div>
    </div>
  );
}
