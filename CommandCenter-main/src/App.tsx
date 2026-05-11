import { useState, useEffect, useRef, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { TimerBanner } from "@/components/layout/TimerBanner";
import { FocusMode } from "@/components/focus/FocusMode";
import { CelebrationOverlay } from "@/components/todos/CelebrationOverlay";
import { useUIStore, useTimerStore } from "@/store";
import { DashboardPage }  from "@/pages/DashboardPage";
import { TodosPage }      from "@/pages/TodosPage";
import { ProjectsPage }   from "@/pages/ProjectsPage";
import { HabitsPage }     from "@/pages/HabitsPage";
import { CalendarPage }   from "@/pages/CalendarPage";
import { FocusPage }      from "@/pages/FocusPage";
import { BraindumpPage }  from "@/pages/BraindumpPage";
import { NotesPage }      from "@/pages/NotesPage";
import { CRMPage }        from "@/pages/CRMPage";
import { StatsPage }      from "@/pages/StatsPage";
import { SportsPage }     from "@/pages/SportsPage";
import { CategoriesPage } from "@/pages/CategoriesPage";
import { TagsPage }       from "@/pages/TagsPage";
import { DailySummaryPage } from "@/pages/DailySummaryPage";
import { LoginPage }      from "@/pages/LoginPage";
import { WeatherPage }    from "@/pages/WeatherPage";
import { tokenStore }     from "@/lib/api";
import { DueReminderNotifications } from "@/components/notifications/DueReminderNotifications";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
}

/** Weather: same full-width shell as dashboard (minus green scoreboard frame). */
function PageFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (pathname.startsWith("/weather")) {
    return (
      <div
        style={{
          width: "100%",
          minWidth: 0,
          minHeight: "100vh",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div className="sb-shell" style={{ minHeight: "calc(100vh - 0px)" }}>
      {children}
    </div>
  );
}

function AppShell() {
  const { sidebarCollapsed, setAddTaskOpen } = useUIStore();
  const { activeTimer } = useTimerStore();
  const location = useLocation();
  const navigate = useNavigate();
  const sw = sidebarCollapsed ? 48 : 200;
  const isWeatherRoute = location.pathname.startsWith("/weather");

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      return el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== "a") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const projectMatch = location.pathname.match(/^\/projects\/([^/]+)$/);
      const projectId = projectMatch?.[1] ?? null;
      if (projectId) {
        setAddTaskOpen(true, projectId);
        return;
      }
      if (location.pathname !== "/todos") navigate("/todos");
      setAddTaskOpen(true, null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [location.pathname, navigate, setAddTaskOpen]);

  return (
    <div style={{ minHeight:"100vh", background: isWeatherRoute ? "#0b1220" : "#162a1c" }}>
      <FocusMode/><CelebrationOverlay/><TimerBanner/><Sidebar/>
      <DueReminderNotifications />
      <main
        style={{
          /* Padding (not margin) so the content box is exactly viewport − sidebar; avoids a too-narrow main on some layouts */
          paddingLeft: sw,
          paddingTop: activeTimer ? 44 : 0,
          minHeight: "100vh",
          width: "100%",
          maxWidth: "100vw",
          boxSizing: "border-box",
          minWidth: 0,
          transition: "padding-left 0.25s ease",
        }}
      >
        <PageFrame>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/todos"     element={<TodosPage />} />
            <Route path="/projects"  element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectsPage />} />
            <Route path="/habits"    element={<HabitsPage />} />
            <Route path="/calendar"  element={<CalendarPage />} />
            <Route path="/focus"     element={<FocusPage />} />
            <Route path="/braindump" element={<BraindumpPage />} />
            <Route path="/notes"     element={<NotesPage />} />
            <Route path="/crm"       element={<CRMPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/daily-summary" element={<DailySummaryPage />} />
            <Route path="/stats"     element={<StatsPage />} />
            <Route path="/sports"    element={<SportsPage />} />
            <Route path="/weather"   element={<WeatherPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </PageFrame>
      </main>
      <Toaster position="bottom-right" toastOptions={{
        style:{ background:"#1e3629", color:"#f5f0e0", border:"1px solid rgba(232,168,32,0.4)", borderRadius:2, fontSize:12, fontWeight:600, fontFamily:"'Oswald',Arial,sans-serif", letterSpacing:"0.06em" },
        success:{ iconTheme:{ primary:"#e8a820", secondary:"#1e3629" } },
        error:  { iconTheme:{ primary:"#d94040", secondary:"#1e3629" } },
      }}/>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  // Each login cycle gets a fresh QueryClient so no stale unauthenticated
  // queries survive in the cache and fire without a Bearer token.
  const qcRef = useRef<QueryClient>(makeQC());

  useEffect(() => {
    const handleLogout = () => setToken(null);
    window.addEventListener("auth:logout", handleLogout);
    return () => window.removeEventListener("auth:logout", handleLogout);
  }, []);

  function handleLogin(t: string) {
    tokenStore.set(t);
    // Fresh client — no cached 401 results carried over
    qcRef.current = makeQC();
    setToken(t);
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <QueryClientProvider client={qcRef.current}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
