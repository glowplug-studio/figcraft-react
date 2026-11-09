import { useRef, useState } from "react";
import { emptyVariables, type Variables, type VariableType } from "./engine/variables";
import { VariableDetails, VariableValueCell, type VariableRun } from "./VariableValueCell";

function unique(base:string,names:Set<string>) {
  if (!names.has(base)) return base;
  for(let n=2;n<10000;n++) if (!names.has(base+" "+n)) return base+" "+n;
  return base;
}

export function VariablesPanel({data=emptyVariables,run,enabled,error}:{data?:Variables;run:VariableRun;enabled:boolean;error:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false), [choice,setChoice]=useState<string>(), [query,setQuery]=useState("");
  const [edit,setEdit]=useState<{id:string;mode?:string;value:string}>();
  const [editingVariable,setEditingVariable]=useState<string>();
  const [creating,setCreating]=useState(false);
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
  const selected=data.variables.find(v=>v.id===editingVariable && v.collection===active?.id);
  function createVariable(type:VariableType) {
    if (!active) return;
    const base=type[0].toUpperCase()+type.slice(1);
    const name=unique(base,new Set(data.variables.filter(v=>v.collection===active.id).map(v=>v.name)));
    const made=run("variable.create",{collection:active.id,name,type});
    if (typeof made?.id==="string") {setQuery("");setCreating(false);setEditingVariable(made.id);}
  }
  const list=open && active ? data.variables.filter(v=>v.collection===active.id && v.name.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <fieldset disabled={!enabled}><legend>Local variables</legend>
    <button type="button" onClick={()=>{setOpen(true);dialog.current?.showModal();}}>Open variables ({data.variables.length})</button>
    <dialog ref={dialog} aria-label="Local variables" className="figcraft-variables" onClose={()=>{setOpen(false);setEdit(undefined);setEditingVariable(undefined);setCreating(false);}}
      onKeyDown={e=>e.stopPropagation()}>
      {open && <>
        <header><h2>Local variables</h2><button type="button" aria-label="Close variables" onClick={()=>dialog.current?.close()}>Close</button></header>
        {error && <p role="alert">{error}</p>}
        <aside aria-label="Variable collections">
          {data.collections.map(c=><button type="button" key={c.id} aria-pressed={active===c} onClick={()=>{setChoice(c.id);setQuery("");setEdit(undefined);setCreating(false);setEditingVariable(undefined);}}>{c.name}</button>)}
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
            <button type="button" onClick={()=>{if(run("variable.deleteCollection",{collection:active.id})){setChoice(undefined);setEdit(undefined);setQuery("");}}}>Delete collection</button>
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
          {list.map(v=><tr key={v.id}><th scope="row" title={v.description}>
            <button type="button" aria-label={"Edit variable "+v.name} onClick={()=>setEditingVariable(v.id)}>{v.name}</button>
            <details><summary aria-label={"Options for variable "+v.name}>⋯</summary>
              <button type="button" onClick={()=>run("variable.duplicate",{variable:v.id})}>Duplicate variable</button>
              <button type="button" disabled={v.extends!==undefined} onClick={()=>run("variable.delete",{variable:v.id})}>Delete variable</button>
            </details></th>
            {active.modes.map(m=><VariableValueCell key={m.id} v={v} mode={m} data={data} run={run}/>)}</tr>)}
          </tbody></table></div>
          <button type="button" aria-expanded={creating} onClick={()=>setCreating(!creating)}>Create variable</button>
          {creating && <div role="group" aria-label="Variable type">{(["color","number","string","boolean"] as const).map(t=>
            <button type="button" key={t} onClick={()=>createVariable(t)}>{t==="color" ? "Colour" : t[0].toUpperCase()+t.slice(1)}</button>)}</div>}
          {selected && <VariableDetails key={selected.id} v={selected} run={run} close={()=>setEditingVariable(undefined)}/>}
          {!list.length && query && <p>No matching variables</p>}
        </>}
      </>}
    </dialog>
  </fieldset>;
}
