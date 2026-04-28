export function StatWidget({ label, value, sub, color="#38bdf8", icon:Icon }: { label:string; value:string|number; sub?:string; color?:string; icon?:React.ElementType }) {
  return (
    <div style={{ position:"relative", padding:"12px 16px", borderRadius:10, background:"#0d1f3c", border:"1px solid #1a3066", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${color}60,transparent)` }}/>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <span className="label">{label}</span>
        {Icon && <Icon size={14} style={{ color, opacity:0.6 }}/>}
      </div>
      <div className="mono" style={{ fontSize:24, fontWeight:900, color, textShadow:`0 0 16px ${color}50`, lineHeight:1 }}>{value}</div>
      {sub && <div className="label" style={{ marginTop:4 }}>{sub}</div>}
    </div>
  );
}
