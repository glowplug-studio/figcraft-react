import { useRef, useState } from "react";
import { toCssHex } from "./engine/colour";
import { emptyVariables, ownVariableValue, resolveVariable, variableIndex, type Variables, type VariableValue } from "./engine/variables";

function display(value:VariableValue|undefined, name:(id:string)=>string):string {
  if (!value) return "—";
  switch (value.type) {
    case "alias": return "→ "+name(value.value);
    case "color": return toCssHex(value.value);
    case "colorAlpha": return "α "+Math.round(value.value.opacity*100)+"% · "+name(value.value.variable);
    case "colorMix": {
      const operand=(op:typeof value.value.from)=>"literal" in op ? toCssHex(op.literal) : name(op.variable);
      return operand(value.value.from)+" + "+operand(value.value.to)+" @ "+Math.round(value.value.t*100)+"%";
    }
    default: return String(value.value);
  }
}

function unique(base:string,names:Set<string>) {
  if (!names.has(base)) return base;
  for(let n=2;n<10000;n++) if (!names.has(base+" "+n)) return base+" "+n;
  return base;
}

type Run=(command:string,p:Record<string,unknown>)=>Record<string,unknown>|undefined;
export function VariablesPanel({data=emptyVariables,run,enabled}:{data?:Variables;run:Run;enabled:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false), [choice,setChoice]=useState<string>(), [query,setQuery]=useState("");
  const [edit,setEdit]=useState<{id:string;mode?:string;value:string}>();
  const active=data.collections.find(c=>c.id===choice) ?? data.collections[0];
  function create() {
    const name=unique("Collection",new Set(data.collections.map(c=>c.name)));
    const made=run("variable.createCollection",{name});
    if (typeof made?.id==="string") {setChoice(made.id); setEdit({id:made.id,value:name});setQuery("");}
  }
  function addMode(from?:string) {
    if (!active) return;
    const name=unique("Mode",new Set(active.modes.map(m=>m.name)));
    const made=run("variable.addMode",{collection:active.id,name,...(from!==undefined && {from})});
    if (typeof made?.id==="string") setEdit({id:active.id,mode:made.id,value:name});
  }
  function accept() {
    if (!edit) return;
    const result=edit.mode===undefined ? run("variable.renameCollection",{collection:edit.id,name:edit.value}) :
      run("variable.renameMode",{collection:edit.id,mode:edit.mode,name:edit.value});
    if (result) setEdit(undefined);
  }
  const rename=edit && <form onSubmit={e=>{e.preventDefault();accept();}} onKeyDown={e=>{
    if (e.key==="Escape") {e.preventDefault();e.stopPropagation();setEdit(undefined);}
  }}>
    <input autoFocus required aria-label={edit.mode===undefined ? "Collection name" : "Mode name"} value={edit.value}
      onFocus={e=>e.target.select()} onChange={e=>setEdit({...edit,value:e.target.value})}/>
    <button type="submit">Save name</button><button type="button" onClick={()=>setEdit(undefined)}>Cancel</button>
  </form>;
  const name=(id:string)=>variableIndex(data).variables.get(id)?.name ?? id;
  const list=open && active ? data.variables.filter(v=>v.collection===active.id && v.name.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <fieldset disabled={!enabled}><legend>Local variables</legend>
    <button type="button" onClick={()=>{setOpen(true);dialog.current?.showModal();}}>Open variables ({data.variables.length})</button>
    <dialog ref={dialog} aria-label="Local variables" className="figcraft-variables" onClose={()=>{setOpen(false);setEdit(undefined);}}
      onKeyDown={e=>e.stopPropagation()}>
      {open && <>
        <header><h2>Local variables</h2><button type="button" aria-label="Close variables" onClick={()=>dialog.current?.close()}>Close</button></header>
        <aside aria-label="Variable collections">
          {data.collections.map(c=><button type="button" key={c.id} aria-pressed={active===c} onClick={()=>{setChoice(c.id);setQuery("");setEdit(undefined);}}>{c.name}</button>)}
          <button type="button" onClick={create}>Create collection</button>
        </aside>
        {active && <>
          <section aria-label="Collection controls">
            <button type="button" onClick={()=>setEdit({id:active.id,value:active.name})}>Rename collection</button>
            <button type="button" onClick={()=>{
              const made=run("variable.extendCollection",{collection:active.id});
              if (typeof made?.id==="string") {setChoice(made.id);setEdit(undefined);setQuery("");}
            }}>Extend collection</button>
            {active.extends===undefined && <button type="button" onClick={()=>addMode()}>Add mode</button>}
            {rename}
            <input type="search" aria-label="Search variables" value={query} onChange={e=>setQuery(e.target.value)}/>
          </section>
          <div className="figcraft-variable-table"><table aria-label={active.name+" variables"}><thead><tr><th>Name</th>
          {active.modes.map((m,index)=><th key={m.id} scope="col">{m.name}
            {active.extends===undefined && <details><summary aria-label={"Options for "+m.name}>⋯</summary>
              <button type="button" onClick={()=>setEdit({id:active.id,mode:m.id,value:m.name})}>Rename mode</button>
              <button type="button" onClick={()=>addMode(m.id)}>Duplicate mode</button>
              {([-1,1] as const).map(dir=><button type="button" key={dir} disabled={index+dir<0 || index+dir>=active.modes.length}
                onClick={()=>run("variable.moveMode",{collection:active.id,mode:m.id,to:index+dir})}>{dir<0 ? "Move left" : "Move right"}</button>)}
              <button type="button" disabled={active.modes.length===1} onClick={()=>run("variable.removeMode",{collection:active.id,mode:m.id})}>Remove mode</button>
            </details>}
          </th>)}</tr></thead><tbody>
          {list.map(v=><tr key={v.id}><th scope="row" title={v.description}>{v.name}</th>{active.modes.map(m=>{
            const shown=resolveVariable(data,v.id,{[active.id]:m.id});
            return <td key={m.id} title={display(shown,name)}>
              {shown?.type==="color" && <span aria-hidden="true" className="figcraft-style-swatch" style={{background:toCssHex(shown.value)}}/>}
              {display(ownVariableValue(v.values,m.id),name)}
            </td>;
          })}</tr>)}</tbody></table></div>
          {!list.length && query && <p>No matching variables</p>}
        </>}
      </>}
    </dialog>
  </fieldset>;
}
