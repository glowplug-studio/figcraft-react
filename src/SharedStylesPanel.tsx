import { useRef, useState, useSyncExternalStore } from "react";
import type { EditorEngine } from "./engine/editor";
import { isFrameLike, type DocumentNode } from "./engine/document";
import { EditStyle, StyleSwatch, type Run } from "./StyleEditor";
import { LocalStyleCatalogue, groupStyles, styleLeaf } from "./LocalStyleCatalogue";
import type { SharedStyle, StyleSlot } from "./engine/shared-styles";
import { textSpans, textStyleAt } from "./engine/text-ranges";
import type { ActiveStyleRange } from "./engine/style-application";

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

function useStyleView() {
  const [grid,setGrid] = useState(false);
  const [folded,setFolded] = useState<ReadonlySet<string>>(()=>new Set());
  function toggle(folder:string) {
    setFolded(previous=>{
      const next = new Set(previous);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  }
  return {grid,setGrid,folded,toggle};
}

function SlotPicker({engine, slot, styles, ids, link, run, close, view}:{engine:EditorEngine;slot:StyleSlot;styles:readonly SharedStyle[];ids:string[];
  link:string|null|undefined;run:Run;close:()=>void;view:ReturnType<typeof useStyleView>}) {
  const [query,setQuery] = useState(""), [edit,setEdit] = useState<string>();
  const edited = styles.find(s=>s.id === edit);
  const type = slot === "fill" || slot === "stroke" ? "paint" : slot;
  const choices = styles.filter(s=>s.type === type && s.name.toLowerCase().includes(query.trim().toLowerCase()));
  const hasGrid = type === "paint" || type === "text";
  function create() {
    const base = type === "paint" ? "Color" : titles[slot];
    const names = new Set(styles.map(s=>s.name));
    let n=1;
    while (names.has(base+" "+n)) n++;
    const made = run("style.create",{name:base+" "+n,type:slot,from:ids[0]});
    if (typeof made?.id === "string") {setQuery("");setEdit(made.id);}
  }
  return <div role="group" aria-label={titles[slot]+" style picker"} className="figcraft-style-picker">
    {edited ? <EditStyle engine={engine} key={edited.id} style={edited} run={run} source={ids[0]} back={()=>setEdit(undefined)}/> : <>
      <input autoFocus type="search" aria-label="Search styles" placeholder="Search styles" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="figcraft-style-choices">
        {groupStyles(choices).map(([folder,items])=>{
          const open = !folder || !!query.trim() || !view.folded.has(folder);
          return <div key={folder}>
            {folder && <button type="button" aria-expanded={open} aria-label={"Style folder "+folder}
              onClick={()=>{if (!query.trim()) view.toggle(folder);}}>{folder.split("/").map(part=>part.trim()).join(" / ")}</button>}
            {open && <div className={hasGrid && view.grid ? "figcraft-style-grid" : undefined}>
              {items.map(style=><div className="figcraft-style-option" key={style.id}>
                <button type="button" aria-label={style.name} title={style.description || style.name} aria-pressed={link === style.id}
                  onClick={()=>{if (run("style.apply",{ids,style:style.id,target:slot})) close();}}>
                  <StyleSwatch style={style}/>{styleLeaf(style.name)}
                </button>
                <button type="button" aria-label={"Edit "+style.name} onClick={()=>setEdit(style.id)}>Edit</button>
              </div>)}
            </div>}
          </div>;
        })}
        {!choices.length && <p>{query ? "No matching styles" : "No local styles"}</p>}
      </div>
      <div className="figcraft-style-actions">
        {hasGrid && <button type="button" onClick={()=>view.setGrid(!view.grid)}>{view.grid ? "Show as list" : "Show as grid"}</button>}
        <button type="button" onClick={create}>Create style</button>
        {link !== null && <button type="button" onClick={()=>{if (run("style.detach",{ids,which:slot})) close();}}>Detach style</button>}
        <button type="button" onClick={close}>Close</button>
      </div>
    </>}
  </div>;
}

function SelectedStyles({engine, nodes, styles, live, enabled, run, leave, view}:{engine:EditorEngine;nodes:DocumentNode[];styles:readonly SharedStyle[];
  live?:ActiveStyleRange;enabled:boolean;run:Run;leave:()=>void;view:ReturnType<typeof useStyleView>}) {
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
    {slot && <SlotPicker engine={engine} view={view} key={slot} slot={slot} ids={nodes.map(n=>n.id)} link={link} styles={styles} run={run} close={close}/>}
  </fieldset>;
}

export function SharedStylesPanel({engine,enabled,run,leave}:{engine:EditorEngine;enabled:boolean;run:Run;leave:()=>void}) {
  const view = useStyleView();
  const snapshot = useSyncExternalStore(engine.subscribe,engine.getSnapshot,engine.getSnapshot);
  const live = useSyncExternalStore(engine.subscribeCanvas,engine.getTextRange,engine.getTextRange);
  const doc = live ? engine.getRenderDocument() : snapshot.document;
  const nodes = live ? [live.node] : snapshot.selection.map(id=>doc.nodes[id]).filter(n=>n && n.kind !== "page");
  if (!nodes.length) return doc.styles?.length ? <LocalStyleCatalogue engine={engine} styles={doc.styles} enabled={enabled} run={run}/> : null;
  return <SelectedStyles engine={engine} view={view} key={nodes.map(n=>n.id).join(",")} nodes={nodes} live={live} enabled={enabled} styles={doc.styles ?? []} run={run} leave={leave}/>;
}
