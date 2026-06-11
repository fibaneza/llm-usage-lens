// Strata UI Kit — left navigation rail (spec-accurate nav items).
const { useState: useStateSB } = React;

const NAV = [
  { group: null, items: [
    { icon:"layout-dashboard", label:"Overview",    key:"overview",     route:"/dashboard" },
  ]},
  { group:"Attribution", items: [
    { icon:"trophy",           label:"Ranking",     key:"ranking",      route:"/dashboard/ranking" },
    { icon:"building-2",       label:"Departments", key:"departments",  route:"/dashboard/departments" },
    { icon:"users-round",      label:"Teams",       key:"teams",        route:"/dashboard/teams" },
    { icon:"server",           label:"Services",    key:"services",     route:"/dashboard/services" },
    { icon:"user",             label:"Users",       key:"users",        route:"/dashboard/users" },
  ]},
  { group:"System", items: [
    { icon:"settings-2",       label:"Settings",    key:"settings",     route:"/dashboard/settings" },
  ]},
];

function Sidebar({ active="overview", onNavigate, collapsed, onToggle }) {
  const w = collapsed ? 56 : 220;
  return (
    <aside style={{ width:w, flex:`0 0 ${w}px`, height:"100%", background:"var(--surface-1)",
      borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column",
      transition:"width .16s ease", overflow:"hidden" }}>
      {/* Brand */}
      <div style={{ display:"flex", alignItems:"center", gap:10, height:52, padding:"0 14px",
        borderBottom:"1px solid var(--border)" }}>
        <svg width="22" height="22" viewBox="0 0 32 32" style={{ flex:"none" }}>
          <defs>
            <linearGradient id="sbMark" x1="4" y1="6" x2="28" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#1E40AF"/><stop offset="1" stopColor="#3B82F6"/>
            </linearGradient>
          </defs>
          <rect x="4" y="6" width="18" height="5" rx="1.5" fill="url(#sbMark)"/>
          <rect x="8" y="13.5" width="20" height="5" rx="1.5" fill="url(#sbMark)" fillOpacity="0.72"/>
          <rect x="4" y="21" width="16" height="5" rx="1.5" fill="url(#sbMark)" fillOpacity="0.46"/>
        </svg>
        {!collapsed && <span style={{ fontSize:17, fontWeight:600, letterSpacing:"-0.02em",
          color:"var(--fg)", fontFamily:"var(--font-heading)" }}>Strata</span>}
      </div>

      <nav style={{ flex:1, padding:"10px 8px", display:"flex", flexDirection:"column", gap:2, overflowY:"auto" }}>
        {NAV.map((sec, i) => (
          <div key={i} style={{ marginTop: i?14:0 }}>
            {sec.group && !collapsed && (
              <div style={{ padding:"4px 10px 4px", fontSize:"var(--text-2xs)", letterSpacing:"var(--tracking-label)",
                textTransform:"uppercase", color:"var(--fg-subtle)", fontWeight:500, fontFamily:"var(--font-sans)" }}>
                {sec.group}
              </div>
            )}
            {sec.items.map(it => <NavItem key={it.key} {...it} active={active===it.key}
              collapsed={collapsed} onClick={()=>onNavigate&&onNavigate(it.key)} />)}
          </div>
        ))}
      </nav>

      <div style={{ borderTop:"1px solid var(--border)", padding:"8px" }}>
        <button onClick={onToggle} style={{ width:"100%", display:"flex", alignItems:"center",
          gap:10, padding:"8px 10px", background:"transparent", border:0, color:"var(--fg-subtle)",
          cursor:"pointer", fontSize:"var(--text-sm)", fontFamily:"var(--font-sans)",
          borderRadius:"var(--radius-md)" }}>
          <Icon name={collapsed?"panel-left-open":"panel-left-close"} size={16} />
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active, collapsed, onClick }) {
  const [h, setH] = useStateSB(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      title={collapsed?label:undefined}
      style={{ display:"flex", alignItems:"center", gap:10, height:36, padding:"0 10px", cursor:"pointer",
        borderRadius:"var(--radius-md)", color: active?"var(--color-secondary)":(h?"var(--fg)":"var(--fg-muted)"),
        background: active?"var(--accent-subtle)":(h?"var(--surface-hover)":"transparent"),
        fontSize:"var(--text-body)", fontWeight: active?500:400, fontFamily:"var(--font-sans)",
        justifyContent: collapsed?"center":"flex-start", transition:"background .12s, color .12s",
        borderLeft: active?"2px solid var(--color-primary)":"2px solid transparent" }}>
      <Icon name={icon} size={17} />
      {!collapsed && <span>{label}</span>}
    </div>
  );
}

Object.assign(window, { Sidebar });
