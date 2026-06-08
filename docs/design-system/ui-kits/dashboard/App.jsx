// Strata UI Kit — composes the overview screen.
const { useState: useStateApp } = React;

function App() {
  const [collapsed, setCollapsed] = useStateApp(false);
  const [active, setActive] = useStateApp("overview");
  const [filters, setFilters] = useStateApp([
    { id:"r", key:null, value:"Last 30 days" },
    { id:"t", key:"team", value:"platform" },
    { id:"g", key:"region", value:"us-east-1" },
  ]);
  const removeFilter = id => setFilters(f => f.filter(x => x.id!==id));

  return (
    <div style={{ display:"flex", height:"100vh", background:"var(--bg)", color:"var(--fg)", fontFamily:"var(--font-sans)" }}>
      <Sidebar active={active} onNavigate={setActive} collapsed={collapsed} onToggle={()=>setCollapsed(c=>!c)} />
      <main style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <TopBar title="Cost overview" filters={filters} onRemoveFilter={removeFilter} />
        <div style={{ flex:1, overflowY:"auto", padding:"20px 24px 40px" }}>
          {/* KPI row */}
          <div style={{ display:"flex", gap:14, marginBottom:14 }}>
            <StatCard label="Total spend · MTD" value="$48,210.34" delta="18.3%" up icon="dollar-sign"
              spark={[24,22,23,18,19,14,12,9,4]} />
            <StatCard label="Invocations" value="1.94M" delta="4.1%" up={false} icon="activity"
              spark={[8,10,9,13,12,16,15,19,20]} />
            <StatCard label="Tokens processed" value="1.30B" delta="11.7%" up icon="cpu"
              spark={[10,11,13,12,15,17,19,22,24]} sparkColor="var(--neg)" />
            <StatCard label="Avg cost / 1K tok" value="$0.0371" delta="2.3%" up={false} icon="trending-down"
              spark={[20,19,17,18,15,14,13,11,10]} />
          </div>
          {/* Charts */}
          <div style={{ display:"flex", gap:14, marginBottom:14 }}>
            <CostAreaChart />
            <DonutChart />
          </div>
          {/* Table */}
          <ModelTable />
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
