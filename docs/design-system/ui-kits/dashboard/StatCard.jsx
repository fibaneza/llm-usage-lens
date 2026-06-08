// Strata UI Kit — KPI stat card with metric, budget-aware delta, sparkline.
function StatCard({ label, value, delta, up, icon, spark, sparkColor }) {
  const [h, setH] = React.useState(false);
  return (
    <Card pad={16} style={{ flex:1, minWidth:0 }} persistHover={false}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontFamily:"var(--font-sans)", font:"500 var(--text-xs)/1 var(--font-sans)",
          letterSpacing:"var(--tracking-label)", textTransform:"uppercase", color:"var(--fg-muted)" }}>{label}</span>
        <span style={{ width:28, height:28, borderRadius:"var(--radius-md)", background:"var(--surface-2)",
          display:"flex", alignItems:"center", justifyContent:"center", color:"var(--fg-muted)" }}>
          <Icon name={icon} size={14} />
        </span>
      </div>
      <div style={{ fontFamily:"var(--font-mono)", fontWeight:600, fontSize:"var(--text-32)",
        letterSpacing:"-0.02em", color:"var(--fg)", marginBottom:8,
        fontFeatureSettings:"'tnum' 1,'zero' 1" }}>{value}</div>
      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
        {delta && <Delta value={delta} up={up} />}
        <span style={{ fontSize:"var(--text-sm)", color:"var(--fg-subtle)", fontFamily:"var(--font-sans)" }}>vs. prior period</span>
      </div>
      {spark && <Sparkline points={spark} color={sparkColor || (up?"var(--neg)":"var(--pos)")} />}
    </Card>
  );
}

function Sparkline({ points, color }) {
  const w=220, h=34, max=Math.max(...points), min=Math.min(...points);
  const range = max-min || 1;
  const path = points.map((p,i)=>{
    const x = (i/(points.length-1))*w;
    const y = h - ((p-min)/range)*(h-4) - 2;
    return `${i?"L":"M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const fillId = "spk"+Math.random().toString(36).slice(2,7);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width:"100%", height:34, marginTop:12, display:"block" }}>
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.2"/><stop offset="100%" stopColor={color} stopOpacity="0"/>
      </linearGradient></defs>
      <path d={`${path} L${w},${h} L0,${h} Z`} fill={`url(#${fillId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

Object.assign(window, { StatCard });
