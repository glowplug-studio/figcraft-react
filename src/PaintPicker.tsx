import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { ImagePaintControls } from "./ImagePaintControls";
import { outsideSrgb } from "./engine/colour-spaces";
import { fromRgba8, renderColour, withAlpha } from "./engine/colour";
import { parseCssColour } from "./engine/colour-css";
import type { EditorEngine, PaintPicker as Picker } from "./engine/editor";
import { defaultGradient, sampleSorted, sortedStops, type GradientHandle, type GradientKind } from "./engine/gradient";
import { paintColour, type GradientPaint, type Paint } from "./engine/solid-paint";

type Props = {
  engine: EditorEngine;
  list: Picker["list"];
  index: number;
  label: string;
  paint: Paint;
  change: (paint: Paint) => void;
  region?: boolean;
};

function changeKind(paint: Paint, kind: GradientKind | "solid"): Paint {
  const { opacity, visible, blend, colorAlpha } = paint;
  const base = paint.type === "solid" ? paintColour(paint) : paint.type === "gradient" ? sampleSorted(sortedStops(paint.stops), 0) : fromRgba8(179,179,179);
  if (kind === "solid") return { type:"solid", color:withAlpha(base,1), opacity, visible, blend, colorAlpha };
  const gradient = defaultGradient(kind,base);
  return { type:"gradient", ...gradient, stops:paint.type === "gradient" ? paint.stops : gradient.stops, opacity, visible, blend, colorAlpha };
}

function Stops({engine,picker,paint,change}: {engine:EditorEngine; picker:Picker; paint:GradientPaint; change:Props["change"]}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ pointer:number; index:number; paint:GradientPaint } | null>(null);
  const [preview,setPreview] = useState<GradientPaint>();
  const [error,setError] = useState("");
  useEffect(() => () => { if (dragging.current) engine.cancelInteraction(); },[engine]);
  const shown = preview ?? paint;
  const selected = Math.min(picker.stop, Math.max(0,shown.stops.length-1)), stop = shown.stops[selected];
  const select = (index:number) => engine.setPaintPicker({...picker,stop:index});
  const position = (clientX:number) => {
    const rect = bar.current!.getBoundingClientRect();
    return Math.fround(Math.max(0,Math.min(1,(clientX-rect.left)/Math.max(1,rect.width))));
  };
  const add = (at:number) => {
    const stops = [...paint.stops,{position:at,color:sampleSorted(sortedStops(paint.stops),at)}];
    change({...paint,stops}); select(stops.length-1);
  };
  const drag = (event:PointerEvent) => {
    const active = dragging.current;
    if (!active || active.pointer !== event.pointerId || !engine.interacting) return;
    const at = position(event.clientX);
    const next = {...active.paint,stops:active.paint.stops.map((s,i)=>i === active.index ? {...s,position:at} : s)};
    engine.previewPaint(picker,next); setPreview(next);
  };
  const end = (commit:boolean) => {
    if (!dragging.current) return;
    dragging.current = null;
    if (commit) engine.commitInteraction(); else engine.cancelInteraction();
    setPreview(undefined);
  };
  const rotate = ([x,y]: GradientHandle): GradientHandle => [paint.from[0]-(y-paint.from[1]),paint.from[1]+(x-paint.from[0])];
  const colours = sortedStops(shown.stops).map(s=>renderColour(s.color)+" "+s.position*100+"%");
  return <div role="group" aria-label="Gradient stops">
    <div ref={bar} style={{position:"relative", height:22, margin:"6px 8px", touchAction:"none", backgroundImage:colours.length > 1 ? "linear-gradient(to right,"+colours.join(",")+")" : undefined, backgroundColor:colours.length === 1 ? renderColour(sortedStops(shown.stops)[0].color) : undefined}}
      onPointerDown={event=>{if (event.button === 0 && event.target === event.currentTarget) add(position(event.clientX));}}
      onPointerMove={drag} onPointerUp={event=>{if (dragging.current?.pointer === event.pointerId) end(true);}} onLostPointerCapture={()=>end(false)} onPointerCancel={()=>end(false)}
      onKeyDown={event=>{if(event.key === "Escape" && dragging.current){event.preventDefault();event.stopPropagation();end(false);}}}>
      {shown.stops.map((s,i)=><button type="button" key={i} aria-label={`Gradient stop ${i+1}`} aria-pressed={i===selected}
        style={{position:"absolute",left:(s.position*100)+"%",top:"50%",transform:"translate(-50%,-50%)",width:12,height:18,minWidth:0,minHeight:0,padding:0,border:"2px solid white",borderRadius:3,outline:i===selected?"2px solid Highlight":undefined,background:renderColour(withAlpha(s.color,1)),touchAction:"none"}}
        onClick={event=>{if (event.detail === 0) select(i);}}
        onPointerDown={event=>{
          if (event.button !== 0 || dragging.current || engine.interacting) return;
          select(i); engine.beginInteraction(); dragging.current={pointer:event.pointerId,index:i,paint}; event.currentTarget.setPointerCapture(event.pointerId);
        }}/>)}
    </div>
    <button type="button" onClick={()=>add(.5)}>Add stop</button>
    <button type="button" disabled={paint.stops.length<=2} onClick={()=>{change({...paint,stops:paint.stops.filter((_,i)=>i!==selected)});select(0);}}>Remove stop</button>
    <button type="button" onClick={()=>change({...paint,stops:paint.stops.map(s=>({...s,position:Math.fround(1-s.position)}))})}>Flip</button>
    <button type="button" onClick={()=>change({...paint,to:rotate(paint.to),width:rotate(paint.width)})}>Rotate 90°</button>
    {stop && <form key={selected+":"+JSON.stringify(paint.stops[selected])} onSubmit={event=>{
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const color = parseCssColour(String(data.get("colour")));
      if (!color) {setError("Enter a valid CSS colour."); return;}
      setError("");
      change({...paint,stops:paint.stops.map((s,i)=>i===selected ? {color,position:Math.fround(Number(data.get("position")))} : s)});
    }}>
      <label>Stop position<input name="position" type="number" min="0" max="1" step="any" defaultValue={stop.position} required /></label>
      <label>Stop CSS colour<input name="colour" defaultValue={renderColour(stop.color)} required /></label>
      <button type="submit">Apply stop</button>
      {error && <p role="alert">{error}</p>}
    </form>}
  </div>;
}

export function PaintPicker({engine,list,index,label,paint,change,region=false}:Props) {
  const picker = engine.getSnapshot().paintPicker;
  const [pending,setPending] = useState<Picker>();
  const image = paint.type === "image" || pending !== undefined && picker === pending;
  const [hover,setHover] = useState<Picker>(), [uploadError,setUploadError] = useState<{picker:Picker;message:string}>();
  async function upload(file?: File) {
    if (!picker || !file) return;
    setUploadError(undefined);
    try { await engine.uploadPaintImage(picker,file); setPending(undefined); }
    catch(e) { setUploadError({picker,message:e instanceof Error ? e.message : "Image upload failed"}); }
  }
  useEffect(()=>{if (paint.type==="image") setPending(undefined);},[paint.type]);
  const open = picker?.list === list && picker.index === index;
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const popup=panel.current, anchor=button.current;
    if (!open || !popup || !anchor) return;
    popup.showPopover();
    function position() {
      if (!popup || !anchor) return;
      const rect=anchor.getBoundingClientRect(), box=popup.getBoundingClientRect();
      const side=anchor.closest(".figcraft-properties")?.getBoundingClientRect().left ?? rect.left;
      popup.style.left=Math.max(4,Math.min(window.innerWidth-box.width-4,side-box.width-8))+"px";
      const top=side>=box.width+8 ? rect.top : rect.bottom+4;
      popup.style.top=Math.max(4,Math.min(window.innerHeight-box.height-4,top))+"px";
    }
    function outside(event:globalThis.PointerEvent) {
      const element=event.target;
      if (element instanceof Element && !popup?.contains(element) && !anchor?.contains(element) && !element.closest('canvas[aria-label="Design canvas"]')) engine.setPaintPicker();
    }
    position();
    const resize=new ResizeObserver(position); resize.observe(popup);
    window.addEventListener("scroll",position,true); window.addEventListener("resize",position);
    document.addEventListener("pointerdown",outside);
    return ()=>{
      resize.disconnect(); window.removeEventListener("scroll",position,true); window.removeEventListener("resize",position);
      document.removeEventListener("pointerdown",outside);
    };
  },[open,engine]);
  const selectedColour = paint.type === "solid" ? paint.color : paint.type === "gradient" && picker ? paint.stops[picker.stop]?.color : undefined;
  return <>
    <button ref={button} type="button" aria-expanded={open} onClick={()=>engine.setPaintPicker(open ? undefined : {list,index,stop:0})}>Edit {label} paint</button>
    {open && <div data-figcraft-image-drop-target={image && !region ? "" : undefined} ref={panel} role="group" popover="manual" aria-label={label+" paint picker"}
      style={{position:"fixed",inset:"auto",margin:0,width:"min(240px, calc(100vw - 8px))",maxHeight:"calc(100dvh - 8px)",overflow:"auto",padding:12,border:"1px solid #bbb",borderRadius:6,background:"Canvas",color:"CanvasText"}}
      onDragOver={event=>{
        if (image && !region && event.dataTransfer.types.includes("Files")) {event.preventDefault();event.stopPropagation();setHover(picker);}
      }}
      onDragLeave={event=>{
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setHover(undefined);
      }}
      onDrop={event=>{
        if (event.dataTransfer.files.length) setHover(undefined);
      }}
      onKeyDown={event=>{if(event.key==="Escape" && !engine.interacting){event.preventDefault();event.stopPropagation();engine.setPaintPicker();button.current?.focus();}}}>
      <button type="button" aria-label="Close paint picker" style={{float:"right"}} onClick={()=>{engine.setPaintPicker();button.current?.focus();}}>×</button>
      <label>Paint type<select value={image ? "image" : paint.type === "gradient" ? paint.kind : paint.type} onChange={event=>{
        if(event.target.value==="image") setPending(picker);
        else {setPending(undefined);change(changeKind(paint,event.target.value as GradientKind|"solid"));}
      }}>
        {(["solid","linear","radial","angular","diamond"] as const).map(kind=><option key={kind} value={kind}>{kind[0].toUpperCase()+kind.slice(1)}</option>)}
        <option value="image">Image</option>
      </select></label>
      {image && <ImagePaintControls engine={engine} picker={picker} paint={paint.type === "image" ? paint : undefined} region={region} hover={hover===picker} upload={upload} change={change}/>}
      {image && uploadError?.picker===picker && <p role="alert">{uploadError.message}</p>}
      {!image && paint.type === "gradient" && <Stops engine={engine} paint={paint} picker={picker} change={change}/>}
      {!image && selectedColour && outsideSrgb(selectedColour, engine.getSnapshot().document.colourProfile ?? "srgb") &&
        <p title="The canvas shows the nearest sRGB color.">Outside sRGB</p>}
    </div>}
  </>;
}
