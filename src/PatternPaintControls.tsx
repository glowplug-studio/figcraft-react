import { useEffect, useRef, useState } from "react";
import type { EditorEngine, PaintPicker } from "./engine/editor";
import type { PatternPaint } from "./engine/solid-paint";
import type { LayerNode } from "./engine/document";

const fields = ["Scale (%)", "Horizontal gap", "Vertical gap"] as const;
function setNumber(paint: PatternPaint, index: number, value: number): PatternPaint {
  const n = Math.min(10000, Math.max(index === 0 ? 1 : 0, value));
  if (index === 0) return {...paint, scale:n / 100};
  return {...paint, spacing:index === 1 ? [n,paint.spacing[1]] : [paint.spacing[0],n]};
}

export function PatternPaintControls({engine,picker,paint,sources,change}: {
  engine: EditorEngine; picker: PaintPicker; paint: PatternPaint; sources: readonly LayerNode[]; change: (p: PatternPaint) => void;
}) {
  const drag = useRef<{pointer:number; start:number; value:number} | null>(null);
  const [preview,setPreview] = useState<PatternPaint>();
  useEffect(() => () => { if (drag.current) engine.cancelInteraction(); },[engine]);
  const shown = preview ?? paint;
  function finish(commit:boolean) {
    if (!drag.current) return;
    drag.current = null;
    if (commit) engine.commitInteraction(); else engine.cancelInteraction();
    setPreview(undefined);
  }
  return <div role="group" aria-label="Pattern paint">
    <label>Pattern source<select value={shown.source} onChange={e=>change({...paint,source:e.currentTarget.value})}>
      {!sources.some(n=>n.id===shown.source) && <option value={shown.source} disabled>{engine.getSnapshot().document.nodes[shown.source]?.name ?? "Missing layer"}</option>}
      {sources.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}
    </select></label>
    <label>Tile type<select value={shown.tile} onChange={e=>change({...paint,tile:e.currentTarget.value as PatternPaint["tile"]})}>
      <option value="grid">Grid</option><option value="horizontalHex">Horizontal hex</option><option value="verticalHex">Vertical hex</option>
    </select></label>
    <label>Pattern alignment<select value={shown.align} onChange={e=>change({...paint,align:e.currentTarget.value as PatternPaint["align"]})}>
      <option value="start">Start</option><option value="center">Centre</option><option value="end">End</option>
    </select></label>
    {fields.map((label,index)=>{
      const value = index === 0 ? shown.scale * 100 : shown.spacing[index-1];
      return <div key={label} style={{display:"grid",gridTemplateColumns:"1fr minmax(0,1fr)",gap:4}}>
        <button type="button" aria-label={"Scrub "+label} style={{touchAction:"none",cursor:"ew-resize"}}
          onPointerDown={e=>{
            if (e.button!==0 || engine.interacting) return;
            e.currentTarget.focus();
            engine.beginInteraction(); drag.current={pointer:e.pointerId,start:e.clientX,value};
            e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={e=>{
            const d=drag.current;
            if (!d || d.pointer!==e.pointerId || !engine.interacting) return;
            const next=setNumber(paint,index,d.value+e.clientX-d.start);
            engine.previewPaint(picker,next); setPreview(next);
          }} onPointerUp={()=>finish(true)} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}
          onKeyDown={e=>{if(e.key==="Escape" && drag.current){e.preventDefault();e.stopPropagation();finish(false);}}}>{label}</button>
        <input key={value} aria-label={label} type="number" min={index===0 ? 1 : 0} max="10000" step="any" defaultValue={value}
          onBlur={e=>{
            const input=e.currentTarget, next=input.valueAsNumber;
            if (Number.isFinite(next) && next!==value) {
              const updated=setNumber(paint,index,next);
              input.value=String(index===0 ? updated.scale*100 : updated.spacing[index-1]);
              change(updated);
            } else input.value=String(value);
          }} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}}}/>
      </div>;
    })}
  </div>;
}
