import { isFrameLike, type Document, type NodeId } from "./engine/document";
import { layerModes } from "./engine/variable-modes";
import type { VariableRun } from "./VariableValueCell";

export function VariableModesPanel({document,selection,enabled,run}:{
  document:Document;selection:readonly NodeId[];enabled:boolean;run:VariableRun;
}) {
  const collections=document.variables?.collections.filter(c=>c.modes.length>1);
  if (!collections?.length || !selection.length || !selection.every(id=>isFrameLike(document.nodes[id]))) return null;
  const inherited=layerModes(document,selection[0],true);
  return <fieldset disabled={!enabled}><legend>Variable modes</legend>
    {collections.map(c=>{
      const own=selection.map(id=>{
        const modes=document.nodes[id].variableModes;
        return modes && Object.hasOwn(modes,c.id) ? modes[c.id] : undefined;
      });
      const mixed=own.some(id=>id!==own[0]);
      const auto=Object.hasOwn(inherited,c.id) ? inherited[c.id] : c.modes[0].id;
      const chosen=own[0]===undefined ? "auto" : String(c.modes.findIndex(m=>m.id===own[0]));
      return <label key={c.id}>{c.name}<select value={mixed ? "mixed" : chosen} onChange={e=>{
        const key=e.currentTarget.value;
        run("variable.setMode",{ids:selection,collection:c.id,mode:key==="auto" ? null : c.modes[Number(key)].id});
      }}>
        {mixed && <option disabled value="mixed">Mixed</option>}
        {!mixed && chosen==="-1" && <option disabled value="-1"></option>}
        <option value="auto">Auto ({c.modes.find(m=>m.id===auto)?.name ?? ""})</option>
        {c.modes.map((m,i)=><option key={m.id} value={String(i)}>{m.name}</option>)}
      </select></label>;
    })}
  </fieldset>;
}
