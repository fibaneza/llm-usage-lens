// Strata UI Kit — sortable cost-by-model table with spec-accurate model colors.
const { useState: useStateMT } = React;

const ROWS = [
  { model:"Claude Sonnet", color:"#3B82F6", inv:842109, intok:512.4, cost:16402.18, pct:34.0, up:true,  d:"21.4%" },
  { model:"Claude Opus",   color:"#7C3AED", inv:410882, intok:301.0, cost:11090.44, pct:23.0, up:true,  d:"8.2%"  },
  { model:"Claude Haiku",  color:"#14B8A6", inv:288540, intok:198.7, cost:7713.66,  pct:16.0, up:false, d:"3.1%"  },
  { model:"Other",         color:"#D97706", inv:196304, intok:142.1, cost:5785.24,  pct:12.0, up:true,  d:"12.0%" },
  { model:"Cohere Command",color:"#F43F5E", inv:131022, intok:90.4,  cost:4338.93,  pct:9.0,  up:false, d:"5.6%"  },
  { model:"Mistral Large", color:"#A855F7", inv:74510,  intok:51.2,  cost:2891.62,  pct:6.0,  up:false, d:"1.2%"  },
];

const COLS = [
  { key:"model",  label:"Model",          num:false },
  { key:"inv",    label:"Invocations",    num:true  },
  { key:"intok",  label:"Input tok (M)",  num:true  },
  { key:"cost",   label:"Cost",           num:true  },
  { key:"pct",    label:"% of total",     num:true  },
];

function ModelTable() {
  const [sort, setSort] = useStateMT({ key:"cost", dir:"desc" });
  const sorted = [...ROWS].sort((a,b)=>{
    const m = sort.dir==="asc"?1:-1;
    return a[sort.key]<b[sort.key]?-m:(a[sort.key]>b[sort.key]?m:0);
  });
  const toggle = k => setSort(s=>s.key===k?{key:k,dir:s.dir==="asc"?"desc":"asc"}:{key:k,dir:"desc"});
  const maxPct = Math.max(...ROWS.map(r=>r.pct));

  return (
    <Card pad={0} style={{ overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"14px 18px", borderBottom:"1px solid var(--border)" }}>
        <div style={{ fontFamily:"var(--font-heading)", fontWeight:600, fontSize:"var(--text-16)",
          color:"var(--fg)", letterSpacing:"-0.02em" }}>Cost by model</div>
        <Button variant="ghost" icon="arrow-up-right"
          style={{ height:28, color:"var(--color-secondary)", fontSize:"var(--text-sm)" }}>View all</Button>
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr>
          {COLS.map(c=>(
            <th key={c.key} onClick={()=>toggle(c.key)} style={{ textAlign:c.num?"right":"left",
              padding:"10px 18px", fontSize:"var(--text-2xs)", letterSpacing:"var(--tracking-label)",
              textTransform:"uppercase", fontWeight:500, fontFamily:"var(--font-sans)",
              color: sort.key===c.key?"var(--fg)":"var(--fg-subtle)", cursor:"pointer",
              borderBottom:"1px solid var(--border)", whiteSpace:"nowrap", userSelect:"none" }}>
              {c.label}
              {sort.key===c.key && <span style={{ display:"inline-flex", verticalAlign:"-2px", marginLeft:3 }}>
                <Icon name={sort.dir==="asc"?"chevron-up":"chevron-down"} size={12}/></span>}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map((r,i)=><Row key={r.model} r={r} maxPct={maxPct} last={i===sorted.length-1}/>)}
        </tbody>
      </table>
    </Card>
  );
}

function Row({ r, maxPct, last }) {
  const [h, setH] = useStateMT(false);
  const td = { padding:"10px 18px", fontSize:"var(--text-sm)", color:"var(--fg-secondary)",
    fontFamily:"var(--font-sans)", borderBottom:last?"none":"1px solid var(--border-subtle)" };
  const num = { ...td, textAlign:"right", fontFamily:"var(--font-mono)", fontFeatureSettings:"'tnum' 1,'zero' 1" };
  return (
    <tr onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{ background: h?"var(--surface-hover)":"transparent", transition:"background .1s" }}>
      <td style={td}>
        <span style={{ display:"flex", alignItems:"center", gap:9 }}>
          <span style={{ width:9, height:9, borderRadius:2, background:r.color, flex:"none" }} />
          <span style={{ color:"var(--fg)", fontWeight:500 }}>{r.model}</span>
        </span>
      </td>
      <td style={num}>{r.inv.toLocaleString("en-US")}</td>
      <td style={num}>{r.intok.toFixed(1)}M</td>
      <td style={{ ...num, color:"var(--fg)" }}>{fmtMoney(r.cost)}</td>
      <td style={num}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
          <span style={{ color:"var(--fg-muted)" }}>{r.pct.toFixed(1)}%</span>
          <span style={{ width:48, height:5, borderRadius:3, background:"var(--surface-2)", overflow:"hidden", flex:"none" }}>
            <span style={{ display:"block", height:"100%", width:`${(r.pct/maxPct)*100}%`, background:r.color, borderRadius:3 }}/>
          </span>
        </span>
      </td>
    </tr>
  );
}

Object.assign(window, { ModelTable });
