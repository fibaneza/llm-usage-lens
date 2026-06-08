// Strata UI Kit — shared primitives over the design tokens.
const { useState } = React;

function Icon({ name, size = 16, color, style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = "";
      const svg = makeLucide(name, size, color);
      if (svg) ref.current.appendChild(svg);
    }
  }, [name, size, color]);
  return <span ref={ref} style={{ display:"inline-flex", width:size, height:size, ...style }} />;
}
function toPascal(s){ return s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(""); }
function makeLucide(name, size, color){
  const L = window.lucide;
  let data = L && L.icons && (L.icons[toPascal(name)] || L.icons[name]);
  if(!data) return null;
  let children = data;
  if (typeof data[0] === "string") children = Array.isArray(data[2]) ? data[2] : [];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns,"svg");
  svg.setAttribute("width",size); svg.setAttribute("height",size);
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("fill","none");
  svg.setAttribute("stroke", color||"currentColor"); svg.setAttribute("stroke-width","1.75");
  svg.setAttribute("stroke-linecap","round"); svg.setAttribute("stroke-linejoin","round");
  (children||[]).forEach((child)=>{
    if(!Array.isArray(child)) return;
    const [tag,attrs] = child;
    const el = document.createElementNS(ns,tag);
    Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,v));
    svg.appendChild(el);
  });
  return svg;
}

const btnBase = {
  position:"relative", isolation:"isolate", overflow:"hidden",
  display:"inline-flex", alignItems:"center", gap:7, height:34, padding:"0 14px",
  borderRadius:"var(--radius-md)", fontFamily:"var(--font-sans)", fontSize:"var(--text-body)",
  fontWeight:500, border:"1px solid transparent", cursor:"pointer", whiteSpace:"nowrap",
  transition:"transform .14s ease, border-color .2s ease, color .2s ease, box-shadow .2s ease",
};
function Button({ variant="secondary", icon, children, onClick, style }) {
  const [h, setH] = useState(false);
  const variants = {
    primary:   { background:h?"var(--accent-gradient-active)":"var(--accent-gradient)", color:"#fff",
                 boxShadow: h?"0 5px 18px -4px rgba(59,130,246,0.4)":"none",
                 transform: h?"translateY(-1px)":"none" },
    secondary: { background:"var(--surface-2)", color: h?"var(--color-secondary)":"var(--fg)",
                 borderColor: h?"var(--color-primary)":"var(--border)",
                 transform: h?"translateY(-1px)":"none" },
    ghost:     { background: h?"var(--surface-2)":"transparent", color: h?"var(--fg)":"var(--fg-secondary)" },
  };
  const v = variants[variant] || variants.secondary;
  return (
    <button onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} onClick={onClick}
      style={{ ...btnBase, ...v, ...(icon&&!children?{width:34,padding:0,justifyContent:"center"}:{}), ...style }}>
      {icon && <Icon name={icon} size={15} />}{children}
    </button>
  );
}

const badgeKind = {
  pos:     { background:"var(--pos-bg)",  color:"var(--pos)" },
  neg:     { background:"var(--neg-bg)",  color:"var(--neg)" },
  warn:    { background:"var(--warn-bg)", color:"var(--warn)" },
  info:    { background:"var(--info-bg)", color:"var(--info)" },
  solid:   { background:"var(--color-primary)", color:"#fff" },
  neutral: { background:"var(--surface-2)", color:"var(--fg-muted)", border:"1px solid var(--border)" },
};
function Badge({ kind="neutral", icon, children }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, height:22, padding:"0 9px",
      borderRadius:"var(--radius-full)", fontSize:"var(--text-xs)", fontWeight:500,
      fontFamily:"var(--font-sans)", ...badgeKind[kind] }}>
      {icon && <Icon name={icon} size={12} />}{children}
    </span>
  );
}

function Chip({ children, onRemove }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6, height:26, padding:"0 6px 0 10px",
      borderRadius:"var(--radius-full)", background:"var(--surface-2)", border:"1px solid var(--border)",
      color:"var(--fg-secondary)", fontSize:"var(--text-sm)", fontFamily:"var(--font-sans)" }}>
      {children}
      {onRemove && <span onClick={onRemove} style={{ display:"flex", width:16, height:16, alignItems:"center",
        justifyContent:"center", borderRadius:"var(--radius-full)", color:"var(--fg-subtle)", cursor:"pointer" }}>
        <Icon name="x" size={12} /></span>}
    </span>
  );
}

function Delta({ value, up, size="var(--text-xs)" }) {
  return (
    <span style={{ fontFamily:"var(--font-mono)", fontSize:size, fontFeatureSettings:"'tnum' 1",
      color: up ? "var(--neg)" : "var(--pos)" }}>
      {up ? "▲" : "▼"} {value}
    </span>
  );
}

function Card({ children, style, pad=16 }) {
  const [h, setH] = React.useState(false);
  return (
    <div onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{
        position:"relative", overflow:"hidden",
        background:"var(--surface-1)",
        border:"1px solid " + (h?"transparent":"var(--border)"),
        borderRadius:"var(--radius-lg)",
        transform: h?"translateY(-2px)":"translateY(0)",
        boxShadow: h ? "var(--shadow-card-hover)" : "var(--inset-hairline)",
        transition:"transform .22s ease, box-shadow .22s ease, border-color .22s ease",
        padding:pad, ...style
      }}>
      <div style={{ position:"absolute", inset:0, pointerEvents:"none", borderRadius:"var(--radius-lg)",
        backgroundImage:"radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)",
        backgroundSize:"4px 4px", opacity: h?1:0, transition:"opacity .28s ease" }} />
      {children}
    </div>
  );
}

function Money({ value, compact, style }) {
  return <span style={{ fontFamily:"var(--font-mono)", fontFeatureSettings:"'tnum' 1,'zero' 1", ...style }}>
    {fmtMoney(value,{compact})}</span>;
}
function fmtMoney(n, { compact=false }={}) {
  if (compact) {
    if (n >= 1e6) return "$"+(n/1e6).toFixed(2)+"M";
    if (n >= 1e3) return "$"+(n/1e3).toFixed(1)+"K";
    return "$"+n.toFixed(0);
  }
  return "$"+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}

Object.assign(window, { Icon, Button, Badge, Chip, Delta, Card, Money, fmtMoney });
