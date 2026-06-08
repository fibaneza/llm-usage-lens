// Strata UI Kit — sticky top bar per spec:
// Left: org name + sync status badge
// Right: DateRangePicker + Search + User menu
// Below: filter chips row
const { useState: useStateTB } = React;

function TopBar({ orgName="Acme Corp", filters, onRemoveFilter }) {
  return (
    <header style={{ position:"sticky", top:0, zIndex:10,
      background:"color-mix(in srgb, var(--bg) 85%, transparent)",
      backdropFilter:"blur(10px)", borderBottom:"1px solid var(--border)" }}>
      {/* Main bar */}
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"10px 24px" }}>
        {/* Org name + sync */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontFamily:"var(--font-heading)", fontWeight:600, fontSize:"var(--text-16)",
            color:"var(--fg)", letterSpacing:"-0.01em" }}>{orgName}</span>
          <SyncBadge />
        </div>
        {/* Right controls */}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          <SearchBox />
          <DateRange />
          <UserMenu />
        </div>
      </div>
      {/* Filter chips + page title */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 24px 10px",
        borderTop:"1px solid var(--border-subtle)" }}>
        <span style={{ fontFamily:"var(--font-heading)", fontWeight:600, fontSize:"var(--text-18)",
          color:"var(--fg)", letterSpacing:"-0.02em)", marginRight:8 }}>Cost overview</span>
        <span style={{ color:"var(--fg-subtle)", fontSize:"var(--text-sm)", display:"flex",
          alignItems:"center", gap:5, fontFamily:"var(--font-sans)" }}>
          <Icon name="filter" size={13} /> Filters
        </span>
        {filters.map(f => <Chip key={f.id} onRemove={()=>onRemoveFilter(f.id)}>
          {f.key && <span style={{ color:"var(--fg-subtle)" }}>{f.key}:&nbsp;</span>}
          <b style={{ color:"var(--fg)", fontWeight:500 }}>{f.value}</b>
        </Chip>)}
        <span style={{ display:"inline-flex", alignItems:"center", gap:5, height:26, padding:"0 10px",
          borderRadius:"var(--radius-full)", border:"1px dashed var(--border-strong)",
          color:"var(--color-secondary)", fontSize:"var(--text-sm)", cursor:"pointer",
          fontFamily:"var(--font-sans)" }}>
          <Icon name="plus" size={13} /> Add filter
        </span>
      </div>
    </header>
  );
}

function SyncBadge() {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, height:22, padding:"0 8px",
      borderRadius:"var(--radius-full)", background:"var(--pos-bg)", border:"1px solid var(--pos)",
      fontSize:"var(--text-2xs)", fontWeight:500, color:"var(--pos)", fontFamily:"var(--font-sans)" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--pos)" }} />
      Synced 47m ago
    </span>
  );
}

function SearchBox() {
  const [v, setV] = useStateTB("");
  const [f, setF] = useStateTB(false);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, height:34, padding:"0 11px", width:192,
      background:"var(--surface-2)", border:`1px solid ${f?"var(--color-primary)":"var(--border)"}`,
      borderRadius:"var(--radius-md)", boxShadow: f?"0 0 0 2px var(--ring)":"none",
      transition:"border-color .15s, box-shadow .15s" }}>
      <Icon name="search" size={14} color="var(--fg-subtle)" />
      <input value={v} onChange={e=>setV(e.target.value)} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        placeholder="Search…"
        style={{ background:"none", border:0, outline:"none", color:"var(--fg)", fontFamily:"var(--font-sans)",
          fontSize:"var(--text-body)", width:"100%" }} />
    </div>
  );
}

function DateRange() {
  const ranges = ["7d","30d","90d","YTD"];
  const [sel, setSel] = useStateTB("30d");
  return (
    <div style={{ display:"inline-flex", padding:3, background:"var(--surface-2)", border:"1px solid var(--border)",
      borderRadius:"var(--radius-md)", gap:2 }}>
      {ranges.map(r => (
        <button key={r} onClick={()=>setSel(r)} style={{ height:26, padding:"0 10px", border:0, cursor:"pointer",
          background: sel===r?"var(--color-primary)":"transparent",
          color: sel===r?"#fff":"var(--fg-muted)",
          fontFamily:"var(--font-mono)", fontSize:"var(--text-sm)", fontWeight:500,
          borderRadius:"var(--radius-sm)", transition:"background .14s, color .14s" }}>
          {r}
        </button>
      ))}
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useStateTB(false);
  return (
    <div style={{ position:"relative" }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
        padding:"4px 10px 4px 4px", borderRadius:"var(--radius-full)", border:"1px solid var(--border)",
        background:"var(--surface-2)", transition:"border-color .14s" }}>
        <div style={{ width:26, height:26, borderRadius:"50%", background:"var(--accent-gradient)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:"var(--text-xs)",
          fontWeight:600, color:"#fff", fontFamily:"var(--font-sans)" }}>JD</div>
        <span style={{ fontSize:"var(--text-sm)", color:"var(--fg-secondary)", fontFamily:"var(--font-sans)" }}>Jane D.</span>
        <Icon name="chevron-down" size={13} color="var(--fg-subtle)" />
      </div>
      {open && (
        <div style={{ position:"absolute", right:0, top:"calc(100% + 6px)", width:180,
          background:"var(--surface-3)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)",
          boxShadow:"var(--shadow-overlay)", padding:"6px", zIndex:100 }}>
          {[{icon:"user",label:"Profile"},{icon:"settings",label:"Settings"},{icon:"log-out",label:"Sign out"}].map(item=>(
            <div key={item.label} style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 10px",
              borderRadius:"var(--radius-md)", cursor:"pointer", color:"var(--fg-secondary)",
              fontFamily:"var(--font-sans)", fontSize:"var(--text-sm)" }}
              onMouseEnter={e=>e.currentTarget.style.background="var(--surface-hover)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Icon name={item.icon} size={15} /> {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TopBar });
