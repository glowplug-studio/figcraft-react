import { useEffect, useRef, useState, type ReactNode } from "react";
import { normaliseFontStyle, type FontAxis } from "./engine/font-tables";
import { textFace } from "./engine/text-node-layout";
import type { TextNode } from "./engine/document";
import type { TextStyle } from "./engine/text-style";

const featureOptions=[
  ["liga","Standard ligatures",true],["calt","Contextual alternates",true],["tnum","Tabular numbers",false],
  ["frac","Fractions",false],["case","Case-sensitive forms",false],["zero","Slashed zero",false],
  ["ss01","Stylistic set 1",false],["ss02","Stylistic set 2",false],["ss03","Stylistic set 3",false],
  ["ss04","Stylistic set 4",false],["ss05","Stylistic set 5",false],["smcp","Small capitals",false],
] as const;
type Params=Record<string,unknown>;
type Run=(command:string,params:Params)=>void;

function AxisControl({axis,value,write,end}:{axis:FontAxis;value:number|undefined;
  write:(value:number|null,preview:boolean)=>void;end:()=>void}) {
  const step=axis.max-axis.min>20 ? 1 : 0.1;
  const precision=step===1 ? 1 : 10;
  const snap=(v:number)=>Math.max(axis.min,Math.min(axis.max,Math.sign(v)*Math.round(Math.abs(v)*precision)/precision));
  const [draft,setDraft]=useState<string>(),[live,setLive]=useState<number>();
  const drag=useRef<{id:number;lastX:number;startY:number;startValue:number;amount:number;value?:number;cancelled?:boolean}>(undefined);
  const shown=live ?? (value===undefined ? undefined : snap(value));
  function sample(v:number) {
    const current=drag.current;
    if (current?.cancelled) return;
    const next=snap(v);
    if (!current) { write(next,false);return; }
    if (next===current.value) return;
    current.value=next;setLive(next);write(next,true);
  }
  function release(cancel=false) {
    const current=drag.current;
    if (!current) return;
    drag.current=undefined;setLive(undefined);
    if (cancel || current.cancelled || current.value===undefined) end();
    else write(current.value,false);
  }
  function escape() {
    if (drag.current) drag.current.cancelled=true;
    setLive(undefined);setDraft(undefined);end();
  }
  function typed() {
    if (draft?.trim() && Number.isFinite(Number(draft))) write(snap(Number(draft)),false);
    setDraft(undefined);
  }
  return <div aria-label={axis.name} role="group" onKeyDown={event=>{
    if (event.key==="Escape") {event.preventDefault();event.stopPropagation();escape();}
  }}>
    <label title={axis.tag+" · "+axis.min+" – "+axis.max+" · Default "+axis.default}>{axis.name}
      <input type="range" aria-label={axis.name+" slider"} min={axis.min} max={axis.max} step="any"
        value={shown ?? axis.default} aria-valuetext={shown===undefined ? "Mixed" : String(shown)}
        onPointerDown={e=>{
          drag.current={id:e.pointerId,lastX:e.clientX,startY:e.clientY,startValue:shown ?? axis.default,amount:0};
          e.currentTarget.setPointerCapture(e.pointerId);
        }} onInput={e=>sample(e.currentTarget.valueAsNumber)}
        onPointerUp={()=>release()} onLostPointerCapture={()=>release(true)} onPointerCancel={()=>release(true)}
        onKeyDown={e=>{
          const delta=e.key==="ArrowLeft" || e.key==="ArrowDown" ? -1 : e.key==="ArrowRight" || e.key==="ArrowUp" ? 1 : 0;
          if (delta) {e.preventDefault();sample((shown ?? axis.default)+delta*step*(e.shiftKey ? 10 : 1));}
        }}
        onDoubleClick={()=>{end();write(null,false);}} /></label>
    <input type="number" aria-label={axis.name+" value"} min={axis.min} max={axis.max} step={step}
      placeholder="Mixed" value={draft ?? shown ?? ""} onChange={e=>setDraft(e.currentTarget.value)}
      onBlur={typed} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();typed();}}}
      onPointerDown={e=>{
        if (!e.altKey || shown===undefined) return;
        e.preventDefault();e.currentTarget.focus();
        drag.current={id:e.pointerId,lastX:e.clientX,startY:e.clientY,startValue:shown,amount:0};
        e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e=>{
        const current=drag.current;
        if (current?.id!==e.pointerId) return;
        const rise=current.startY-e.clientY;
        const speed=rise>100 ? 2 : rise< -200 ? .25 : rise< -100 ? .5 : 1;
        current.amount+=(e.clientX-current.lastX)*step*speed*(e.shiftKey ? 10 : 1);
        current.lastX=e.clientX;
        sample(current.startValue+current.amount);
      }} onPointerUp={()=>release()} onLostPointerCapture={()=>release(true)} onPointerCancel={()=>release(true)} />
  </div>;
}

export function TypographySettings({nodes,styles,run,styleParams,applyStyle,end,children}:{
  nodes:readonly TextNode[];styles:readonly TextStyle[];run:Run;styleParams:(props:Params)=>Params;
  applyStyle:(props:Params)=>void;end:()=>void;children:ReactNode;
}) {
  const [tab,setTab]=useState("Basics"),[instances,setInstances]=useState(false),[open,setOpen]=useState(false);
  const cleanup=useRef(end);cleanup.current=end;
  useEffect(()=>()=>cleanup.current(),[]);
  const ids=nodes.map(n=>n.id), first=styles[0];
  const family=first && styles.every(s=>s.fontFamily===first.fontFamily) ? first.fontFamily : undefined;
  const face=open && family && first ? textFace(family,first.fontStyle) : undefined;
  const variable=face && family && face.family.toLowerCase()===family.toLowerCase() && Object.keys(face.axes).length ? face : undefined;
  const uniformFace=first && styles.every(s=>s.fontStyle===first.fontStyle) ? face : undefined;
  const active=tab==="Variable" && !variable ? "Basics" : tab;
  const coordinates=variable && active==="Variable" ? styles.map(s=>textFace(s.fontFamily,s.fontStyle)===variable ? variable.axisValues(s) : undefined) : [];
  const custom=(s:TextStyle)=>Object.keys(s.variations).length>0;
  const instance=!first || !styles.every(s=>custom(s)===custom(first) && s.fontStyle===first.fontStyle) ? "Mixed" :
    !custom(first) && variable?.instances.some(i=>normaliseFontStyle(i.name)===normaliseFontStyle(first.fontStyle)) ? first.fontStyle : "Custom";
  function preview(command:string,params:Params) { run("text.preview",{command,params}); }
  function switchTab(t:string) { end();setInstances(false);setTab(t); }
  return <details onToggle={e=>{
    if (e.target!==e.currentTarget) return;
    setOpen(e.currentTarget.open);
    if (!e.currentTarget.open) {end();setInstances(false);}
  }}><summary>More typography options</summary>
    {open && <>
      <div role="group" aria-label="Type settings">
        {(variable ? ["Basics","Details","Variable"] : ["Basics","Details"]).map(t=>
          <button type="button" key={t} aria-pressed={active===t} onClick={()=>switchTab(t)}>{t}</button>)}
      </div>
      {active==="Basics" ? children : active==="Details" ? <>
        <span>{uniformFace ? uniformFace.family+" "+uniformFace.style : "Mixed fonts"}</span>
        {featureOptions.map(([tag,label,defaultOn])=>{
          const raw=nodes[0].text.features[tag], same=nodes.every(n=>n.text.features[tag]===raw);
          const on=same ? raw ?? defaultOn : undefined, next=!on;
          return <button type="button" key={tag} role="checkbox" aria-checked={on ?? "mixed"} aria-label={label}
            title={uniformFace && !uniformFace.features.includes(tag) ? "Not in this font" : tag}
            onClick={()=>run("text.setFeatures",{ids,features:{[tag]:next===defaultOn ? null : next}})}>
            {label} <small>{tag}</small></button>;
        })}
      </> : variable && <>
        <span>{variable.family}</span>
        {variable.instances.length>0 && <>
          <button type="button" aria-label="Named instance" aria-expanded={instances}
            onClick={()=>{end();setInstances(!instances);}}>{instance}</button>
          {instances && <div role="group" aria-label="Named instances" onPointerLeave={end}
            onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)) end();}}
            onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();end();setInstances(false);}}}>
            {variable.instances.map(i=>{
              const props={fontStyle:i.name,fontVariations:null};
              const show=()=>preview("text.style",styleParams(props));
              return <button type="button" key={i.name} aria-pressed={instance===i.name} onFocus={show} onPointerEnter={show}
                onClick={()=>{end();setInstances(false);applyStyle(props);}}>{i.name}</button>;
            })}
          </div>}
        </>}
        {Object.values(variable.axes).sort((a,b)=>a.axisIndex-b.axisIndex).filter(a=>!(a.flags & 1)).map(a=>{
          const value=coordinates[0]?.[a.tag];
          const same=value!==undefined && coordinates.every(c=>c && Math.abs(c[a.tag]-value)<1e-9);
          return <AxisControl key={a.tag} axis={a} value={same ? value : undefined} end={end} write={(v,live)=>{
            const params={ids,variations:{[a.tag]:v}};
            if (live) preview("text.setVariations",params);
            else run("text.setVariations",params);
          }} />;
        })}
        {styles.some(custom) && <button type="button" onClick={()=>run("text.setVariations",{ids,variations:{},replace:true})}>Reset to style</button>}
      </>}
    </>}
  </details>;
}
