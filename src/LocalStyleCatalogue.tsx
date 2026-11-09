import { useState } from "react";
import type { EditorEngine } from "./engine/editor";
import { EditStyle, StyleSwatch, type Run } from "./StyleEditor";
import type { SharedStyle } from "./engine/shared-styles";

const kinds = [["text","Text styles"],["paint","Colour styles"],["effect","Effect styles"],["grid","Grid styles"]] as const;

const folderOf = (name:string) => name.slice(0,Math.max(0,name.lastIndexOf("/"))).trim();
export const styleLeaf = (name:string) => name.includes("/") ? name.slice(name.lastIndexOf("/")+1).trim() : name;

/** Root styles first, then folders in the order in which each first appears in the catalogue. */
export function groupStyles(styles:readonly SharedStyle[]) {
  const groups = new Map<string,SharedStyle[]>([["",[]]]);
  for (const style of styles) {
    const folder = folderOf(style.name);
    const siblings = groups.get(folder);
    if (siblings) siblings.push(style);
    else groups.set(folder,[style]);
  }
  return [...groups].filter(([,list])=>list.length);
}

function KindList({styles, edit, run}:{styles:readonly SharedStyle[]; edit:(id:string)=>void; run:Run}) {
  const groups = groupStyles(styles);
  const shown = groups.flatMap(([,list])=>list);
  const positions = new Map(shown.map((s,i)=>[s.id,i]));
  const [renaming,setRenaming] = useState<string>();
  const [name,setName] = useState("");
  const [menu,setMenu] = useState<string>();
  const [drag,setDrag] = useState<string>();
  function move(id:string,to:number) {
    const from = shown.findIndex(s=>s.id === id);
    if (from < 0 || from === to || to < 0 || to >= shown.length) return;
    const rest = shown.filter(s=>s.id !== id);
    const below = rest[to], near = rest[to-1] ?? below;
    run("style.move",{styles:[id],folder:folderOf(near.name),...(below && {before:below.id})});
    setMenu(undefined);
  }
  function rename(folder:string) { setRenaming(folder); setName(folder); setMenu(undefined); }
  function submitFolder() {
    if (name.trim() === renaming || run("style.renameFolder",{folder:renaming,name})) setRenaming(undefined);
  }
  return <>{groups.map(([folder,list])=><div key={folder}>
    {folder && (renaming === folder ? <form onSubmit={e=>{e.preventDefault();submitFolder();}}>
      <input autoFocus aria-label="Folder name" required value={name} onFocus={e=>e.target.select()} onChange={e=>setName(e.target.value)}
        onKeyDown={e=>{if (e.key === "Escape") {e.preventDefault();e.stopPropagation();setRenaming(undefined);}}}/>
      <button type="submit">Save folder</button><button type="button" onClick={()=>setRenaming(undefined)}>Cancel</button>
    </form> : <div className="figcraft-style-option" onContextMenu={e=>{e.preventDefault();rename(folder);}}>
      <span>{folder}</span><button type="button" aria-label={"Rename folder "+folder} onClick={()=>rename(folder)}>Rename</button>
    </div>)}
    {list.map(style=>{
      const index = positions.get(style.id)!;
      return <div key={style.id} className="figcraft-style-option" onDragOver={e=>{if (drag) e.preventDefault();}}
        onDrop={e=>{if (drag) {e.preventDefault();move(drag,index);setDrag(undefined);}}}
        onBlur={e=>{if (!e.currentTarget.contains(e.relatedTarget)) setMenu(id=>id===style.id ? undefined : id);}}
        onContextMenu={e=>{e.preventDefault();setMenu(style.id);}}>
        <button type="button" aria-label={"Edit "+style.name} title={[style.name,style.description].filter(Boolean).join("\n")}
          draggable onDragStart={e=>{e.dataTransfer.setData("text/plain",style.id);setDrag(style.id);}}
          onDragEnd={()=>setDrag(undefined)} onClick={()=>edit(style.id)}><StyleSwatch style={style}/>{styleLeaf(style.name)}</button>
        <button type="button" aria-label={"Options for "+style.name} aria-expanded={menu === style.id}
          onClick={()=>setMenu(menu===style.id ? undefined : style.id)}>⋯</button>
        {menu === style.id && <div className="figcraft-style-actions" onKeyDown={e=>{
          if (e.key==="Escape") {e.stopPropagation();setMenu(undefined);}
        }}>
          <button type="button" onClick={()=>edit(style.id)}>Edit style</button>
          <button type="button" onClick={()=>{run("style.duplicate",{style:style.id});setMenu(undefined);}}>Duplicate</button>
          <button type="button" onClick={()=>{run("style.delete",{style:style.id});setMenu(undefined);}}>Delete</button>
          <button type="button" disabled={index===0} onClick={()=>move(style.id,index-1)}>Move up</button>
          <button type="button" disabled={index===shown.length-1} onClick={()=>move(style.id,index+1)}>Move down</button>
        </div>}
      </div>;
    })}
  </div>)}</>;
}

export function LocalStyleCatalogue({styles,enabled,run,engine}:{engine:EditorEngine;styles:readonly SharedStyle[];enabled:boolean;run:Run}) {
  const [editing,setEditing] = useState<string>();
  const style = styles.find(s=>s.id === editing);
  return <fieldset disabled={!enabled} aria-label="Local styles">
    <legend>Local styles</legend>
    {style ? <EditStyle engine={engine} key={style.id} style={style} run={run} back={()=>setEditing(undefined)}/> : kinds.map(([kind,title])=>{
      const list = styles.filter(s=>s.type===kind);
      return list.length ? <div key={kind} role="group" aria-label={title}><h4>{title}</h4>
        <KindList styles={list} edit={setEditing} run={run}/></div> : null;
    })}
  </fieldset>;
}
