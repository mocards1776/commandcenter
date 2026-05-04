import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sportsApi } from "@/lib/api";
import { Trophy, X, RefreshCw, Star, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FavoriteSportsTeam } from "@/types";
import toast from "react-hot-toast";
import axios from "axios";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

const SPORTS = [
  { id: "mlb",  label: "MLB",  espnSport: "baseball/mlb",   emoji: "⚾" },
  { id: "nfl",  label: "NFL",  espnSport: "football/nfl",   emoji: "🏈" },
  { id: "nba",  label: "NBA",  espnSport: "basketball/nba", emoji: "🏀" },
  { id: "nhl",  label: "NHL",  espnSport: "hockey/nhl",     emoji: "🏒" },
];

// Cardinals team ID in MLB Stats API
const CARDINALS_ID = 138;
const NL_CENTRAL_IDS = [112, 113, 134, 138, 158]; // Cubs, Reds, Pirates, Cardinals, Brewers

// ─── NL Central Standings ───────────────────────────────────────────────────

function NlCentralStandings() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["nl-central-standings"],
    queryFn: () =>
      axios
        .get(`${MLB_API}/standings`, {
          params: { leagueId: 104, season: new Date().getFullYear(), standingsTypes: "regularSeason", hydrate: "team" },
        })
        .then((r) => {
          const records: any[] = r.data?.records ?? [];
          const nlCentral = records.find((div: any) => div.division?.id === 205);
          return nlCentral?.teamRecords ?? [];
        }),
    staleTime: 300_000,
    refetchInterval: 300_000,
  });

  return (
    <div className="rounded-2xl border border-[#2a2a45] bg-[#0d0d1f] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2">
          <span>🏆</span> NL Central Standings
        </h3>
        <button
          onClick={() => refetch()}
          className={cn("p-1.5 rounded-lg hover:bg-[#1a1a2e] text-slate-500 hover:text-white transition-all", isRefetching && "animate-spin")}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : !data?.length ? (
        <p className="text-sm text-slate-600 text-center py-3">No standings data</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-[#2a2a45]">
              <th className="text-left py-1.5 font-semibold">Team</th>
              <th className="text-center py-1.5 font-semibold">W</th>
              <th className="text-center py-1.5 font-semibold">L</th>
              <th className="text-center py-1.5 font-semibold">PCT</th>
              <th className="text-center py-1.5 font-semibold">GB</th>
              <th className="text-center py-1.5 font-semibold">STRK</th>
            </tr>
          </thead>
          <tbody>
            {data.map((rec: any, i: number) => {
              const isCards = rec.team?.id === CARDINALS_ID;
              return (
                <tr
                  key={rec.team?.id}
                  className={cn(
                    "border-b border-[#1a1a2e] transition-colors",
                    isCards ? "bg-[#1a0a0a]" : i % 2 === 0 ? "" : "bg-[#0d0d1f]"
                  )}
                >
                  <td className="py-2 flex items-center gap-2">
                    {i === 0 && <span className="text-amber-400 text-xs font-bold">★</span>}
                    <span className={cn("font-semibold", isCards ? "text-red-400" : "text-slate-200")}>
                      {rec.team?.teamName ?? rec.team?.name}
                    </span>
                  </td>
                  <td className="text-center py-2 tabular-nums text-slate-300">{rec.wins}</td>
                  <td className="text-center py-2 tabular-nums text-slate-300">{rec.losses}</td>
                  <td className="text-center py-2 tabular-nums text-slate-400">{rec.winningPercentage}</td>
                  <td className="text-center py-2 tabular-nums text-slate-400">{rec.gamesBack === "0.0" ? "—" : rec.gamesBack}</td>
                  <td className={cn("text-center py-2 tabular-nums text-xs font-bold",
                    rec.streak?.streakType === "wins" ? "text-emerald-400" : "text-red-400")}>
                    {rec.streak?.streakCode ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Cardinals Schedule ──────────────────────────────────────────────────────

function CardinalsSchedule() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["cardinals-schedule"],
    queryFn: () => {
      const today = new Date();
      const startDate = today.toISOString().slice(0, 10);
      const end = new Date(today);
      end.setDate(end.getDate() + 14);
      const endDate = end.toISOString().slice(0, 10);
      return axios
        .get(`${MLB_API}/schedule`, {
          params: {
            sportId: 1,
            teamId: CARDINALS_ID,
            startDate,
            endDate,
            hydrate: "team,linescore",
          },
        })
        .then((r) => {
          const dates = r.data?.dates ?? [];
          return dates.flatMap((d: any) => (Array.isArray(d.games) ? d.games : []));
        }),
    },
    staleTime: 300_000,
  });

  return (
    <div className="rounded-2xl border border-red-900/30 bg-red-950/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-red-300 flex items-center gap-2">
          <span>🔴</span> Cardinals — Next 14 Days
        </h3>
        <button
          onClick={() => refetch()}
          className={cn("p-1.5 rounded-lg hover:bg-red-950/30 text-slate-500 hover:text-red-300 transition-all", isRefetching && "animate-spin")}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : !data?.length ? (
        <p className="text-sm text-slate-600 text-center py-3">No upcoming games</p>
      ) : (
        <div className="space-y-1.5">
          {data.map((game: any) => {
            const away = game.teams?.away;
            const home = game.teams?.home;
            const isHome = home?.team?.id === CARDINALS_ID;
            const opp = isHome ? away : home;
            const status = game.status?.abstractGameState;
            const isFinal = status === "Final";
            const isLive = status === "Live";
            const gameDate = new Date(game.gameDate);
            const dateStr = gameDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
            const timeStr = gameDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const cardsScore = isHome ? home?.score : away?.score;
            const oppScore = isHome ? away?.score : home?.score;
            const won = isFinal && cardsScore > oppScore;
            const lost = isFinal && cardsScore < oppScore;
            return (
              <div key={game.gamePk} className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 border",
                isLive ? "border-emerald-500/30 bg-emerald-500/5" :
                won ? "border-emerald-900/40 bg-emerald-950/20" :
                lost ? "border-red-900/30 bg-red-950/10" :
                "border-[#2a2a45] bg-[#12121f]"
              )}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-slate-500 w-24 shrink-0">{dateStr}</span>
                  <span className="text-xs text-slate-400 shrink-0">{isHome ? "vs" : "@"}</span>
                  <span className="text-sm font-semibold text-slate-200 truncate">
                    {opp?.team?.teamName ?? opp?.team?.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isLive && (
                    <span className="text-xs font-bold text-emerald-400">
                      {cardsScore}–{oppScore} LIVE
                    </span>
                  )}
                  {isFinal && (
                    <span className={cn("text-xs font-bold tabular-nums",
                      won ? "text-emerald-400" : lost ? "text-red-400" : "text-slate-400")}>
                      {won ? "W" : lost ? "L" : "F"} {cardsScore}–{oppScore}
                    </span>
                  )}
                  {!isLive && !isFinal && (
                    <span className="text-xs text-slate-500">{timeStr}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MLB Score Card ──────────────────────────────────────────────────────────

function MlbScoreCard({ game }: { game: any }) {
  const away = game.teams?.away;
  const home = game.teams?.home;
  const status = game.status?.abstractGameState;
  const isLive = status === "Live";
  const isFinal = status === "Final";
  const linescore = game.linescore;
  const gameTime = game.gameDate
    ? new Date(game.gameDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
    : "TBD";
  return (
    <div className={cn("rounded-xl border p-3 transition-all",
      isLive ? "border-emerald-500/30 bg-emerald-500/5" : "border-[#2a2a45] bg-[#12121f]")}>
      {isLive && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-emerald-400">LIVE &middot; {linescore?.inningHalf} {linescore?.currentInning}</span>
        </div>
      )}
      {isFinal && <div className="text-xs text-slate-500 mb-2">Final</div>}
      {!isLive && !isFinal && <div className="text-xs text-slate-500 mb-2">{gameTime}</div>}
      <div className="space-y-1.5">
        {[away, home].filter(Boolean).map((side: any, i: number) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">{side.team?.abbreviation ?? side.team?.name}</span>
              {side.leagueRecord && (
                <span className="text-xs text-slate-600">({side.leagueRecord.wins}-{side.leagueRecord.losses})</span>
              )}
            </div>
            <span className={cn("text-lg font-black tabular-nums",
              (isLive || isFinal) && side.isWinner ? "text-white" : "text-slate-400")}>
              {side.score ?? "–"}
            </span>
          </div>
        ))}
      </div>
      {isLive && linescore && (
        <div className="mt-2 text-xs text-slate-600 flex gap-3">
          <span>B: {linescore.balls ?? 0}</span>
          <span>S: {linescore.strikes ?? 0}</span>
          <span>O: {linescore.outs ?? 0}</span>
        </div>
      )}
      {!isLive && !isFinal && game.venue?.name && (
        <div className="mt-1.5 text-xs text-slate-700">{game.venue.name}</div>
      )}
    </div>
  );
}

function MlbScores() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["mlb-scores", today],
    queryFn: () =>
      axios.get(`${MLB_API}/schedule`, {
        params: { sportId: 1, date: today, hydrate: "linescore,team,probablePitcher" },
      }).then((r) => {
        const dates = r.data?.dates;
        if (!Array.isArray(dates)) return [] as any[];
        return dates.flatMap((d: any) => Array.isArray(d.games) ? d.games : []) as any[];
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2"><span>⚾</span> MLB Scores Today</h3>
        <button onClick={() => refetch()} className={cn("p-1.5 rounded-lg hover:bg-[#1a1a2e] text-slate-500 hover:text-white transition-all", isRefetching && "animate-spin")}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : !data?.length ? (
        <p className="text-sm text-slate-600 text-center py-4">No MLB games today</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.map((game: any) => <MlbScoreCard key={game.gamePk} game={game} />)}
        </div>
      )}
    </div>
  );
}

// ─── ESPN Scores ─────────────────────────────────────────────────────────────

function ScoreCard({ game }: { game: any }) {
  const competitions = game.competitions?.[0];
  const home = competitions?.competitors?.find((c: any) => c.homeAway === "home");
  const away = competitions?.competitors?.find((c: any) => c.homeAway === "away");
  const status = game.status?.type;
  const isLive = status?.state === "in";
  const isFinal = status?.state === "post";
  return (
    <div className={cn("rounded-xl border p-3 transition-all",
      isLive ? "border-emerald-500/30 bg-emerald-500/5" : "border-[#2a2a45] bg-[#12121f]")}>
      {isLive && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-emerald-400">LIVE &middot; {status?.detail}</span>
        </div>
      )}
      {isFinal && <div className="text-xs text-slate-600 mb-2">Final</div>}
      {!isLive && !isFinal && (
        <div className="text-xs text-slate-500 mb-2">
          {game.date ? new Date(game.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "TBD"}
        </div>
      )}
      <div className="space-y-1.5">
        {[away, home].filter(Boolean).map((team: any, i: number) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {team.team?.logo && <img src={team.team.logo} alt="" className="w-5 h-5 object-contain" />}
              <span className="text-sm font-semibold text-slate-200">{team.team?.abbreviation}</span>
              {team.records?.[0] && <span className="text-xs text-slate-600">({team.records[0].summary})</span>}
            </div>
            <span className={cn("text-lg font-black tabular-nums",
              (isLive || isFinal) && team.winner ? "text-white" : "text-slate-400")}>
              {team.score ?? "–"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EspnScores({ sport }: { sport: (typeof SPORTS)[number] }) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["espn-scores", sport.id],
    queryFn: () =>
      axios.get(`${ESPN}/${sport.espnSport}/scoreboard`)
        .then((r) => (Array.isArray(r.data?.events) ? r.data.events : [])),
    staleTime: 60_000,
    retry: 1,
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2"><span>{sport.emoji}</span> {sport.label} Scores</h3>
        <button onClick={() => refetch()} className={cn("p-1.5 rounded-lg hover:bg-[#1a1a2e] text-slate-500 hover:text-white transition-all", isRefetching && "animate-spin")}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : !data?.length ? (
        <p className="text-sm text-slate-600 text-center py-4">No games today</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.slice(0, 8).map((game: any) => <ScoreCard key={game.id} game={game} />)}
        </div>
      )}
    </div>
  );
}

// ─── Favorite Teams ──────────────────────────────────────────────────────────

function FavoriteTeams() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [sport, setSport] = useState("mlb");

  const { data: favorites } = useQuery({
    queryKey: ["sports-favorites"],
    queryFn: sportsApi.favorites,
  });

  const addMutation = useMutation({
    mutationFn: () =>
      sportsApi.addFavorite({ team_name: teamName, sport, sort_order: favorites?.length ?? 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sports-favorites"] });
      setTeamName(""); setShowAdd(false);
      toast.success("Team added!");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => sportsApi.removeFavorite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sports-favorites"] }),
  });

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-amber-300 flex items-center gap-2">
          <Star className="w-4 h-4 fill-current" /> My Teams
        </h3>
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-slate-500 hover:text-amber-400 transition-colors">+ Add</button>
      </div>
      {showAdd && (
        <div className="flex gap-2 mb-3">
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name"
            className="flex-1 bg-[#0d0d1f] border border-[#2a2a45] rounded-lg px-2 py-1 text-sm text-white placeholder:text-slate-600 outline-none" />
          <select value={sport} onChange={(e) => setSport(e.target.value)}
            className="bg-[#0d0d1f] border border-[#2a2a45] rounded-lg px-2 py-1 text-sm text-slate-300 outline-none">
            {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button onClick={() => teamName.trim() && addMutation.mutate()}
            className="px-3 py-1 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400">Add</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {favorites?.map((t) => (
          <div key={t.id} className="flex items-center gap-1.5 bg-[#1a1a2e] border border-[#2a2a45] rounded-lg px-2.5 py-1.5 group">
            <span className="text-sm text-white font-medium">{t.team_name}</span>
            <span className="text-xs text-slate-500">{t.sport.toUpperCase()}</span>
            <button onClick={() => removeMutation.mutate(t.id)}
              className="opacity-0 group-hover:opacity-100 ml-1 text-slate-600 hover:text-rose-400 transition-all">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {favorites?.length === 0 && <p className="text-xs text-slate-600">No favorites yet.</p>}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function SportsPage() {
  const [activeSport, setActiveSport] = useState("mlb");
  const sport = SPORTS.find((s) => s.id === activeSport)!;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-white flex items-center gap-2">
        <Trophy className="w-6 h-6 text-amber-400" /> Sports Dashboard
      </h1>

      <FavoriteTeams />

      {/* Cardinals + NL Central — always visible on MLB tab */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NlCentralStandings />
        <CardinalsSchedule />
      </div>

      <div className="flex gap-2">
        {SPORTS.map((s) => (
          <button key={s.id} onClick={() => setActiveSport(s.id)}
            className={cn("px-3 py-2 rounded-xl border text-sm font-bold transition-all",
              activeSport === s.id
                ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                : "border-[#2a2a45] text-slate-500 hover:text-slate-300")}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      {activeSport === "mlb" ? <MlbScores /> : <EspnScores sport={sport} />}
    </div>
  );
}
