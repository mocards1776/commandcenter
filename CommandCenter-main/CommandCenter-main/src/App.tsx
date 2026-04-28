import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "@/components/layout/Sidebar";
import { TimerBanner } from "@/components/layout/TimerBanner";
import { FocusMode } from "@/components/focus/FocusMode";
import { CelebrationOverlay } from "@/components/todos/CelebrationOverlay";
import { useUIStore, useTimerStore } from "@/store";
import { DashboardPage }  from "@/pages/DashboardPage";
import { TodosPage }      from "@/pages/TodosPage";
import { ProjectsPage }   from "@/pages/ProjectsPage";
import { HabitsPage }     from "@/pages/HabitsPage";
import { TimeBlockPage }  from "@/pages/TimeBlockPage";
import { FocusPage }      from "@/pages/FocusPage";
import { BraindumpPage }  from "@/pages/BraindumpPage";
import { NotesPage }      from "@/pages/NotesPage";
import { CRMPage }        from "@/pages/CRMPage";
import { StatsPage }      from "@/pages/StatsPage";
import { SportsPage }     from "@/pages/SportsPage";

const qc = new QueryClient({ defaultOptions:{ queries:{ staleTime:30_000, retry:1 } } });

const PAGES: Record<string, React.ComponentType> = {
  dashboard:DashboardPage, todos:TodosPage, projects:ProjectsPage,
  habits:HabitsPage, timeblock:TimeBlockPage, focus:FocusPage,
  braindump:BraindumpPage, notes:NotesPage, crm:CRMPage,
  stats:StatsPage, sports:SportsPage,
};

function AppInner() {
  const { activePage, sidebarCollapsed } = useUIStore();
  const { activeTimer } = useTimerStore();
  const Page = PAGES[activePage] ?? DashboardPage;
  const sw = sidebarCollapsed ? 48 : 200;
  return (
    <div style={{ minHeight:"100vh", background:"#162a1c" }}>
      <FocusMode/><CelebrationOverlay/><TimerBanner/><Sidebar/>
      <main style={{ marginLeft:sw, paddingTop:activeTimer?44:0, minHeight:"100vh", transition:"margin-left 0.25s ease" }}>
        <div className="sb-shell" style={{ minHeight:"calc(100vh - 0px)" }} key={activePage}>
          <Page/>
        </div>
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
  return <QueryClientProvider client={qc}><AppInner/></QueryClientProvider>;
}
