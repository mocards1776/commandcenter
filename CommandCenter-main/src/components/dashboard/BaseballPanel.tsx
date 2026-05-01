import { useState } from "react";

const CARD_BG   = "#162a1c";
const PANEL_BG  = "#1a3024";
const BORDER    = "rgba(232,168,32,0.18)";
const GOLD      = "#e8a820";
const DIM       = "rgba(245,240,224,0.22)";
const RED_COL   = "#c0392b";
const GREEN_COL = "#4caf50";
const LABEL_CSS: React.CSSProperties = {
  fontFamily: "'Oswald',Arial,sans-serif",
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: "0.15em",
  textTransform: "uppercase" as const,
  color: DIM,
};

type StandingsRow = {
  team: string;
  abbr: string;
  wl: string;
  pct: string;
  gb: string;
  strk: string;
  l10: string;
  isCardinals?: boolean;
};

const NL_CENTRAL: StandingsRow[] = [
  { team: "Cincinnati Reds",    abbr: "CIN", wl: "20-11", pct: ".645", gb: "—",  strk: "W2", l10: "7-3" },
  { team: "Chicago Cubs",       abbr: "CHC", wl: "19-12", pct: ".613", gb: "1.0", strk: "W1", l10: "6-4" },
  { team: "St. Louis Cardinals",abbr: "STL", wl: "18-13", pct: ".581", gb: "2.0", strk: "W3", l10: "7-3", isCardinals: true },
  { team: "Milwaukee Brewers",  abbr: "MIL", wl: "16-14", pct: ".533", gb: "3.5", strk: "L1", l10: "5-5" },
  { team: "Pittsburgh Pirates", abbr: "PIT", wl: "16-16", pct: ".500", gb: "4.5", strk: "L2", l10: "4-6" },
];

const COL_HEADER: React.CSSProperties = {
  ...LABEL_CSS,
  color: "rgba(232,168,32,0.45)",
  padding: "0 6px",
  textAlign: "center" as const,
};

function StrkBadge({ strk }: { strk: string }) {
  const win = strk.startsWith("W");
  return (
    <span style={{
      fontFamily: "'Oswald',Arial,sans-serif",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.06em",
      color: win ? GREEN_COL : RED_COL,
    }}>{strk}</span>
  );
}

function InningDiamond() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4, opacity: 0.5 }}>
      <rect x="2" y="2" width="6" height="6" rx="0.5" transform="rotate(45 5 5)" stroke={GOLD} strokeWidth="1" />
    </svg>
  );
}

export function BaseballPanel() {
  const [lastR1, setLastR1] = useState(10);
  const [lastR2, setLastR2] = useState(5);
  const [nextTime, setNextTime] = useState("7:15 PM");
  const [nextOpp, setNextOpp] = useState("Los Angeles Dodgers");
  const [nextHome, setNextHome] = useState(true); // true = home, false = away
  const [editing, setEditing] = useState(false);

  const cellNum: React.CSSProperties = {
    fontFamily: "'Oswald',Arial,sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    color: "rgba(245,240,224,0.75)",
    textAlign: "center" as const,
    padding: "0 6px",
    tabularNums: true,
  } as React.CSSProperties;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1px 1fr",
      background: CARD_BG,
      borderTop: `1px solid ${BORDER}`,
    }}>

      {/* ── LEFT: NL Central Standings ── */}
      <div style={{ padding: "12px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <InningDiamond />
          <span style={{ ...LABEL_CSS, color: GOLD, fontSize: 9, letterSpacing: "0.18em" }}>NL CENTRAL STANDINGS</span>
          <span style={{ ...LABEL_CSS, marginLeft: "auto", fontSize: 8, opacity: 0.4 }}>MAY 1, 2026</span>
        </div>

        {/* Header row */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "22px 1fr 52px 40px 40px 36px 36px",
          alignItems: "center",
          borderBottom: `1px solid ${BORDER}`,
          paddingBottom: 4,
          marginBottom: 2,
        }}>
          <span />
          <span style={COL_HEADER}>TEAM</span>
          <span style={{ ...COL_HEADER, textAlign: "center" }}>W-L</span>
          <span style={{ ...COL_HEADER }}>PCT</span>
          <span style={{ ...COL_HEADER }}>GB</span>
          <span style={{ ...COL_HEADER }}>STRK</span>
          <span style={{ ...COL_HEADER }}>L10</span>
        </div>

        {NL_CENTRAL.map((row, i) => (
          <div
            key={row.abbr}
            style={{
              display: "grid",
              gridTemplateColumns: "22px 1fr 52px 40px 40px 36px 36px",
              alignItems: "center",
              padding: "5px 0",
              borderBottom: i < NL_CENTRAL.length - 1 ? `1px solid rgba(232,168,32,0.07)` : "none",
              background: row.isCardinals ? "rgba(232,168,32,0.06)" : "transparent",
              borderRadius: row.isCardinals ? 2 : 0,
            }}
          >
            {/* Rank */}
            <span style={{ ...LABEL_CSS, color: row.isCardinals ? GOLD : DIM, fontWeight: row.isCardinals ? 700 : 500, fontSize: 9 }}>{i + 1}</span>

            {/* Team name */}
            <span style={{
              fontFamily: "'Oswald',Arial,sans-serif",
              fontSize: 11,
              fontWeight: row.isCardinals ? 700 : 500,
              letterSpacing: "0.06em",
              color: row.isCardinals ? GOLD : "rgba(245,240,224,0.8)",
              textTransform: "uppercase" as const,
            }}>
              {row.isCardinals && <span style={{ color: GOLD, marginRight: 4, fontSize: 8 }}>▶</span>}
              {row.abbr}
            </span>

            {/* W-L */}
            <span style={{ ...cellNum, fontWeight: row.isCardinals ? 700 : 500, color: row.isCardinals ? "rgba(245,240,224,0.9)" : "rgba(245,240,224,0.65)" }}>{row.wl}</span>

            {/* PCT */}
            <span style={{ ...cellNum, color: row.isCardinals ? GOLD : "rgba(245,240,224,0.55)" }}>{row.pct}</span>

            {/* GB */}
            <span style={{ ...cellNum, color: "rgba(245,240,224,0.45)" }}>{row.gb}</span>

            {/* STRK */}
            <span style={{ textAlign: "center" as const, padding: "0 6px" }}><StrkBadge strk={row.strk} /></span>

            {/* L10 */}
            <span style={{ ...cellNum, fontSize: 10, color: "rgba(245,240,224,0.45)" }}>{row.l10}</span>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ background: BORDER }} />

      {/* ── RIGHT: Cardinals Game Info ── */}
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <InningDiamond />
            <span style={{ ...LABEL_CSS, color: GOLD, fontSize: 9, letterSpacing: "0.18em" }}>ST. LOUIS CARDINALS</span>
          </div>
          <button
            onClick={() => setEditing(e => !e)}
            style={{
              background: "none", border: `1px solid ${BORDER}`, borderRadius: 2, cursor: "pointer",
              fontFamily: "'Oswald',Arial,sans-serif", fontSize: 8, letterSpacing: "0.12em",
              color: editing ? GOLD : DIM, padding: "2px 6px", textTransform: "uppercase" as const,
            }}
          >{editing ? "DONE" : "EDIT"}</button>
        </div>

        {/* Last Game */}
        <div style={{ background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "10px 12px" }}>
          <div style={{ ...LABEL_CSS, marginBottom: 8 }}>LAST GAME</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
            {/* Cardinals score */}
            <div style={{ textAlign: "center" as const }}>
              <div style={{
                fontFamily: "'Oswald',Arial,sans-serif", fontSize: 8, fontWeight: 600,
                letterSpacing: "0.14em", color: GOLD, textTransform: "uppercase" as const, marginBottom: 4,
              }}>STL</div>
              {editing ? (
                <input
                  type="number"
                  value={lastR1}
                  onChange={e => setLastR1(Number(e.target.value))}
                  style={{
                    width: 48, background: CARD_BG, border: `1px solid ${GOLD}`, borderRadius: 2,
                    color: GOLD, fontFamily: "'Oswald',Arial,sans-serif", fontSize: 28, fontWeight: 700,
                    textAlign: "center" as const, padding: "2px 4px",
                  }}
                />
              ) : (
                <div style={{
                  fontFamily: "'Oswald',Arial,sans-serif", fontSize: 32, fontWeight: 700,
                  color: lastR1 > lastR2 ? GOLD : "rgba(245,240,224,0.7)",
                  lineHeight: 1,
                }}>{lastR1}</div>
              )}
            </div>

            <div style={{
              fontFamily: "'Oswald',Arial,sans-serif", fontSize: 11, fontWeight: 600,
              color: "rgba(245,240,224,0.25)", letterSpacing: "0.1em",
            }}>FINAL</div>

            {/* Opponent score */}
            <div style={{ textAlign: "center" as const }}>
              <div style={{
                fontFamily: "'Oswald',Arial,sans-serif", fontSize: 8, fontWeight: 600,
                letterSpacing: "0.14em", color: "rgba(245,240,224,0.4)",
                textTransform: "uppercase" as const, marginBottom: 4,
              }}>PIT</div>
              {editing ? (
                <input
                  type="number"
                  value={lastR2}
                  onChange={e => setLastR2(Number(e.target.value))}
                  style={{
                    width: 48, background: CARD_BG, border: `1px solid rgba(232,168,32,0.3)`, borderRadius: 2,
                    color: "rgba(245,240,224,0.7)", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 28, fontWeight: 700,
                    textAlign: "center" as const, padding: "2px 4px",
                  }}
                />
              ) : (
                <div style={{
                  fontFamily: "'Oswald',Arial,sans-serif", fontSize: 32, fontWeight: 700,
                  color: lastR2 > lastR1 ? GOLD : "rgba(245,240,224,0.45)",
                  lineHeight: 1,
                }}>{lastR2}</div>
              )}
            </div>
          </div>
          <div style={{ ...LABEL_CSS, textAlign: "center" as const, marginTop: 6, opacity: 0.5 }}>
            {lastR1 > lastR2 ? "✓ WIN" : lastR1 < lastR2 ? "✗ LOSS" : "TIE"}
          </div>
        </div>

        {/* Next Game */}
        <div style={{ background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "10px 12px" }}>
          <div style={{ ...LABEL_CSS, marginBottom: 8 }}>NEXT GAME</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              background: "rgba(232,168,32,0.1)", border: `1px solid rgba(232,168,32,0.25)`,
              borderRadius: 2, padding: "3px 8px",
              fontFamily: "'Oswald',Arial,sans-serif", fontSize: 9, fontWeight: 700,
              color: GOLD, letterSpacing: "0.1em", textTransform: "uppercase" as const, whiteSpace: "nowrap" as const,
            }}>TODAY</div>
            {editing ? (
              <input
                value={nextTime}
                onChange={e => setNextTime(e.target.value)}
                style={{
                  background: CARD_BG, border: `1px solid ${GOLD}`, borderRadius: 2,
                  color: "rgba(245,240,224,0.9)", fontFamily: "'Oswald',Arial,sans-serif",
                  fontSize: 13, fontWeight: 600, padding: "2px 6px", width: 80,
                }}
              />
            ) : (
              <span style={{
                fontFamily: "'Oswald',Arial,sans-serif", fontSize: 15, fontWeight: 700,
                color: "rgba(245,240,224,0.9)", letterSpacing: "0.06em",
              }}>{nextTime}</span>
            )}
          </div>

          <div style={{ marginTop: 8 }}>
            {editing ? (
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                <input
                  value={nextOpp}
                  onChange={e => setNextOpp(e.target.value)}
                  style={{
                    background: CARD_BG, border: `1px solid rgba(232,168,32,0.3)`, borderRadius: 2,
                    color: "rgba(245,240,224,0.9)", fontFamily: "'Oswald',Arial,sans-serif",
                    fontSize: 12, padding: "3px 6px", width: "100%",
                  }}
                  placeholder="Opponent"
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={nextHome} onChange={e => setNextHome(e.target.checked)} style={{ accentColor: GOLD }} />
                  <span style={{ ...LABEL_CSS, cursor: "pointer" }}>Home game</span>
                </label>
              </div>
            ) : (
              <div>
                <div style={{
                  fontFamily: "'Oswald',Arial,sans-serif", fontSize: 13, fontWeight: 700,
                  color: "rgba(245,240,224,0.85)", letterSpacing: "0.06em", textTransform: "uppercase" as const,
                }}>
                  {nextHome ? "vs" : "@"} {nextOpp}
                </div>
                <div style={{ ...LABEL_CSS, marginTop: 3, opacity: 0.55 }}>
                  {nextHome ? "BUSCH STADIUM · ST. LOUIS, MO" : "AWAY"}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
