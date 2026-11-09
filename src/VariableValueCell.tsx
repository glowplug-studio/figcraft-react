import {useLibraryVariables} from "./LibraryVariablesContext";
import { useState } from "react";
import { toCssHex } from "./engine/colour";
import { variableScopes } from "./engine/variable-metadata";
import { inVariableScope, ownVariableValue, resolveVariable, variableIndex, type Variable, type Variables, type VariableValue } from "./engine/variables";

export type VariableRun=(command:string,p:Record<string,unknown>)=>Record<string,unknown>|undefined;
function describe(value:VariableValue|undefined, name:(id:string)=>string):string {
  if (!value) return "—";
  switch (value.type) {
    case "alias": return "→ "+name(value.value);
    case "color": return toCssHex(value.value);
    case "colorAlpha": return "α "+Math.round(value.value.opacity*100)+"% · "+name(value.value.variable);
    case "colorMix": {
      const operand=(op:typeof value.value.from)=>"literal" in op ? toCssHex(op.literal).slice(1) : name(op.variable);
      return operand(value.value.from)+" + "+operand(value.value.to)+" @ "+Math.round(value.value.t*100)+"%";
    }
    default: return String(value.value);
  }
}
export function VariableValueCell({v,mode,data,run,colIndex,readOnly}:{readOnly?:boolean;colIndex?:number;v:Variable;mode:{id:string;name:string};data:Variables;run:VariableRun}) {
  const [editor,setEditor]=useState<"value"|"alias">(), [draft,setDraft]=useState("");
  const {sources,remoteVariables}=useLibraryVariables();
  const value=ownVariableValue(v.values,mode.id), index=variableIndex(data);
  const resolved=resolveVariable(data,v.id,{[v.collection]:mode.id});
  const name=(id:string)=>index.variables.get(id)?.name ?? "Missing variable";
  const calculated=value?.type==="colorAlpha" || value?.type==="colorMix", reference=calculated || value?.type==="alias";
  const cell=v.name+" · "+mode.name, text=describe(value,name);
  function set(value:unknown) {
    if (run("variable.set",{variable:v.id,mode:mode.id,value})) setEditor(undefined);
  }
  if (readOnly) return <td aria-colindex={colIndex} title={describe(resolved,name)}>{text}</td>;
  return <td aria-colindex={colIndex} title={describe(resolved,name)} onKeyDown={e=>{if (editor && e.key==="Escape") {e.preventDefault();e.stopPropagation();setEditor(undefined);}}}>
    {editor==="value" ? <form onSubmit={e=>{e.preventDefault();set(draft);}}>
      <input autoFocus aria-label={"Value for "+cell} value={draft} onFocus={e=>e.target.select()} onChange={e=>setDraft(e.target.value)}/>
      <button type="submit">Apply value</button>
    </form> : <button type="button" aria-label={"Edit "+cell} onClick={()=>{
      if (reference) setEditor("alias");
      else if (value?.type==="boolean") set(!value.value);
      else {setDraft(value ? text : "");setEditor("value");}
    }}>
      {resolved?.type==="color" && <span aria-hidden="true" className="figcraft-style-swatch" style={{background:toCssHex(resolved.value)}}/>}{text}
    </button>}
    {editor==="alias" ? <select autoFocus aria-label={"Alias for "+cell} value={value?.type==="alias" ? value.value : ""} onChange={e=>{
      const library=e.target.selectedOptions[0]?.dataset.library;
      if (!library) set({alias:e.target.value});
      else if (run("library.aliasVariable",{library,alias:e.target.selectedOptions[0].dataset.id,variable:v.id,mode:mode.id})) setEditor(undefined);
    }}>
      <option value="" disabled>Choose variable</option>
      {data.variables.filter(x=>x.resolvedType===v.resolvedType && x.id!==v.id && !remoteVariables.has(x.id)).map(x=><option key={x.id} value={x.id}>
        {index.collections.get(x.collection)?.name ?? x.collection}/{x.name}
      </option>)}
      {sources.map(s=><optgroup label={s.name} key={s.id}>{s.offered.variables.filter(x=>x.resolvedType===v.resolvedType).map(x=>
        <option key={x.id} value={JSON.stringify([s.id,x.id])} data-library={s.id} data-id={x.id}>{x.name}</option>)}</optgroup>)}
    </select> : <button type="button" aria-label={"Choose alias for "+cell} onClick={()=>setEditor("alias")}>Alias</button>}
    {reference && resolved && <button type="button" onClick={()=>set(resolved.value)}>Detach {calculated ? "calculation" : "alias"}</button>}
    {v.overrides?.includes(mode.id) && <button type="button" onClick={()=>run("variable.resetOverride",{variable:v.id,mode:mode.id})}>Reset override</button>}
  </td>;
}

const scopeLabels:Record<string,string>={
  FRAME_FILL:"Frame fill",SHAPE_FILL:"Shape fill",TEXT_FILL:"Text fill",STROKE_COLOR:"Stroke",EFFECT_COLOR:"Effects",
  CORNER_RADIUS:"Corner radius",WIDTH_HEIGHT:"Width and height",GAP:"Gap and padding",OPACITY:"Layer opacity",STROKE_FLOAT:"Stroke",
  EFFECT_FLOAT:"Effects",FONT_WEIGHT:"Font weight",FONT_SIZE:"Font size",LINE_HEIGHT:"Line height",LETTER_SPACING:"Letter spacing",
  PARAGRAPH_SPACING:"Paragraph spacing",PARAGRAPH_INDENT:"Paragraph indent",TEXT_CONTENT:"Text content",FONT_FAMILY:"Font family",FONT_STYLE:"Font style",
};

const codePlatforms = ["WEB", "iOS", "ANDROID"] as const;

export function VariableDetails({v,run,close}:{v:Variable;run:VariableRun;close:()=>void}) {
  const [name,setName]=useState(v.name), [description,setDescription]=useState(v.description);
  const [hidden,setHidden]=useState(!!v.hiddenFromPublishing);
  const [scopes,setScopes]=useState<readonly string[]|undefined>(v.scopes);
  const includesScope=(k:string)=>inVariableScope(scopes,k);
  const [code,setCode]=useState({...v.codeSyntax});
  return <form aria-label="Variable details" onSubmit={e=>{
    e.preventDefault();
    const changes:Record<string,unknown>={};
    if (name!==v.name) changes.name=name;
    if (description!==v.description) changes.description=description;
    if (hidden!==!!v.hiddenFromPublishing) changes.hiddenFromPublishing=hidden;
    if (scopes!==v.scopes) changes.scopes=scopes ?? null;
    const syntax=Object.fromEntries(codePlatforms.filter(k=>(code[k] ?? "")!==(v.codeSyntax?.[k] ?? "")).map(k=>[k,code[k]]));
    if (Object.keys(syntax).length) changes.codeSyntax=syntax;
    if (!Object.keys(changes).length || run("variable.update",{variable:v.id,...changes})) close();
  }}>
    <label>Name<input autoFocus required disabled={v.extends!==undefined} aria-label="Variable name" value={name} onFocus={e=>e.target.select()} onChange={e=>setName(e.target.value)}/></label>
    <label>Description<textarea aria-label="Variable description" value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <fieldset><legend>Scopes</legend>
      <label><input type="checkbox" checked={scopes===undefined} onChange={e=>setScopes(e.target.checked ? undefined : [])}/>All scopes</label>
      {variableScopes[v.resolvedType].map(k=><label key={k}><input type="checkbox" checked={includesScope(k)}
        onChange={e=>setScopes(variableScopes[v.resolvedType].filter(x=>x===k ? e.target.checked : includesScope(x)))}/>{scopeLabels[k]}</label>)}
    </fieldset>
    <fieldset><legend>Code syntax</legend>{codePlatforms.map(k=><label key={k}>{k}
      <input aria-label={k+" code syntax"} value={code[k] ?? ""} onChange={e=>setCode({...code,[k]:e.target.value})}/>
    </label>)}</fieldset>
    <label><input type="checkbox" checked={hidden} onChange={e=>setHidden(e.target.checked)}/>Hide from publishing</label>
    <button type="submit">Save variable</button><button type="button" onClick={close}>Close details</button>
  </form>;
}
