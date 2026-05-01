import { useState } from "react";

// ─── Design tokens (match the dashboard exactly) ───────────────────────────
const BG        = "#162a1c";
const ROW_BG    = "#1e3629";
const PANEL_BG  = "#162a1c";
const HEADER_BG = "#122016";
const GOLD      = "#e8a820";
const DIM       = "rgba(245,240,224,0.22)";
const MUTED     = "rgba(245,240,224,0.55)";
const LABEL: React.CSSProperties = {
  fontFamily: "'Oswald',Arial,sans-serif",
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: "0.15em",
  textTransform: "uppercase" as const,
  color: DIM,
};

// ─── Flip panel (same style as scoreboard cells) ───────────────────────────
function FlipCell({
  value, sub, color = "empty", small = false,
}: {
  value: string | number;
  sub?: string;
  color?: "gold" | "white" | "muted" | "empty" | "red" | "green";
  small?: boolean;
}) {
  const c =
    color === "gold"  ? GOLD
    : color === "red"   ? "#d94040"
    : color === "green" ? "#4caf50"
    : color === "white" ? "#f5f0e0"
    : color === "muted" ? MUTED
    : "rgba(255,255,255,0.12)";
  const v = String(value);
  const fs = v.length > 5 ? 11 : v.length > 3 ? 15 : small ? 18 : 22;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <div className="panel" style={{
        width: small ? 44 : 52, height: small ? 40 : 48,
        boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)",
      }}>
        <span className="panel-num" style={{ fontSize: fs, color: c }}>{v}</span>
      </div>
      {sub && <div className="panel-sub" style={{ fontSize: 7 }}>{sub}</div>}
    </div>
  );
}

// ─── Standings data ────────────────────────────────────────────────────────
type Row = { abbr: string; full: string; wl: string; pct: string; gb: string; strk: string; l10: string; cards?: boolean };

const STANDINGS: Row[] = [
  { abbr:"CIN", full:"Cincinnati Reds",     wl:"20-11", pct:".645", gb:"\u2014",  strk:"W2", l10:"7-3" },
  { abbr:"CHC", full:"Chicago Cubs",         wl:"19-12", pct:".613", gb:"1.0",   strk:"W1", l10:"6-4" },
  { abbr:"STL", full:"St. Louis Cardinals",  wl:"18-13", pct:".581", gb:"2.0",   strk:"W3", l10:"7-3", cards:true },
  { abbr:"MIL", full:"Milwaukee Brewers",    wl:"16-14", pct:".533", gb:"3.5",   strk:"L1", l10:"5-5" },
  { abbr:"PIT", full:"Pittsburgh Pirates",   wl:"16-16", pct:".500", gb:"4.5",   strk:"L2", l10:"4-6" },
];

// ─── Section header (matches sb-header style) ─────────────────────────────
function SBHead({ label }: { label: string }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr",
      background: HEADER_BG,
      borderBottom: "2px solid #122016",
      borderTop: "2px solid #122016",
      padding: "3px 0",
    }}>
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.18em",
        textTransform: "uppercase" as const,
        color: "rgba(232,168,32,0.55)",
        textAlign: "center" as const,
        padding: "1px 0",
      }}>{label}</div>
    </div>
  );
}

// ─── Column header row ─────────────────────────────────────────────────────
function ColHead({ cols }: { cols: string[] }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: cols.length === 7 ? "18px 60px 1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr",
      background: HEADER_BG,
      borderBottom: "1px solid rgba(18,32,22,0.8)",
      padding: "2px 8px",
    }}>
      {cols.map((c, i) => (
        <div key={i} style={{
          ...LABEL,
          color: "rgba(232,168,32,0.35)",
          textAlign: i === 1 ? "left" as const : "center" as const,
          padding: "1px 2px",
        }}>{c}</div>
      ))}
    </div>
  );
}

// ─── Standings row ─────────────────────────────────────────────────────────
function StandingsRow({ row, rank }: { row: Row; rank: number }) {
  const strkWin = row.strk.startsWith("W");
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "18px 60px 1fr 1fr 1fr 1fr 1fr",
      alignItems: "center",
      background: row.cards ? "rgba(232,168,32,0.05)" : (rank % 2 === 0 ? ROW_BG : BG),
      borderBottom: "1px solid rgba(18,32,22,0.7)",
      padding: "4px 8px",
      minHeight: 40,
    }}>
      {/* Rank */}
      <span style={{ ...LABEL, color: row.cards ? GOLD : "rgba(245,240,224,0.2)", fontSize: 9 }}>{rank}</span>

      {/* Team name tile */}
      <div style={{
        background: PANEL_BG,
        border: `1px solid ${row.cards ? "rgba(232,168,32,0.3)" : "rgba(0,0,0,0.4)"}`,
        borderRadius: 3,
        boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.03)",
        padding: "3px 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 30,
      }}>
        <span style={{
          fontFamily: "'Oswald',Arial,sans-serif",
          fontSize: 10,
          fontWeight: row.cards ? 800 : 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: row.cards ? GOLD : MUTED,
        }}>{row.abbr}</span>
      </div>

      {/* W-L tile */}
      <div style={{ display:"flex", justifyContent:"center" }}>
        <div style={{
          background: PANEL_BG,
          border: "1px solid rgba(0,0,0,0.4)",
          borderRadius: 3,
          boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4)",
          padding: "3px 5px",
          minWidth: 42,
          textAlign: "center" as const,
        }}>
          <span style={{
            fontFamily: "'Oswald',Arial,sans-serif",
            fontSize: row.cards ? 12 : 11,
            fontWeight: row.cards ? 800 : 600,
            letterSpacing: "0.04em",
            color: row.cards ? "#f5f0e0" : "rgba(245,240,224,0.6)",
            fontVariantNumeric: "tabular-nums" as const,
          }}>{row.wl}</span>
        </div>
      </div>

      {/* PCT */}
      <div style={{ display:"flex", justifyContent:"center" }}>
        <div style={{
          background: PANEL_BG, border: "1px solid rgba(0,0,0,0.4)", borderRadius: 3,
          boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4)",
          padding: "3px 5px", minWidth: 36, textAlign: "center" as const,
        }}>
          <span style={{
            fontFamily: "'Oswald',Arial,sans-serif",
            fontSize: row.cards ? 12 : 10,
            fontWeight: row.cards ? 700 : 500,
            color: row.cards ? GOLD : "rgba(245,240,224,0.4)",
            fontVariantNumeric: "tabular-nums" as const,
          }}>{row.pct}</span>
        </div>
      </div>

      {/* GB */}
      <div style={{ textAlign: "center" as const }}>
        <span style={{ ...LABEL, fontSize: 10, color: "rgba(245,240,224,0.3)" }}>{row.gb}</span>
      </div>

      {/* STRK */}
      <div style={{ display:"flex", justifyContent:"center" }}>
        <div style={{
          background: PANEL_BG, border: `1px solid ${strkWin ? "rgba(76,175,80,0.2)" : "rgba(217,64,64,0.2)"}`,
          borderRadius: 3, boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4)",
          padding: "3px 5px", minWidth: 28, textAlign: "center" as const,
        }}>
          <span style={{
            fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 700,
            letterSpacing: "0.06em",
            color: strkWin ? "#4caf50" : "#d94040",
          }}>{row.strk}</span>
        </div>
      </div>

      {/* L10 */}
      <div style={{ display:"flex", justifyContent:"center" }}>
        <div style={{
          background: PANEL_BG, border: "1px solid rgba(0,0,0,0.4)", borderRadius: 3,
          boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4)",
          padding: "3px 5px", minWidth: 28, textAlign: "center" as const,
        }}>
          <span style={{
            fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 500,
            color: "rgba(245,240,224,0.35)",
          }}>{row.l10}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Score display (big flip-panel style) ─────────────────────────────────
function ScoreRow({ team, abbr, score, isWinner, editing, onScoreChange }: {
  team: string; abbr: string; score: number; isWinner: boolean;
  editing: boolean; onScoreChange: (v: number) => void;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto",
      alignItems: "center", gap: 8,
      background: isWinner ? "rgba(232,168,32,0.05)" : "transparent",
      padding: "6px 12px",
      borderBottom: "1px solid rgba(18,32,22,0.8)",
    }}>
      {/* Team name tile */}
      <div style={{
        background: PANEL_BG,
        border: `1px solid ${isWinner ? "rgba(232,168,32,0.3)" : "rgba(0,0,0,0.4)"}`,
        borderRadius: 3,
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.04)",
        padding: "6px 10px",
        minHeight: 36,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{
          fontFamily: "'Oswald',Arial,sans-serif",
          fontSize: 11, fontWeight: isWinner ? 800 : 600, letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: isWinner ? GOLD : MUTED,
        }}>{abbr} · {team}</span>
      </div>

      {/* Score flip cell */}
      {editing ? (
        <input type="number" value={score} onChange={e => onScoreChange(Number(e.target.value))}
          style={{
            width: 52, height: 48, background: PANEL_BG,
            border: `1px solid ${isWinner ? GOLD : "rgba(0,0,0,0.4)"}`,
            borderRadius: 3, boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55)",
            color: isWinner ? GOLD : MUTED,
            fontFamily: "'Oswald',Arial,sans-serif", fontSize: 22, fontWeight: 700,
            textAlign: "center" as const, padding: "2px 4px",
          }}
        />
      ) : (
        <FlipCell value={score} color={isWinner ? "gold" : "empty"} />
      )}
    </div>
  );
}

// ─── Next game display ─────────────────────────────────────────────────────
function NextGameRow({ label, value, editing, onChange }: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 6, alignItems: "center", padding: "4px 8px" }}>
      <span style={{ ...LABEL, color: "rgba(232,168,32,0.35)", textAlign: "right" as const }}>{label}</span>
      {editing ? (
        <input value={value} onChange={e => onChange(e.target.value)}
          style={{
            background: PANEL_BG, border: "1px solid rgba(232,168,32,0.3)", borderRadius: 3,
            color: "#f5f0e0", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 11,
            fontWeight: 600, letterSpacing: "0.04em", padding: "3px 7px", width: "100%",
          }}
        />
      ) : (
        <div style={{
          background: PANEL_BG, border: "1px solid rgba(0,0,0,0.4)", borderRadius: 3,
          boxShadow: "inset 0 2px 3px rgba(0,0,0,0.4)",
          padding: "4px 8px", minHeight: 28, display: "flex", alignItems: "center",
        }}>
          <span style={{
            fontFamily: "'Oswald',Arial,sans-serif", fontSize: 11, fontWeight: 600,
            letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "#f5f0e0",
          }}>{value}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────
export function BaseballPanel() {
  const [lastR1, setLastR1]     = useState(10);
  const [lastR2, setLastR2]     = useState(5);
  const [lastOpp, setLastOpp]   = useState("Pirates");
  const [nextTime, setNextTime] = useState("7:15 PM CDT");
  const [nextOpp, setNextOpp]   = useState("Dodgers");
  const [nextVenue, setNextVenue] = useState("Busch Stadium · St. Louis, MO");
  const [nextDate, setNextDate] = useState("Today · May 1");
  const [editing, setEditing]   = useState(false);

  const cardsWon = lastR1 > lastR2;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 3px 1fr",
      background: BG,
      borderTop: "3px solid #122016",
    }}>

      {/* ── LEFT: NL Central Standings ── */}
      <div>
        <SBHead label="NL Central Standings · May 1, 2026" />
        <ColHead cols={["", "TEAM", "W-L", "PCT", "GB", "STRK", "L10"]} />
        {STANDINGS.map((row, i) => <StandingsRow key={row.abbr} row={row} rank={i + 1} />)}
      </div>

      {/* Divider */}
      <div style={{ background: "#122016" }} />

      {/* ── RIGHT: Cardinals game info ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: HEADER_BG }}>
          <div style={{ flex: 1 }}>
            <SBHead label="St. Louis Cardinals" />
          </div>
          <button
            onClick={() => setEditing(e => !e)}
            style={{
              background: "none", border: `1px solid ${editing ? GOLD : "rgba(232,168,32,0.15)"}`,
              borderRadius: 3, cursor: "pointer", marginRight: 8,
              fontFamily: "'Oswald',Arial,sans-serif", fontSize: 8, letterSpacing: "0.12em",
              color: editing ? GOLD : DIM, padding: "2px 7px", textTransform: "uppercase" as const,
            }}
          >{editing ? "DONE" : "EDIT"}</button>
        </div>

        {/* Last game */}
        <SBHead label="Last Game — Final" />
        <ScoreRow
          team="Cardinals" abbr="STL" score={lastR1} isWinner={cardsWon}
          editing={editing} onScoreChange={setLastR1}
        />
        {editing ? (
          <div style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...LABEL, color: "rgba(232,168,32,0.35)" }}>OPP</span>
            <input value={lastOpp} onChange={e => setLastOpp(e.target.value)}
              style={{
                background: PANEL_BG, border: "1px solid rgba(232,168,32,0.3)", borderRadius: 3,
                color: "#f5f0e0", fontFamily: "'Oswald',Arial,sans-serif",
                fontSize: 11, padding: "3px 7px",
              }}
            />
          </div>
        ) : null}
        <ScoreRow
          team={lastOpp} abbr={lastOpp.slice(0, 3).toUpperCase()} score={lastR2} isWinner={!cardsWon}
          editing={editing} onScoreChange={setLastR2}
        />

        {/* Result badge */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "5px 0", background: ROW_BG, borderBottom: "1px solid #122016",
          gap: 8,
        }}>
          <div className="panel panel-sm" style={{ width: 36, height: 30 }}>
            <span style={{
              fontFamily: "'Oswald',Arial,sans-serif", fontSize: 14, fontWeight: 800,
              color: cardsWon ? "#4caf50" : "#d94040",
            }}>{cardsWon ? "W" : "L"}</span>
          </div>
          <span style={{ ...LABEL, fontSize: 9, color: cardsWon ? "rgba(76,175,80,0.7)" : "rgba(217,64,64,0.7)" }}>
            {cardsWon ? `Cardinals win ${lastR1}-${lastR2}` : `Cardinals fall ${lastR1}-${lastR2}`}
          </span>
        </div>

        {/* Next game */}
        <SBHead label="Next Game" />
        <div style={{ padding: "4px 0 8px" }}>
          <NextGameRow label="DATE" value={nextDate} editing={editing} onChange={setNextDate} />
          <NextGameRow label="TIME" value={nextTime} editing={editing} onChange={setNextTime} />
          <NextGameRow label="OPP" value={`vs ${nextOpp}`} editing={editing} onChange={v => setNextOpp(v.replace(/^vs\s*/i, ""))} />
          <NextGameRow label="VENUE" value={nextVenue} editing={editing} onChange={setNextVenue} />
        </div>
      </div>
    </div>
  );
}
