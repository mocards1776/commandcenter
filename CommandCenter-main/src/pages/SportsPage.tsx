import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sportsApi } from "@/lib/api";
import { Trophy, Plus, X, Loader2, RefreshCw, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FavoriteSportsTeam } from "@/types";
import toast from "react-hot-toast";
import axios from "axios";

// ESPN public API (no key required)
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

const SPORTS = [
  { id: "mlb",  label: "MLB",  espnSport: "baseball/mlb",   emoji: "⚾" },
  { id: "nfl",  label: "NFL",  espnSport: "football/nfl",   emoji: "🏈" },
  { id: "nba",  label: "NBA",  espnSport: "basketball/nba", emoji: "🏀" },
  { id: "nhl",  label: "NHL",  espnSport: "hockey/nhl",     emoji: "🏒" },
];

function ScoreCard({ game }: { game: any }) {
  const competitions = game.competitions?.[0];
  const home = competitions?.competitors?.find((c: any) => c.homeAway === "home");
  const away = competitions?.competitors?.find((c: any) => c.homeAway === "away");
  const status = game.status?.type;
  const isLive = status?.state === "in";
  const isFinal = status?.state === "post";

  return (
    <div className={cn(
      "rounded-xl border p-3 transition-all",
      isLive ? "border-emerald-500/30 bg-emerald-500/5" : "border-[#2a2a45] bg-[#12121f]"
    )}>
      {isLive && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 timer-pulse" />
          <span className="text-xs font-bold text-emerald-400">LIVE · {status?.detail}</span>
        </div>
      )}
      {isFinal && <div className="text-xs text-slate-600 mb-2">Final</div>}
      {!isLive && !isFinal && (
        <div className="text-xs text-slate-500 mb-2">{game.date ? new Date(game.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "TBD"}</div>
      )}

      <div className="space-y-1.5">
        {[away, home].filter(Boolean).map((team: any, i: number) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {team.team?.logo && (
                <img src={team.team.logo} alt="" className="w-5 h-5 object-contain" />
              )}
              <span className="text-sm font-semibold text-slate-200">{team.team?.abbreviation}</span>
              <span className="text-xs text-slate-500 hidden sm:inline">{team.team?.displayName}</span>
              {team.records?.[0] && (
                <span className="text-xs text-slate-600">({team.records[0].summary})</span>
              )}
            </div>
            <span className={cn("text-lg font-black tabular-nums",
              (isLive || isFinal) && team.winner ? "text-white" : "text-slate-400"
            )}>
              {team.score ?? "-"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SportScores({ sport }: { sport: typeof SPORTS[number] }) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["espn-scores", sport.id],
    queryFn: () =>
      axios.get(`${ESPN}/${sport.espnSport}/scoreboard`)
        .then(r => r.data?.events ?? []),
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2">
          <span>{sport.emoji}</span> {sport.label} Scores
        </h3>
        <button
          onClick={() => refetch()}
          className={cn("p-1.5 rounded-lg hover:bg-[#1a1a2e] text-slate-500 hover:text-white transition-all", isRefetching && "animate-spin")}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : data?.length === 0 ? (
        <p className="text-sm text-slate-600 text-center py-4">No games today</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data?.slice(0, 6).map((game: any) => (
            <ScoreCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}

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
    mutationFn: () => sportsApi.addFavorite({ team_name: teamName, sport, sort_order: favorites?.length ?? 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sports-favorites"] });
      setTeamName(""); setShowAdd(false);
      toast.success("Team added to favorites!");
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
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-slate-500 hover:text-amber-400 transition-colors">
          + Add
        </button>
      </div>

      {showAdd && (
        <div className="flex gap-2 mb-3">
          <input value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Team name"
            className="flex-1 bg-[#0d0d1f] border border-[#2a2a45] rounded-lg px-2 py-1 text-sm text-white placeholder:text-slate-600 outline-none" />
          <select value={sport} onChange={e => setSport(e.target.value)}
            className="bg-[#0d0d1f] border border-[#2a2a45] rounded-lg px-2 py-1 text-sm text-slate-300 outline-none">
            {SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button onClick={() => teamName.trim() && addMutation.mutate()}
            className="px-3 py-1 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400">Add</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {favorites?.map(t => (
          <div key={t.id} className="flex items-center gap-1.5 bg-[#1a1a2e] border border-[#2a2a45] rounded-lg px-2.5 py-1.5 group">
            <span className="text-sm text-white font-medium">{t.team_name}</span>
            <span className="text-xs text-slate-500">{t.sport.toUpperCase()}</span>
            <button onClick={() => removeMutation.mutate(t.id)} className="opacity-0 group-hover:opacity-100 ml-1 text-slate-600 hover:text-rose-400 transition-all">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {favorites?.length === 0 && (
          <p className="text-xs text-slate-600">No favorites yet. Add your teams above!</p>
        )}
      </div>
    </div>
  );
}

export function SportsPage() {
  const [activeSport, setActiveSport] = useState("mlb");
  const sport = SPORTS.find(s => s.id === activeSport)!;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-white flex items-center gap-2">
        <Trophy className="w-6 h-6 text-amber-400" />
        Sports Dashboard
      </h1>

      {/* Favorite teams */}
      <FavoriteTeams />

      {/* Sport tabs */}
      <div className="flex gap-2">
        {SPORTS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSport(s.id)}
            className={cn(
              "px-3 py-2 rounded-xl border text-sm font-bold transition-all",
              activeSport === s.id
                ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                : "border-[#2a2a45] text-slate-500 hover:text-slate-300"
            )}
          >
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      {/* Scores */}
      <SportScores sport={sport} />
    </div>
  );
}
