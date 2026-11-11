import type {TeamLibraryControls} from "./AssetsPanel";
import {useMemo,useState} from "react";
import type {Document} from "./engine/document";
import {inspectedId} from "./engine/parameters";
import {publishChoices} from "./engine/library-publish";

export function LibraryPublishForm({doc,editable,dispatch,save,team}:{team?:TeamLibraryControls;doc:Document;editable:boolean;dispatch:(command:string,params:unknown)=>Record<string,unknown>|undefined;save:()=>Promise<void>}) {
  const choices=useMemo(()=>publishChoices(doc),[doc]);
  const [overrides,setOverrides]=useState<ReadonlyMap<string,boolean>>(()=>new Map());
  const [description,setDescription]=useState<string>();
  const groups=[["Components",choices.components],["Styles",choices.styles],["Variable collections",choices.collections]] as const;
  const [serverOpen,setServerOpen]=useState(false);
  const [invite,setInvite]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
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
    {team && <><button type="button" disabled={!editable || busy} aria-expanded={serverOpen} onClick={()=>setServerOpen(!serverOpen)}>Publish to server…</button>
      {serverOpen && <fieldset><legend>Publish team library</legend>
        <label>{team.inSession ? "Edit link (optional for this session)" : "Edit link"}<input type="password" autoComplete="off"
          value={invite} onChange={e=>setInvite(e.target.value)}/></label>
        <button type="button" disabled={!editable || busy || !include.length || (!team.inSession && !invite.trim())}
          onClick={async ()=>{
            setBusy(true);setMessage("");
            try {
              const version=await team.publish({include,description:description ?? manifest?.description ?? ""},invite.trim());
              setMessage("Published team library version "+version);setServerOpen(false);setInvite("");
            } catch (error) {setMessage(error instanceof Error ? error.message : "Could not publish the team library");}
            finally {setBusy(false);}
          }}>Publish team library</button>
      </fieldset>}
      {message && <p role="status">{message}</p>}
    </>}
  </form>;
}
