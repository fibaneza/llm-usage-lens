// Strata UI Kit — charts using spec-accurate model colors.
const { useState: useStateCH } = React;

// Spec model colors
const MODEL_COLORS = {
  "Claude Sonnet": "#3B82F6",
  "Claude Opus":   "#7C3AED",
  "Claude Haiku":  "#14B8A6",
  "Other":         "#D97706",
  "Cohere":        "#F43F5E",
};

const SERIES = [
  { key:"Claude Sonnet", color:"#3B82F6" },
  { key:"Claude Opus",   color:"#7C3AED" },
  { key:"Claude Haiku",  color:"#14B8A6" },
  { key:"Other",         color:"#D97706" },
  { key:"Cohere",        color:"#F43F5E" },
];

function genData() {
  const rows = [];
  for (let d=0; d<30; d++) {
    const t = d/29;
    rows.push({ day:d, vals:[
      320+260*t+40*Math.sin(d/2),
      140+90*t+25*Math.sin(d/4+1),
      180+120*t+30*Math.cos(d/3),
      110+40*t+18*Math.cos(d/2.5),
      70+30*t+12*Math.sin(d/3+2),
    ]});
  }
  return rows;
}
const DATA = genData();

function CostAreaChart() {
  const [metric, setMetric] = useStateCH("Cost");
  const W=720, H=240, padL=8, padB=22, padT=10;
  const innerW=W-padL, innerH=H-padB-padT;
  const totals = DATA.map(r=>r.vals.reduce((a,b)=>a+b,0));
  const maxTotal = Math.max(...totals)*1.08;
  const x = i => padL+(i/(DATA.length-1))*innerW;
  const y = v => padT+innerH-(v/maxTotal)*innerH;

  const layers = SERIES.map((s,si) => {
    const top=[], bot=[];
    DATA.forEach((r,i)=>{
      const below=r.vals.slice(0,si).reduce((a,b)=>a+b,0);
      const cum=below+r.vals[si];
      top.push([x(i),y(cum)]); bot.push([x(i),y(below)]);
    });
    const d = "M"+top.map(p=>p.join(",")).join(" L")+" L"+bot.reverse().map(p=>p.join(",")).join(" L")+" Z";
    const line = "M"+top.map(p=>p.join(",")).join(" L");
    return { d, line, color:s.color };
  });

  const gridY = [0,.25,.5,.75,1].map(f=>padT+innerH-f*innerH);

  return (
    <Card pad={18} style={{ flex:2, minWidth:0 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <div>
          <div style={{ fontFamily:"var(--font-heading)", fontWeight:600, fontSize:"var(--text-16)",
            color:"var(--fg)", letterSpacing:"-0.02em" }}>Spend over time</div>
          <div style={{ fontFamily:"var(--font-sans)", fontSize:"var(--text-sm)", color:"var(--fg-subtle)", marginTop:3 }}>
            Daily, stacked by model · last 30 days</div>
        </div>
        <div style={{ display:"inline-flex", padding:3, background:"var(--surface-2)", border:"1px solid var(--border)",
          borderRadius:"var(--radius-md)", gap:2 }}>
          {["Cost","Tokens","Invocations"].map(m=>(
            <button key={m} onClick={()=>setMetric(m)} style={{ height:26, padding:"0 11px", border:0, cursor:"pointer",
              background:metric===m?"var(--color-primary)":"transparent",
              color:metric===m?"#fff":"var(--fg-muted)",
              fontFamily:"var(--font-sans)", fontSize:"var(--text-sm)", fontWeight:500,
              borderRadius:"var(--radius-sm)", transition:"background .14s, color .14s" }}>{m}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto", display:"block" }}>
        {gridY.map((gy,i)=><line key={i} x1={padL} x2={W} y1={gy} y2={gy} stroke="var(--grid-line)" strokeWidth="1"/>)}
        {layers.map((l,i)=><path key={i} d={l.d} fill={l.color} fillOpacity="0.30"/>)}
        {layers.map((l,i)=><path key={"l"+i} d={l.line} fill="none" stroke={l.color} strokeWidth="1.5"/>)}
      </svg>
      <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginTop:12 }}>
        {SERIES.map(s=>(
          <span key={s.key} style={{ display:"inline-flex", alignItems:"center", gap:6,
            fontSize:"var(--text-xs)", color:"var(--fg-muted)", fontFamily:"var(--font-sans)" }}>
            <span style={{ width:9, height:9, borderRadius:2, background:s.color }} /> {s.key}
          </span>
        ))}
      </div>
    </Card>
  );
}

function DonutChart() {
  const slices = [
    { label:"Claude Sonnet", value:34, color:"#3B82F6" },
    { label:"Claude Opus",   value:23, color:"#7C3AED" },
    { label:"Claude Haiku",  value:16, color:"#14B8A6" },
    { label:"Other",         value:12, color:"#D97706" },
    { label:"Cohere",        value:9,  color:"#F43F5E" },
    { label:"Rest",          value:6,  color:"#A855F7" },
  ];
  const R=70, r=46, cx=90, cy=90, C=2*Math.PI*((R+r)/2), sw=R-r;
  let off=0;
  const arcs = slices.map(s=>{
    const len=(s.value/100)*C;
    const el=<circle key={s.label} cx={cx} cy={cy} r={(R+r)/2} fill="none" stroke={s.color} strokeWidth={sw}
      strokeDasharray={`${len} ${C-len}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`}/>;
    off+=len; return el;
  });
  return (
    <Card pad={18} style={{ flex:1, minWidth:0 }}>
      <div style={{ fontFamily:"var(--font-heading)", fontWeight:600, fontSize:"var(--text-16)",
        color:"var(--fg)", letterSpacing:"-0.02em" }}>Model distribution</div>
      <div style={{ fontFamily:"var(--font-sans)", fontSize:"var(--text-sm)", color:"var(--fg-subtle)", marginTop:3, marginBottom:8 }}>Share of spend · MTD</div>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <svg width="180" height="180" viewBox="0 0 180 180" style={{ flex:"none" }}>
          {arcs}
          <text x={cx} y={cy-4} textAnchor="middle" style={{ fontFamily:"var(--font-mono)",fontWeight:600,fontSize:20,fill:"var(--fg)" }}>$48.2K</text>
          <text x={cx} y={cy+14} textAnchor="middle" style={{ fontFamily:"var(--font-sans)",fontSize:10,letterSpacing:"0.06em",fill:"var(--fg-subtle)" }}>TOTAL · MTD</text>
        </svg>
        <div style={{ display:"flex", flexDirection:"column", gap:7, flex:1 }}>
          {slices.map(s=>(
            <div key={s.label} style={{ display:"flex", alignItems:"center", gap:8, fontSize:"var(--text-xs)", fontFamily:"var(--font-sans)" }}>
              <span style={{ width:9, height:9, borderRadius:2, background:s.color, flex:"none" }} />
              <span style={{ color:"var(--fg-secondary)", flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.label}</span>
              <span style={{ fontFamily:"var(--font-mono)", color:"var(--fg-muted)" }}>{s.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

Object.assign(window, { CostAreaChart, DonutChart });
