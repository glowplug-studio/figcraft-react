import {useLibraryVariables} from "./LibraryVariablesContext";
import { useRef, useState, type ReactNode } from "react";
import type { SharedStyle } from "./engine/shared-styles";
import { styleBindingType } from "./engine/style-definitions";
import { canonicalBinding } from "./engine/style-variables";
import { inVariableScope, type Variable, type Variables } from "./engine/variables";
import type { Document } from "./engine/document";
import { layerFieldScope } from "./engine/layer-variable-bindings";
import { compareScalarKeys } from "./engine/text-breaks";
import type { VariableType } from "./engine/variables";
import type { Run } from "./StyleEditor";

export type InspectorDispatch = (command:string, params?:unknown) => ReturnType<Run>;

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

export function LayerVariablePicker({doc,ids,field,label,type,run,children}:{children?:ReactNode;doc:Document;ids:readonly string[];field?:string;label:string;type:VariableType;run:Run}) {
  const {sources}=useLibraryVariables();
  if (!field || (!doc.variables?.variables.length && !sources.some(s=>s.offered.variables.length)) || !ids.length) return children ?? null;
  const nodes=ids.map(id=>doc.nodes[id]);
  const bound=nodes[0].boundVariables;
  const key=bound && Object.keys(bound).sort(compareScalarKeys).find(k=>canonicalBinding(k)===field) || field;
  const ref=bound && Object.hasOwn(bound,key) ? bound[key] : undefined;
  const reference=nodes.every(n=>n.boundVariables?.[key]===ref) ? ref : undefined;
  const scopes=[...new Set(nodes.map(n=>layerFieldScope(n,field)).filter((s):s is string=>s!==undefined))];
  return <VariablePicker label={label} data={doc.variables} type={type} scopes={scopes} reference={reference} allScopes allowNumber={field==="characters"}
    remote={(library,variable)=>!!run("library.bindVariable",{library,variable,ids,field:reference ? key : field})}
    apply={id=>!!run("variable.bind",{ids,field:reference ? key : field,variable:id ?? null})}>{children}</VariablePicker>;
}

function VariablePicker({label,data,type,scopes,reference,apply,children,allScopes,allowNumber,remote}:{remote?:(library:string,variable:string)=>boolean;children?:ReactNode;allScopes?:boolean;allowNumber?:boolean;label:string;data?:Variables;type:VariableType;scopes:readonly string[];
  reference?:string;apply:(id?:string)=>boolean}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const {sources,remoteCollections}=useLibraryVariables();
  const trigger=useRef<HTMLButtonElement>(null);
  const variable=reference===undefined ? undefined : data?.variables.find(v=>v.id===reference);
  const needle=query.trim().toLowerCase();
  function matches(v:Variable) {
    if (v.resolvedType!==type && !(allowNumber && v.resolvedType==="number")) return false;
    if (!v.name.toLowerCase().includes(needle)) return false;
    const inScope=(scope:string)=>inVariableScope(v.scopes,scope);
    return !scopes.length || (allScopes ? scopes.every(inScope) : scopes.some(inScope));
  }
  const groups:{name:string;id:string;library?:string;rows:Variable[]}[]=open && data ? data.collections.filter(c=>!remoteCollections.has(c.id)).map(c=>({name:c.name,id:c.id,
    rows:data.variables.filter(v=>v.collection===c.id && matches(v))})).filter(g=>g.rows.length) : [];
  if (open && remote) for (const source of sources) {
    const byCollection=new Map<string,Variable[]>();
    for (const v of source.offered.variables) if (matches(v)) {
      const rows=byCollection.get(v.collection);if (rows) rows.push(v);else byCollection.set(v.collection,[v]);
    }
    for (const c of source.offered.collections) {
      const rows=byCollection.get(c.id);
      if (rows) groups.push({name:source.name+" / "+c.name,id:c.id,library:source.id,rows});
    }
  }
  function close() {
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  }
  function bind(id?:string) {
    if (apply(id)) close();
  }
  const picker = <span className="figcraft-variable-field" onBlur={event=>{
    if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    {variable && <button type="button" aria-label={"Detach variable from "+label} onClick={()=>bind()}>{variable.name}</button>}
    <button ref={trigger} type="button" aria-label={(variable ? "Change variable for " : "Bind variable to ")+label} aria-expanded={open}
      onClick={()=>{setOpen(!open);setQuery("");}}>{variable ? "Change variable" : "Bind variable"}</button>
    {open && <span role="group" aria-label={"Variables for "+label} onKeyDown={e=>{
      if (e.key==="Escape") {e.preventDefault();e.stopPropagation();close();}
    }}>
      <input type="search" aria-label="Search variables" autoFocus value={query} onChange={e=>setQuery(e.target.value)}/>
      {groups?.map(g=><span role="group" aria-label={g.name} key={JSON.stringify([g.library,g.id])}><small>{g.name}</small>{g.rows.map(v=><button type="button" key={v.id} onClick={()=>{if (!g.library) bind(v.id);else if (remote?.(g.library,v.id)) close();}}>{v.name}</button>)}</span>)}
      {!groups?.length && <span>No matching variables</span>}
    </span>}
  </span>;
  if (!children) return picker;
  return <div className="figcraft-bindable-control">{variable ? <span>{label}</span> : children}{picker}</div>;
}
