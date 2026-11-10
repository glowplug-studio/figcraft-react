import { useState } from "react";
import { AssetThumbnail } from "./AssetsPanel";
import type { Document } from "./engine/document";
import { sizeLabel } from "./engine/export-jobs";
import type { ExportSetting } from "./engine/export-settings";

type Run = (command: string, params: Record<string,unknown>) => void;
type Update = (patch: Record<string,unknown>) => void;

function TextField({label,value,list,apply}:{label:string; value:string; list?:string; apply:(v:string)=>void}) {
  const [draft,setDraft] = useState<string>();
  return <label>{label}<input aria-label={label} list={list} value={draft ?? value}
    onChange={e=>setDraft(e.currentTarget.value)}
    onBlur={()=>{ if (draft !== undefined && draft !== value) apply(draft); setDraft(undefined); }}
    onKeyDown={e=>{if (e.key === "Enter") {e.preventDefault(); e.currentTarget.blur();}}}/></label>;
}
function SettingRow({setting:e,index,allText,profile,update,remove}:{setting:ExportSetting;index:number;allText:boolean;profile:string;update:Update;remove:()=>void}) {
  const raster = e.format === "png" || e.format === "webp" || e.format === "jpg";
  function toggle(key: keyof ExportSetting, label: string, checked: boolean) {
    return <label><input type="checkbox" checked={checked} onChange={event=>update({ [key]:event.currentTarget.checked })}/>{label}</label>;
  }
  return <fieldset aria-label={"Export setting " + (index+1)}>
    {raster && <TextField label="Export size" list="figcraft-export-scales" value={sizeLabel(e.size)} apply={size=>update({size})}/>}
    <TextField label="Export suffix" value={e.suffix} apply={suffix=>update({suffix})}/>
    <label>Format<select aria-label="Export format" value={e.format} onChange={event=>update({format:event.currentTarget.value})}>
      {(["png","jpg","svg","pdf","webp","vectorDrawable"] as const).map(f=><option key={f} value={f}>{f === "vectorDrawable" ? "XML" : f === "webp" ? "WebP" : f.toUpperCase()}</option>)}
    </select></label>
    <button type="button" onClick={remove}>Remove export setting</button>
    <details><summary>Export options</summary>
      {toggle("contentsOnly","Ignore overlapping layers",e.contentsOnly ?? true)}
      {(allText || e.includeBoundingBox) && toggle("includeBoundingBox","Include bounding box",!!e.includeBoundingBox)}
      {e.format === "svg" && toggle("svgOutlineText","Outline text",e.svgOutlineText ?? true)}
      {(e.format === "svg" || e.format === "vectorDrawable") && toggle("svgIdAttribute","Include id attribute",!!e.svgIdAttribute)}
      {e.format === "svg" && toggle("svgSimplifyStroke","Simplify stroke",e.svgSimplifyStroke ?? true)}
      {raster && <label>Colour profile<select value={e.colorProfile ?? "sameAsFile"} onChange={event=>update({colorProfile:event.currentTarget.value})}>
        <option value="sameAsFile">Same as file ({profile})</option><option value="srgb">sRGB</option><option value="displayP3">Display P3</option>
      </select></label>}
      {e.format === "vectorDrawable" && <label>Compatibility<select value={e.vdCompat ?? "bestEffort"} onChange={ev=>update({vdCompat:ev.currentTarget.value})}>
        <option value="bestEffort">Best effort</option><option value="exact">Exact only</option><option value="ignore">Ignore unsupported</option>
      </select></label>}
    </details>
    {e.format === "pdf" && <details><summary>Print options</summary>
      <TextField label="Bleed" value={String(e.print?.bleed ?? 0) + " pt"} apply={bleed=>update({bleed})}/>
      {(["cropMarks","bleedMarks","cmyk"] as const).map((key,i)=><label key={key}><input type="checkbox" checked={e.print?.[key] ?? false} onChange={ev=>update({[key]:ev.currentTarget.checked})}/>{["Crop marks","Bleed marks","CMYK"][i]}</label>)}
    </details>}
  </fieldset>;
}
export function ExportPanel({doc,ids,enabled,run,download}:{doc:Document;ids:readonly string[];enabled:boolean;run:Run;download:()=>void}) {
  const [preview,setPreview] = useState(false);
  if (!ids.length) return null;
  const layers = ids.map(id=>doc.nodes[id]), first = layers[0].exports ?? [];
  const mixed = layers.slice(1).some(n=>n.exports !== first && JSON.stringify(n.exports ?? []) !== JSON.stringify(first));
  const exportable = layers.filter(n=>n.exports?.length);
  const tip = mixed ? "Replace mixed export settings" : "Add export setting";
  return <fieldset aria-label="Layer export" disabled={!enabled}><legend>Export</legend>
    <button type="button" onClick={()=>mixed ? run("node.set",{ids,props:{exports:[{}]}}) : run("export.add",{ids})}>{tip}</button>
    <datalist id="figcraft-export-scales">{[0.5,0.75,1,1.5,2,3,4].map(n=><option key={n} value={n+"x"}/>)}</datalist>
    {!mixed && first.map((setting,index)=><SettingRow key={index} setting={setting} index={index}
      allText={layers.every(n=>n.kind === "text")} profile={doc.colourProfile === "displayP3" ? "Display P3" : "sRGB"}
      update={patch=>run("export.update",{ids,index,...patch})} remove={()=>run("export.remove",{ids,index})}/>)}
    {exportable.length > 0 && <><details onToggle={e=>setPreview(e.currentTarget.open)}><summary>Preview</summary>
      {preview && <span className="figcraft-export-preview"><AssetThumbnail doc={doc} id={exportable[0].id}/></span>}
    </details><button type="button" onClick={download}>Export {exportable.length === 1 ? exportable[0].name : exportable.length + " layers"}</button></>}
  </fieldset>;
}
