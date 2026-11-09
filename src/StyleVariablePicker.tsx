import { useState } from "react";
import type { SharedStyle } from "./engine/shared-styles";
import { styleBindingType } from "./engine/style-definitions";
import { canonicalBinding } from "./engine/style-variables";
import { inVariableScope, type Variables } from "./engine/variables";
import type { Document } from "./engine/document";
import { layerFieldScope } from "./engine/layer-variable-bindings";
import { compareScalarKeys } from "./engine/text-breaks";
import type { VariableType } from "./engine/variables";
import type { Run } from "./StyleEditor";

const textScopes:Record<string,string>={fontSize:"FONT_SIZE",fontFamily:"FONT_FAMILY",fontStyle:"FONT_STYLE",lineHeight:"LINE_HEIGHT",letterSpacing:"LETTER_SPACING"};

export function StyleVariablePicker({style,field,label,data,run}:{style:SharedStyle;field:string;label:string;data?:Variables;run:Run}) {
  const type=styleBindingType(style,field);
  if (!type) return null;
  const ref=style.bound?.[canonicalBinding(field)];
  const scopes=style.type==="text" ? [textScopes[field]] : style.type==="effect" ? [type==="color" ? "EFFECT_COLOR" : "EFFECT_FLOAT"] :
    style.type==="paint" ? ["FRAME_FILL","SHAPE_FILL","TEXT_FILL","STROKE_COLOR"] : [];
  return <VariablePicker label={label} data={data} type={type} scopes={scopes} reference={ref}
    apply={id=>!!run("style.bind",{style:style.id,field,variable:id ?? null})}/>;
}

export function LayerVariablePicker({doc,ids,field,label,type,run}:{doc:Document;ids:readonly string[];field:string;label:string;type:VariableType;run:Run}) {
  if (!doc.variables?.variables.length || !ids.length) return null;
  const nodes=ids.map(id=>doc.nodes[id]);
  const bound=nodes[0].boundVariables;
  const key=bound && Object.keys(bound).sort(compareScalarKeys).find(k=>canonicalBinding(k)===field) || field;
  const ref=bound && Object.hasOwn(bound,key) ? bound[key] : undefined;
  const reference=nodes.every(n=>n.boundVariables?.[key]===ref) ? ref : undefined;
  const scopes=[...new Set(nodes.map(n=>layerFieldScope(n,field)).filter((s):s is string=>s!==undefined))];
  return <VariablePicker label={label} data={doc.variables} type={type} scopes={scopes} reference={reference}
    apply={id=>!!run("variable.bind",{ids,field:reference ? key : field,variable:id ?? null})}/>;
}

function VariablePicker({label,data,type,scopes,reference,apply}:{label:string;data?:Variables;type:VariableType;scopes:readonly string[];
  reference?:string;apply:(id?:string)=>boolean}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const variable=reference===undefined ? undefined : data?.variables.find(v=>v.id===reference);
  const needle=query.trim().toLowerCase();
  const groups=open ? data?.collections.map(c=>({name:c.name,id:c.id,rows:data.variables.filter(v=>v.collection===c.id &&
    v.resolvedType===type && (!scopes.length || scopes.some(s=>inVariableScope(v.scopes,s))) && v.name.toLowerCase().includes(needle))})).filter(g=>g.rows.length) : undefined;
  function bind(id?:string) {
    if (apply(id)) {setOpen(false);setQuery("");}
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
