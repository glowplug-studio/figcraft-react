import { useState } from "react";
import type { SharedStyle } from "./engine/shared-styles";
import { styleBindingType } from "./engine/style-definitions";
import { canonicalBinding } from "./engine/style-variables";
import { inVariableScope, type Variables } from "./engine/variables";
import type { Run } from "./StyleEditor";

const textScopes:Record<string,string>={fontSize:"FONT_SIZE",fontFamily:"FONT_FAMILY",fontStyle:"FONT_STYLE",lineHeight:"LINE_HEIGHT",letterSpacing:"LETTER_SPACING"};

export function StyleVariablePicker({style,field,label,data,run}:{style:SharedStyle;field:string;label:string;data?:Variables;run:Run}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const type=styleBindingType(style,field);
  if (!type) return null;
  const ref=style.bound?.[canonicalBinding(field)];
  const variable=ref===undefined ? undefined : data?.variables.find(v=>v.id===ref);
  const scopes=style.type==="text" ? [textScopes[field]] : style.type==="effect" ? [type==="color" ? "EFFECT_COLOR" : "EFFECT_FLOAT"] :
    style.type==="paint" ? ["FRAME_FILL","SHAPE_FILL","TEXT_FILL","STROKE_COLOR"] : [];
  const needle=query.trim().toLowerCase();
  const groups=open ? data?.collections.map(c=>({name:c.name,id:c.id,rows:data.variables.filter(v=>v.collection===c.id &&
    v.resolvedType===type && (!scopes.length || scopes.some(s=>inVariableScope(v.scopes,s))) && v.name.toLowerCase().includes(needle))})).filter(g=>g.rows.length) : undefined;
  function bind(id?:string) {
    if (run("style.bind",{style:style.id,field,variable:id ?? null})) {setOpen(false);setQuery("");}
  }
  return <span className="figcraft-variable-field">
    {variable ? <button type="button" aria-label={"Detach variable from "+label} onClick={()=>bind()}>{variable.name}</button> :
      <button type="button" aria-label={"Bind variable to "+label} aria-expanded={open} onClick={()=>{setOpen(!open);setQuery("");}}>Bind variable</button>}
    {open && <span role="group" aria-label={"Variables for "+label} onKeyDown={e=>{
      if (e.key==="Escape") {e.preventDefault();e.stopPropagation();setOpen(false);}
    }}>
      <input type="search" aria-label="Search variables" autoFocus value={query} onChange={e=>setQuery(e.target.value)}/>
      {groups?.map(g=><span role="group" aria-label={g.name} key={g.id}><small>{g.name}</small>{g.rows.map(v=><button type="button" key={v.id} onClick={()=>bind(v.id)}>{v.name}</button>)}</span>)}
      {!groups?.length && <span>No matching variables</span>}
    </span>}
  </span>;
}
