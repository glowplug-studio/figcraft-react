import {useLibraryVariables} from "./LibraryVariablesContext";
import { useRef, useState } from "react";
import { VariableTable } from "./VariableTable";
import { emptyVariables, type Variables, type VariableType } from "./engine/variables";
import { VariableDetails, type VariableRun } from "./VariableValueCell";

function unique(base:string,names:Set<string>) {
  if (!names.has(base)) return base;
  for(let n=2;n<10000;n++) if (!names.has(base+" "+n)) return base+" "+n;
  return base;
}

type FileResult=Record<string,unknown>;
export function VariablesPanel({data=emptyVariables,run,enabled,error,documentName,importFile}:{documentName:string;importFile:(file:File)=>Promise<FileResult>;data?:Variables;run:VariableRun;enabled:boolean;error:string}) {
  const input=useRef<HTMLInputElement>(null);
  const [format,setFormat]=useState("json"),[transfer,setTransfer]=useState(""),[loading,setLoading]=useState(false);
  function download() {
    const result=run("variable.export",{format});
    if (typeof result?.text!=="string") return;
    const url=URL.createObjectURL(new Blob([result.text],{type:format==="json" ? "application/json" : format==="css" || format==="tailwind" ? "text/css" : "text/plain"}));
    try {
      const link=document.createElement("a");
      link.href=url;link.download=documentName+".variables."+format;
      document.body.append(link);link.click();link.remove();
    } finally {setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }
  async function upload(file:File) {
    setLoading(true);setTransfer("");
    try {
      const result=await importFile(file);
      setTransfer([`Imported ${result.variables} new variables, updated ${result.updated}.`,...(Array.isArray(result.warnings) ? result.warnings : [])].join("\n"));
    } catch (e) {setTransfer(e instanceof Error ? e.message : "Could not import variables");}
    finally {setLoading(false);}
  }
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false), [choice,setChoice]=useState<string>(), [query,setQuery]=useState("");
  const [edit,setEdit]=useState<{id:string;mode?:string;value:string}>();
  const [editingVariable,setEditingVariable]=useState<string>();
  const [creating,setCreating]=useState(false);
  const {sources,remoteCollections,remoteVariables}=useLibraryVariables();
  const local=data.collections.filter(c=>!remoteCollections.has(c.id));
  const [library,setLibrary]=useState<string>();
  const source=sources.find(s=>s.id===library) ?? (!local.length ? sources.find(s=>s.offered.collections.length) : undefined);
  const visible=source?.offered.collections ?? local;
  const active=visible.find(c=>c.id===choice) ?? visible[0];
  function choose(id:string|undefined,library?:string) {
    setChoice(id);setLibrary(library);setQuery("");setEdit(undefined);setCreating(false);setEditingVariable(undefined);
  }
  function create() {
    const name=unique("Collection",new Set(data.collections.map(c=>c.name)));
    const made=run("variable.createCollection",{name});
    if (typeof made?.id==="string") {choose(made.id); setEdit({id:made.id,value:name});setQuery("");}
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
  const list=open && active ? (source?.offered.variables ?? data.variables).filter(v=>v.collection===active.id && v.name.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <fieldset disabled={!enabled}><legend>Local variables</legend>
    <button type="button" onClick={()=>{setOpen(true);dialog.current?.showModal();}}>Open variables ({data.variables.length-remoteVariables.size})</button>
    <dialog ref={dialog} aria-label="Local variables" className="figcraft-variables" onClose={()=>{setOpen(false);setEdit(undefined);setEditingVariable(undefined);setCreating(false);}}
      onKeyDown={e=>e.stopPropagation()}>
      {open && <>
        <header><h2>Local variables</h2>
          <button type="button" disabled={loading} onClick={()=>input.current?.click()}>Import variables</button>
          <input type="file" ref={input} hidden aria-label="Import variables JSON" accept=".json,application/json"
            onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file) void upload(file);}}/>
          <label>Export format<select value={format} onChange={e=>setFormat(e.currentTarget.value)}>
            <option value="json">Variables JSON</option><option value="css">CSS custom properties</option>
            <option value="tailwind">Tailwind CSS</option><option value="dart">Dart constants for Flutter</option>
          </select></label>
          <button type="button" onClick={download}>Export variables</button><button type="button" aria-label="Close variables" onClick={()=>dialog.current?.close()}>Close</button></header>
        {transfer && <p role="status" style={{whiteSpace:"pre-line"}}>{transfer}</p>}
        {error && <p role="alert">{error}</p>}
        <aside aria-label="Variable collections">
          {local.map(c=><button type="button" key={c.id} aria-pressed={active===c} onClick={()=>choose(c.id)}>{c.name}</button>)}
          {sources.map(s=><div key={s.id} role="group" aria-label={s.name}><strong>{s.name}</strong>
            {s.offered.collections.map(c=><button type="button" key={c.id} aria-pressed={source===s && active?.id===c.id}
              onClick={()=>choose(c.id,s.id)}>{c.name}</button>)}</div>)}
          <button type="button" onClick={create}>Create collection</button>
        </aside>
        {active && <>
          <section aria-label="Collection controls">
            {!source && <button type="button" onClick={()=>setEdit({id:active.id,value:active.name})}>Rename collection</button>}
            <button type="button" onClick={()=>{
              const made=source ? run("library.extendCollection",{library:source.id,collection:active.id}) : run("variable.extendCollection",{collection:active.id});
              if (typeof made?.id==="string") choose(made.id);
            }}>Extend collection</button>
            {!source && active.extends===undefined && <button type="button" onClick={()=>addMode()}>Add mode</button>}
            {!source && <button type="button" onClick={()=>{if(run("variable.deleteCollection",{collection:active.id})){setChoice(undefined);setEdit(undefined);setQuery("");}}}>Delete collection</button>}
            {!source && rename}
            <input type="search" aria-label="Search variables" value={query} onChange={e=>setQuery(e.target.value)}/>
          </section>
          <VariableTable readOnly={!!source} key={JSON.stringify([source?.id,active.id,query])} collection={active} rows={list} data={source?.data ?? data} run={run}
            edit={setEditingVariable} rename={m=>setEdit({id:active.id,mode:m.id,value:m.name})} duplicate={addMode}/>
          {!source && <button type="button" aria-expanded={creating} onClick={()=>setCreating(!creating)}>Create variable</button>}
          {creating && <div role="group" aria-label="Variable type">{(["color","number","string","boolean"] as const).map(t=>
            <button type="button" key={t} onClick={()=>createVariable(t)}>{t==="color" ? "Colour" : t[0].toUpperCase()+t.slice(1)}</button>)}</div>}
          {!source && selected && <VariableDetails key={selected.id} v={selected} run={run} close={()=>setEditingVariable(undefined)}/>}
          {!list.length && query && <p>No matching variables</p>}
        </>}
      </>}
    </dialog>
  </fieldset>;
}
