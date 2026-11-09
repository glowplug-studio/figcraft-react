import { useEffect, useRef, useState, type ReactNode } from "react";
import { toCssHex, withAlpha, type Colour } from "./engine/colour";
import { parseColour } from "./engine/colour-css";
import type { Effect } from "./engine/effects";

interface Gesture { preview(effect: Effect): void; commit(): void; cancel(): void }
interface Props {
  effect: Effect;
  bind(field:string,label:string,control:ReactNode):ReactNode;
  change(effect: Effect): void;
  begin(): Gesture | undefined;
}

function NumberField({label, value, step = 1, update, change, begin}: Omit<Props, "effect"|"bind"> & {
  label: string; value: number; step?: number; update(value: number): Effect;
}) {
  const [draft, setDraft] = useState<string>();
  const drag = useRef<{start: number; value: number; pointer: number; gesture: Gesture} | undefined>(undefined);
  const text = useRef<HTMLInputElement>(null);
  function finish(commit: boolean) {
    const active = drag.current;
    drag.current = undefined;
    if (active) { if (commit) active.gesture.commit(); else active.gesture.cancel(); }
    setDraft(undefined);
  }
  useEffect(() => () => { drag.current?.gesture.cancel(); }, []);
  function submit() {
    if (draft !== undefined && draft.trim() && Number.isFinite(Number(draft)) && Number(draft) !== value) change(update(Number(draft)));
    setDraft(undefined);
  }
  return <div className="figcraft-effect-number">
    <button type="button" aria-label={'Scrub ' + label} style={{touchAction:"none", cursor:"ew-resize"}}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const gesture = begin();
        if (!gesture) return;
        drag.current = { start:event.clientX, value, pointer:event.pointerId, gesture };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId) return;
        const next = active.value + (event.clientX - active.start) * step;
        setDraft(String(Number(next.toFixed(4)))); active.gesture.preview(update(next));
      }} onPointerUp={event => { if (drag.current?.pointer === event.pointerId) finish(true); }}
      onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (drag.current) finish(false); }}
      onKeyDown={event => { if (event.key === "Escape") finish(false); else if (event.key === "Enter") text.current?.focus(); }}>
      {label}
    </button>
    <input aria-label={label} type="number" step="any" ref={text} value={draft ?? value}
      onChange={event => setDraft(event.target.value)} onBlur={submit}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        else if (event.key === "Escape") { event.stopPropagation(); setDraft(undefined); }
      }} />
  </div>;
}

export function EffectSettings({effect, change, begin, bind}: Props) {
  const props = {change, begin};
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const field = (label: string, value: number, update: (v: number) => Effect, step = 1, key?:string) => {
    const input = <NumberField key={label} label={label} value={value} update={update} step={step} {...props} />;
    return key ? bind(key,label,input) : input;
  };
  const percent = (label: string, value: number, update: (v: number) => Effect, key?:string) =>
    field(label, Math.round(value * 100), v => update(clamp(v / 100, 0, 1)),1,key);
  const colour = (label: string, c: Colour, update: (v: Colour) => Effect, key?:string) => {
    const hex = toCssHex(withAlpha(c,1));
    const input = <div key={label}><label>{label}<input type="color" value={hex} onChange={event => {
      const value = parseColour(event.target.value);
      if (value) change(update(withAlpha(value, c.a)));
    }} /></label>
      <input key={hex} aria-label={label + " hex"} defaultValue={hex}
        onBlur={event => {
          const draft = event.target.value.trim();
          if (draft.toUpperCase() === hex) return;
          const value = parseColour(draft);
          if (value) change(update(withAlpha(value, c.a))); else event.target.value = hex;
        }}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") event.currentTarget.value = hex; }} />
      {percent(label + " opacity (%)", c.a, v => update(withAlpha(c,v)))}</div>;
    return key ? bind(key,label,input) : input;
  };
  switch (effect.type) {
    case "dropShadow": case "innerShadow":
      return <>{field("Offset X",effect.offset[0],v=>({...effect,offset:[v,effect.offset[1]]}),1,"offsetX")}
        {field("Offset Y",effect.offset[1],v=>({...effect,offset:[effect.offset[0],v]}),1,"offsetY")}
        {field("Blur",effect.radius,v=>({...effect,radius:Math.max(0,v)}),1,"radius")}
        {field("Spread",effect.spread,v=>({...effect,spread:v}),1,"spread")}
        {colour("Shadow colour",effect.color,v=>({...effect,color:v}),"color")}
        {effect.type === "dropShadow" && <label><input type="checkbox" checked={effect.showBehind}
          onChange={event=>change({...effect,showBehind:event.target.checked})}/>Show behind transparent areas</label>}</>;
    case "backgroundBlur": case "layerBlur":
      return <><label>Blur type<select value={effect.blurType} onChange={event=>change({...effect,
        blurType:event.target.value === "progressive" ? "progressive" : "uniform"})}>
        <option value="uniform">Uniform</option><option value="progressive">Progressive</option></select></label>
        {effect.blurType === "progressive" && field("Start",effect.startRadius,v=>({...effect,startRadius:clamp(v,0,10000)}),1,"startRadius")}
        {field(effect.blurType === "progressive" ? "End" : "Blur",effect.radius,v=>({...effect,radius:clamp(v,0,10000)}),1,"radius")}</>;
    case "texture": case "noise": {
      const size = field("Size",effect.size,v=>{
        const { sizeY: previous, ...rest } = effect;
        return {...rest,size:clamp(v,.01,1000)};
      },.1);
      if (effect.type === "texture") return <>{size}{field("Radius",effect.radius,v=>({...effect,radius:Math.max(0,v)}))}
        <label><input type="checkbox" checked={effect.clipToShape} onChange={event=>change({...effect,clipToShape:event.target.checked})}/>Clip to shape</label></>;
      return <><label>Noise mode<select value={effect.mode} onChange={event=>change({...effect, mode:event.target.value as typeof effect.mode})}>
        <option value="mono">Mono</option><option value="duo">Duo</option><option value="multi">Multi</option></select></label>
        {size}{percent("Density (%)",effect.density,v=>({...effect,density:v}))}
        {effect.mode === "multi" ? percent("Opacity (%)",effect.opacity,v=>({...effect,opacity:v}))
          : colour("Noise colour",effect.color,v=>({...effect,color:v}))}
        {effect.mode === "duo" && colour("Secondary colour",effect.secondary,v=>({...effect,secondary:v}))}</>;
    }
    case "glass":
      return <>{field("Light angle (°)",Math.round(effect.lightAngle),v=>({...effect,lightAngle:clamp(v,-180,180)}),1,"lightAngle")}
        {percent("Intensity (%)",effect.lightIntensity,v=>({...effect,lightIntensity:v}),"lightIntensity")}
        {percent("Refraction (%)",effect.refraction,v=>({...effect,refraction:v}),"refraction")}
        {field("Depth",effect.depth,v=>({...effect,depth:clamp(v,1,1000)}),1,"depth")}
        {percent("Dispersion (%)",effect.dispersion,v=>({...effect,dispersion:v}),"dispersion")}
        {field("Frost",clamp(effect.frost,0,100),v=>({...effect,frost:clamp(v,0,100)}),1,"radius")}
        {percent("Splay (%)",effect.splay,v=>({...effect,splay:v}),"splay")}</>;
  }
}
