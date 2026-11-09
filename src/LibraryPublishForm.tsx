import {useMemo,useState} from "react";
import type {Document} from "./engine/document";
import {inspectedId} from "./engine/parameters";
import {publishChoices} from "./engine/library-publish";

export function LibraryPublishForm({doc,editable,dispatch,save}:{doc:Document;editable:boolean;dispatch:(command:string,params:unknown)=>Record<string,unknown>|undefined;save:()=>Promise<void>}) {
  const choices=useMemo(()=>publishChoices(doc),[doc]);
  const [overrides,setOverrides]=useState<ReadonlyMap<string,boolean>>(()=>new Map());
  const [description,setDescription]=useState<string>();
  const groups=[["Components",choices.components],["Styles",choices.styles],["Variable collections",choices.collections]] as const;
  const manifest=doc.published?.manifest;
  const include=groups.flatMap(([name,entries])=>entries.filter(e=>overrides.get(name+":"+e.id) ?? e.selected).map(e=>name==="Components" ? inspectedId(e.id) : e.id));
  return <form aria-label="Publish library" onSubmit={event=>{
    event.preventDefault();
    const result=dispatch("library.publish",{include,description:description ?? manifest?.description ?? ""});
    if (result) {setOverrides(new Map());setDescription(undefined);void save();}
  }}>
    <p role="status">{doc.name} · {manifest ? "published version "+manifest.version : "not published"}</p>
    {!groups.some(([,entries])=>entries.length) && <p>Create components, styles or variables to publish them as a library.</p>}
    {groups.map(([name,entries])=>entries.length>0 && <fieldset key={name}><legend>{name}</legend>
      {entries.map(e=><label key={e.id}><input type="checkbox" checked={overrides.get(name+":"+e.id) ?? e.selected}
        disabled={!editable} onChange={event=>setOverrides(new Map(overrides).set(name+":"+e.id,event.target.checked))}/>{e.name}</label>)}
    </fieldset>)}
    <label>Description (optional)<input value={description ?? manifest?.description ?? ""} disabled={!editable}
      onChange={event=>setDescription(event.target.value)}/></label>
    <button type="submit" disabled={!editable || !include.length}>{manifest ? "Publish changes" : "Publish"}</button>
  </form>;
}
