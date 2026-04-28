import { useQuery } from "@tanstack/react-query";
import { tasksApi, habitsApi, timersApi } from "@/lib/api";
import { BarChart3, Clock, CheckSquare, TrendingUp, Loader2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { formatMinutes, priorityColor } from "@/lib/utils";

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#f43f5e", "#38bdf8", "#a78bfa"];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#2a2a45] bg-[#12121f] p-4">
      <h3 className="text-sm font-bold text-slate-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a45] rounded-lg px-3 py-2 text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

export function StatsPage() {
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: () => tasksApi.list({ status: undefined }),
  });

  const { data: timeEntries, isLoading: timersLoading } = useQuery({
    queryKey: ["time-entries"],
    queryFn: () => timersApi.list({ limit: 200 }),
  });

  if (tasksLoading || timersLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>;
  }

  // Task status distribution
  const statusCounts = (tasks ?? []).reduce((acc: Record<string, number>, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  // Priority distribution
  const priorityCounts = (tasks ?? []).reduce((acc: Record<string, number>, t) => {
    acc[t.priority] = (acc[t.priority] || 0) + 1;
    return acc;
  }, {});
  const priorityData = Object.entries(priorityCounts).map(([name, value]) => ({ name, value }));

  // Focus score distribution
  const focusData = [
    { range: "1-5", count: tasks?.filter(t => t.focus_score >= 1 && t.focus_score <= 5).length ?? 0 },
    { range: "6-10", count: tasks?.filter(t => t.focus_score >= 6 && t.focus_score <= 10).length ?? 0 },
    { range: "11-15", count: tasks?.filter(t => t.focus_score >= 11 && t.focus_score <= 15).length ?? 0 },
    { range: "16-20", count: tasks?.filter(t => t.focus_score >= 16 && t.focus_score <= 20).length ?? 0 },
    { range: "21-25", count: tasks?.filter(t => t.focus_score >= 21).length ?? 0 },
  ];

  // Time variance
  const withEstimates = tasks?.filter(t => t.time_estimate_minutes && t.actual_time_minutes > 0) ?? [];
  const avgVariance = withEstimates.length > 0
    ? Math.round(withEstimates.reduce((a, t) => a + (t.time_variance_minutes ?? 0), 0) / withEstimates.length)
    : 0;

  // Daily focus time (last 14 days)
  const dailyFocus: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyFocus[d.toISOString().split("T")[0]] = 0;
  }
  (timeEntries ?? []).forEach(e => {
    if (e.ended_at) {
      const d = e.started_at.split("T")[0];
      if (d in dailyFocus) {
        dailyFocus[d] += Math.round(e.duration_seconds / 60);
      }
    }
  });
  const focusLineData = Object.entries(dailyFocus).map(([date, minutes]) => ({
    date: date.slice(5), // MM-DD
    minutes,
  }));

  // Summary stats
  const totalTasks = tasks?.length ?? 0;
  const doneTasks = tasks?.filter(t => t.status === "done").length ?? 0;
  const totalFocusMin = (timeEntries ?? []).reduce((a, e) => a + (e.duration_seconds / 60), 0);
  const avgFocusScore = totalTasks > 0
    ? Math.round((tasks ?? []).reduce((a, t) => a + t.focus_score, 0) / totalTasks * 10) / 10
    : 0;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-white flex items-center gap-2">
        <BarChart3 className="w-6 h-6 text-cyan-400" />
        Stats &amp; Insights
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Tasks", value: totalTasks, color: "text-indigo-400", icon: CheckSquare },
          { label: "Completed", value: `${doneTasks} (${totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0}%)`, color: "text-emerald-400", icon: CheckSquare },
          { label: "Focus Time", value: formatMinutes(Math.round(totalFocusMin)), color: "text-violet-400", icon: Clock },
          { label: "Avg Focus Score", value: avgFocusScore, color: "text-amber-400", icon: TrendingUp },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-[#2a2a45] bg-[#12121f] p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className={`text-2xl font-black ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Time variance insight */}
      {withEstimates.length > 0 && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${avgVariance > 0 ? "border-rose-500/20 bg-rose-500/5 text-rose-300" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"}`}>
          <TrendingUp className="w-4 h-4 inline mr-2" />
          Time variance: on average you {avgVariance > 0 ? `go over by ${avgVariance}m` : `finish ${Math.abs(avgVariance)}m early`} vs your estimates
          {withEstimates.length < 5 && " (add more time estimates for better insights)"}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Focus time line chart */}
        <ChartCard title="Daily Focus Time (last 14 days)">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={focusLineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
              <XAxis dataKey="date" tick={{ fill: "#5a5a7a", fontSize: 10 }} />
              <YAxis tick={{ fill: "#5a5a7a", fontSize: 10 }} unit="m" />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="minutes" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Focus min" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Task status pie */}
        <ChartCard title="Tasks by Status">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, value }) => `${name}: ${value}`}>
                {statusData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Focus score distribution */}
        <ChartCard title="Focus Score Distribution">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={focusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
              <XAxis dataKey="range" tick={{ fill: "#5a5a7a", fontSize: 10 }} />
              <YAxis tick={{ fill: "#5a5a7a", fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Tasks" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Priority distribution */}
        <ChartCard title="Tasks by Priority">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={priorityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
              <XAxis dataKey="name" tick={{ fill: "#5a5a7a", fontSize: 10 }} />
              <YAxis tick={{ fill: "#5a5a7a", fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Count">
                {priorityData.map((entry, i) => (
                  <Cell key={i} fill={
                    entry.name === "critical" ? "#f43f5e" :
                    entry.name === "high" ? "#f59e0b" :
                    entry.name === "medium" ? "#6366f1" : "#22c55e"
                  } />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
