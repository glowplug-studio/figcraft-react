import { useEffect, useRef, useState } from "react";
import type { EditorEngine, PaintPicker } from "./engine/editor";
import { decodeVariant } from "./engine/image-renderer";
import type { ColourProfile } from "./engine/colour-spaces";
import { findImagePreset } from "./engine/image-commands";
import { readImageFilters, listImagePresets, type ImageFilters } from "./engine/image-filters";
import type { ImageResource } from "./engine/image-resource";
import type { ImagePaint } from "./engine/solid-paint";

const noAdjustments = readImageFilters({});
function ImagePreview({resource, profile}: {resource?:ImageResource; profile:ColourProfile}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let current = true;
    const element = canvas.current!;
    element.width = element.height = 1;
    if (!resource || !resource.width || !resource.height) return;
    const scale = Math.min(1, 448 / resource.width, 240 / resource.height);
    const width = Math.max(1, Math.round(resource.width * scale)), height = Math.max(1, Math.round(resource.height * scale));
    void decodeVariant({resource, width, height, filters: noAdjustments, profile, screen: true}, () => current).then(bitmap => {
      try {
        if (current) {
          element.width = width; element.height = height;
          element.getContext("2d")?.drawImage(bitmap,0,0);
        }
      } finally { bitmap.close(); }
    }).catch(() => { /* Upstream keeps the checkerboard for an unreadable native member. */ });
    return () => { current = false; };
  }, [resource, profile]);
  return <div style={{height:120,display:"grid",placeItems:"center",background:"repeating-conic-gradient(#ddd 0 25%, white 0 50%) 0 0/16px 16px"}}>
    <canvas ref={canvas} aria-label="Image preview" style={{width:"100%",height:"100%",objectFit:"contain",minHeight:0}} />
  </div>;
}

const controls = ["Exposure", "Contrast", "Saturation", "Temperature", "Tint", "Highlights", "Shadows"] as const;
type Props = {engine:EditorEngine; picker:PaintPicker; paint?:ImagePaint; region:boolean; hover:boolean; upload:(file?:File)=>void; change:(paint:ImagePaint)=>void};
export function ImagePaintControls({engine,picker,paint,region,change,hover,upload}: Props) {
  const input = useRef<HTMLInputElement>(null), presetsMenu = useRef<HTMLDetailsElement>(null);
  const dragging = useRef<number | null>(null);
  const [preview,setPreview] = useState<ImagePaint>(), [error,setError] = useState("");
  const [name,setName] = useState<string>();
  useEffect(() => () => { if (dragging.current !== null) engine.cancelInteraction(); },[engine]);
  const snapshot = engine.getSnapshot(), shown = preview ?? paint;
  const resource = paint && snapshot.document.images?.[paint.image];
  const profile = resource?.profileName ?? "Unknown — treated as sRGB";
  const {builtIn, saved} = listImagePresets(snapshot.document.imagePresets);
  const identity = !shown || Object.values(shown.filters).every(n=>n===0);
  const same = (filters:ImageFilters) => shown && controls.every(label => {
    const key = label.toLowerCase() as keyof ImageFilters;
    return filters[key] === shown.filters[key];
  });
  const current = builtIn.find(p=>p.id!=="reset" && same(p.filters))?.label ?? saved.find(p=>same(p.filters))?.name ?? (identity ? "No preset" : "Custom");
  function run(action:()=>void) {
    setError("");
    try { action(); } catch (e) {setError(e instanceof Error ? e.message : "Image edit failed");}
  }
  function apply(name:string) {
    if (!paint) return;
    run(()=>{
      if (region) change({...paint,filters:findImagePreset(snapshot.document,name)});
      else engine.execute("image.adjust",{target:picker.list,index:picker.index,ids:snapshot.selection,preset:name});
    });
    if (presetsMenu.current) presetsMenu.current.open = false;
  }
  function finish(commit:boolean) {
    if (dragging.current === null) return;
    dragging.current = null;
    if (commit) engine.commitInteraction(); else engine.cancelInteraction();
    setPreview(undefined);
  }
  return <div role="group" aria-label="Image paint">
    <ImagePreview resource={resource} profile={snapshot.document.colourProfile ?? "srgb"}/>
    {hover && <span>Drop to use this image</span>}
    <button type="button" onClick={()=>input.current?.click()}>Upload from computer</button>
    <input hidden ref={input} type="file" aria-label="Choose image" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" onChange={e=>{
      const file=e.currentTarget.files?.[0]; e.currentTarget.value=""; void upload(file);
    }}/>
    {error && <p role="alert">{error}</p>}
    {shown && <>
      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><label>Image mode<select value={shown.scale_mode} onChange={e=>change({...shown,scale_mode:e.currentTarget.value as ImagePaint["scale_mode"]})}>
        {(["fill","fit","crop","tile"] as const).map(mode=><option key={mode} value={mode}>{mode[0].toUpperCase()+mode.slice(1)}</option>)}
      </select></label>
      <button type="button" onClick={()=>change({...shown,rotation:(shown.rotation+1)%4})}>Rotate 90°</button></div>
      <small title={profile || "Embedded profile"} style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Color profile: {profile || "Embedded profile"}</small>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"start",gap:6}}><details ref={presetsMenu}><summary aria-label="Adjustment presets">{current}</summary>
        {builtIn.filter(p=>p.id!=="reset").map(p=><button key={p.id} type="button" onClick={()=>apply(p.id)}>{p.label}</button>)}
        {saved.map((p,i)=><div key={i}><button type="button" onClick={()=>apply(p.name)}>{p.name}</button>
          <button type="button" aria-label={"Delete preset "+p.name} onClick={()=>run(()=>{engine.execute("image.deletePreset",{name:p.name});})}>×</button></div>)}
        <button type="button" onClick={()=>{setName("Preset "+(saved.length+1));if(presetsMenu.current)presetsMenu.current.open=false;}}>Save as preset…</button>
      </details>
      <button type="button" disabled={identity} aria-label="Reset adjustments" onClick={()=>apply("reset")}>Reset</button></div>
      {name !== undefined && <form onSubmit={e=>{e.preventDefault();run(()=>{engine.execute("image.savePreset",{name,filters:shown.filters});setName(undefined);});}}>
        <label>Preset name<input autoFocus value={name} onChange={e=>setName(e.currentTarget.value)}/></label>
        <button disabled={!name.trim()}>Save</button>
      </form>}
      {controls.map(label=>{
        const key = label.toLowerCase() as keyof ImageFilters;
        return <label key={key} style={{display:"grid",gridTemplateColumns:"72px minmax(0,1fr)",alignItems:"center",margin:"2px 0"}}>{label}<input type="range" style={{width:"100%",minWidth:0,height:18,margin:0,padding:0}} min="-1" max="1" step="0.01" value={shown.filters[key]}
          onPointerDown={e=>{if(e.button!==0 || engine.interacting)return;engine.beginInteraction();dragging.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);}}
          onChange={e=>{const next={...shown,filters:{...shown.filters,[key]:Math.fround(e.currentTarget.valueAsNumber)}};
            if(dragging.current!==null && engine.interacting){engine.previewPaint(picker,next);setPreview(next);}else change(next);}}
          onPointerUp={e=>{if(e.pointerId===dragging.current)finish(true);}} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}
          onKeyDown={e=>{if(e.key==="Escape" && dragging.current!==null){e.preventDefault();e.stopPropagation();finish(false);}}}
        /></label>;
      })}
    </>}
  </div>;
}
