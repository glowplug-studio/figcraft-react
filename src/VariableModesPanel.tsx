import {useLibraryVariables} from "./LibraryVariablesContext";
import { isFrameLike, type Document, type NodeId } from "./engine/document";
import { layerModes } from "./engine/variable-modes";
import type { VariableRun } from "./VariableValueCell";

export function VariableModesPanel({document,selection,enabled,run}:{
  document:Document;selection:readonly NodeId[];enabled:boolean;run:VariableRun;
}) {
  const {sources,remoteCollections}=useLibraryVariables();
  const collections=(document.variables?.collections ?? []).filter(c=>!remoteCollections.has(c.id) && c.modes.length>1)
    .map(c=>({c,local:c.id as string|undefined,library:undefined as string|undefined,name:c.name}));
  const copies=new Map(document.variables?.collections.map(c=>[c.id,c]));
  const imported=document.libraryRecords?.collections ?? [],shown=new Set<string>();
  for (const s of sources) for (const offered of s.offered.collections) {
    const local=imported.find(r=>r.library===s.id && r.key===offered.id)?.local;
    const c=(local && copies.get(local)) || offered;
    if (c.modes.length>1) {
      if (local) shown.add(local);
      collections.push({c,local,library:s.id,name:s.name+" / "+c.name});
    }
  }
  for (const r of imported) {
    const c=copies.get(r.local);
    if (!c || c.modes.length<2 || shown.has(c.id)) continue;
    const name=document.libraryLinks?.find(l=>l.id===r.library)?.name ?? r.library;
    collections.push({c,local:c.id,library:undefined,name:name+" / "+c.name});
  }
  if (!collections?.length || !selection.length || !selection.every(id=>isFrameLike(document.nodes[id]))) return null;
  const inherited=layerModes(document,selection[0],true);
  return <fieldset disabled={!enabled}><legend>Variable modes</legend>
    {collections.map(({c,local,library,name})=>{
      const own=selection.map(id=>{
        const modes=document.nodes[id].variableModes;
        return modes && local && Object.hasOwn(modes,local) ? modes[local] : undefined;
      });
      const mixed=own.some(id=>id!==own[0]);
      const auto=local && Object.hasOwn(inherited,local) ? inherited[local] : c.modes[0].id;
      const chosen=own[0]===undefined ? "auto" : String(c.modes.findIndex(m=>m.id===own[0]));
      return <label key={JSON.stringify([library,c.id])}>{name}<select value={mixed ? "mixed" : chosen} onChange={e=>{
        const key=e.currentTarget.value;
        if (library && key!=="auto") run("library.setVariableMode",{ids:selection,library,collection:imported.find(r=>r.local===local)?.key ?? c.id,mode:c.modes[Number(key)].id});
        else if (local) run("variable.setMode",{ids:selection,collection:local,mode:key==="auto" ? null : c.modes[Number(key)].id});
      }}>
        {mixed && <option disabled value="mixed">Mixed</option>}
        {!mixed && chosen==="-1" && <option disabled value="-1"></option>}
        <option value="auto">Auto ({c.modes.find(m=>m.id===auto)?.name ?? ""})</option>
        {c.modes.map((m,i)=><option key={m.id} value={String(i)}>{m.name}</option>)}
      </select></label>;
    })}
  </fieldset>;
}
