import { useRef, useState, useSyncExternalStore } from "react";
import type { EditorEngine } from "./engine/editor";
import { isFrameLike, type DocumentNode } from "./engine/document";
import { renderColour } from "./engine/colour";
import { paintColour } from "./engine/solid-paint";
import type { SharedStyle, StyleSlot } from "./engine/shared-styles";
import { textSpans, textStyleAt } from "./engine/text-ranges";
import type { ActiveStyleRange } from "./engine/style-application";

export function StyleSwatch({style}:{style:SharedStyle}) {
  const paint = style.type === "paint" ? style.paints[0] : undefined;
  const background = paint?.type === "solid" ? renderColour(paintColour(paint)) :
    paint?.type === "gradient" && paint.stops.length ? 'linear-gradient(90deg,' +
      paint.stops.map(stop => renderColour(stop.color) + ' ' + stop.position * 100 + '%').join(',') + ')' : undefined;
  return <span className="figcraft-style-swatch" aria-hidden="true" style={{background}}>
    {background ? "" : style.type === "text" ? "T" : style.type === "effect" ? "◐" : style.type === "grid" ? "▦" : "◇"}
  </span>;
}

type Run = (cmd:string, p:Record<string,unknown>) => Record<string,unknown> | undefined;
const titles: Record<StyleSlot,string> = {fill:"Fill", stroke:"Stroke", effect:"Effect", grid:"Grid", text:"Text"};

function linkedStyle(nodes: DocumentNode[], slot:StyleSlot, range?: ActiveStyleRange) {
  const ids = nodes.flatMap(node => {
    if (slot !== "text") return [node.styles?.[slot] ?? null];
    if (node.kind !== "text") return [];
    if (range && range.node.id === node.id && range.start === range.end) return [textStyleAt(node.text,range.start).styleId ?? null];
    return textSpans(node.text).filter(span => !range || node.id !== range.node.id ||
      span.start < range.end && span.end > range.start).map(span => span.style.styleId ?? null);
  });
  return ids.every(id => id === ids[0]) ? ids[0] ?? null : undefined;
}

function EditStyle({style, run, back, source}:{style:SharedStyle;run:Run;back:()=>void;source:string}) {
  const [name, setName] = useState(style.name), [description,setDescription] = useState(style.description);
  return <form onSubmit={event => {
    event.preventDefault();
    if (run("style.update", {style:style.id,name,description})) back();
  }}>
    <label>Name<input aria-label="Style name" autoFocus required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Description<input aria-label="Style description" value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <div className="figcraft-style-actions">
      <button type="submit">Save style</button><button type="button" onClick={back}>Back</button>
      <button type="button" onClick={()=>run("style.update",{style:style.id,from:source})}>Update from selection</button>
      <button type="button" onClick={()=>{if (run("style.duplicate",{style:style.id})) back();}}>Duplicate style</button>
      <button type="button" onClick={()=>{if (run("style.delete",{style:style.id})) back();}}>Delete style</button>
    </div>
  </form>;
}

function SlotPicker({slot, styles, ids, link, run, close}:{slot:StyleSlot;styles:readonly SharedStyle[];ids:string[];
  link:string|null|undefined;run:Run;close:()=>void}) {
  const [query,setQuery] = useState(""), [edit,setEdit] = useState<string>();
  const edited = styles.find(s=>s.id === edit);
  const type = slot === "fill" || slot === "stroke" ? "paint" : slot;
  const choices = styles.filter(s=>s.type === type && s.name.toLowerCase().includes(query.trim().toLowerCase()));
  function create() {
    const base = type === "paint" ? "Color" : titles[slot];
    const names = new Set(styles.map(s=>s.name));
    let n=1;
    while (names.has(base+" "+n)) n++;
    const made = run("style.create",{name:base+" "+n,type:slot,from:ids[0]});
    if (typeof made?.id === "string") {setQuery("");setEdit(made.id);}
  }
  return <div role="group" aria-label={titles[slot]+" style picker"} className="figcraft-style-picker">
    {edited ? <EditStyle key={edited.id} style={edited} run={run} source={ids[0]} back={()=>setEdit(undefined)}/> : <>
      <input autoFocus type="search" aria-label="Search styles" placeholder="Search styles" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="figcraft-style-choices">
        {choices.map(style => <div className="figcraft-style-option" key={style.id}>
          <button type="button" aria-pressed={link === style.id} onClick={()=>{
            if (run("style.apply",{ids,style:style.id,target:slot})) close();
          }}><StyleSwatch style={style}/>{style.name}</button>
          <button type="button" aria-label={"Edit "+style.name} onClick={()=>setEdit(style.id)}>Edit</button>
        </div>)}
        {!choices.length && <p>{query ? "No matching styles" : "No local styles"}</p>}
      </div>
      <div className="figcraft-style-actions">
        <button type="button" onClick={create}>Create style</button>
        {link !== null && <button type="button" onClick={()=>{if (run("style.detach",{ids,which:slot})) close();}}>Detach style</button>}
        <button type="button" onClick={close}>Close</button>
      </div>
    </>}
  </div>;
}

function SelectedStyles({nodes, styles, live, enabled, run, leave}:{nodes:DocumentNode[];styles:readonly SharedStyle[];
  live?:ActiveStyleRange;enabled:boolean;run:Run;leave:()=>void}) {
  const [slot,setSlot] = useState<StyleSlot>();
  const triggers = useRef(new Map<StyleSlot,HTMLButtonElement>());
  const slots: StyleSlot[] = ["fill","stroke","effect"];
  if (nodes.every(isFrameLike)) slots.push("grid");
  if (nodes.some(n=>n.kind === "text")) slots.push("text");
  const link = slot ? linkedStyle(nodes,slot,live) : null;
  function close() { if (slot) triggers.current.get(slot)?.focus(); setSlot(undefined); }
  return <fieldset aria-label="Shared styles" disabled={!enabled} data-figcraft-style-picker="" onKeyDown={e=>{
    if (e.key === "Escape" && slot) {e.stopPropagation();e.preventDefault();close();}
  }} onBlur={e=>{
    const next = e.relatedTarget;
    if (next instanceof Element && next.closest("[data-figcraft-editor]") === e.currentTarget.closest("[data-figcraft-editor]") &&
      (e.currentTarget.contains(next) || next.closest("[data-figcraft-typography], [data-figcraft-text-input]"))) return;
    if (next && live) leave();
  }}>
    <legend>Shared styles</legend>
    <div className="figcraft-style-actions">{slots.map(key=>{
      const id = linkedStyle(nodes,key,live);
      const name = id === undefined ? "Mixed" : id === null ? undefined : styles.find(s=>s.id === id)?.name ?? "Missing style";
      return <button type="button" key={key} ref={button=>{if (button) triggers.current.set(key,button); else triggers.current.delete(key);}}
        aria-label={titles[key]+" styles"} aria-expanded={slot === key} onClick={()=>setSlot(slot === key ? undefined : key)}>
        {titles[key]}{name && " · "+name}
      </button>;
    })}</div>
    {slot && <SlotPicker key={slot} slot={slot} ids={nodes.map(n=>n.id)} link={link} styles={styles} run={run} close={close}/>}
  </fieldset>;
}

export function SharedStylesPanel({engine,enabled,run,leave}:{engine:EditorEngine;enabled:boolean;run:Run;leave:()=>void}) {
  const snapshot = useSyncExternalStore(engine.subscribe,engine.getSnapshot,engine.getSnapshot);
  const live = useSyncExternalStore(engine.subscribeCanvas,engine.getTextRange,engine.getTextRange);
  const doc = live ? engine.getRenderDocument() : snapshot.document;
  const nodes = live ? [live.node] : snapshot.selection.map(id=>doc.nodes[id]).filter(n=>n && n.kind !== "page");
  if (!nodes.length) return null;
  return <SelectedStyles key={nodes.map(n=>n.id).join(",")} nodes={nodes} live={live} enabled={enabled} styles={doc.styles ?? []} run={run} leave={leave}/>;
}
