import { useEffect, useId, useMemo, useRef, useState } from "react";
import { familySample, type FamilySample } from "./engine/font-family-sample";
import { askForLocalFonts, canAskForLocalFonts } from "./engine/text-node-layout";

type Row={family:string} | {heading:string};
const recentKey="figcraft.recentFontFamilies";
const rowHeight=28, visibleRows=8;
function readRecent():string[] {
  try {
    const data:unknown=JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(data) ? data.filter((v):v is string=>typeof v==="string").slice(0,8) : [];
  } catch { return []; }
}

interface Props {
  families:readonly string[];
  current?:string;
  preview:(family:string)=>void;
  endPreview:()=>void;
  apply:(family:string)=>void;
}

export function FontFamilyPicker({families,current,preview,endPreview,apply}:Props) {
  const anchor=useRef<HTMLButtonElement>(null), dialog=useRef<HTMLDialogElement>(null);
  const search=useRef<HTMLInputElement>(null), list=useRef<HTMLDivElement>(null);
  const listId=useId(), cleanup=useRef(endPreview);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[scroll,setScroll]=useState(0);
  const [hi,setHi]=useState<number>(),[recent,setRecent]=useState<string[]>([]);
  const q=query.trim().toLowerCase();
  const rows=useMemo(()=>{
    if (!open) return [];
    const all=families.filter(f=>!q || f.toLowerCase().includes(q));
    const previous=q ? [] : recent.filter(f=>families.some(a=>a.toLowerCase()===f.toLowerCase()));
    const rows:Row[]=[];
    if (previous.length) rows.push({heading:"Recent"},...previous.map(family=>({family})),{heading:"All fonts"});
    rows.push(...all.map(family=>({family})));
    return rows;
  },[open,families,q,recent]);
  useEffect(()=>()=>cleanup.current(),[]);

  function positionMenu() {
    const menu=dialog.current, rect=anchor.current?.getBoundingClientRect();
    if (!menu || !rect) return;
    const width=Math.min(Math.max(rect.width,240),window.innerWidth-16);
    menu.style.width=width+"px";
    menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+"px";
    menu.style.top=Math.max(8,Math.min(rect.bottom+2,window.innerHeight-325))+"px";
  }
  useEffect(()=>{
    if (!open) return;
    window.addEventListener("resize",positionMenu);
    return ()=>window.removeEventListener("resize",positionMenu);
  },[open]);
  function show() {
    positionMenu();
    setRecent(readRecent());setQuery("");setScroll(0);setHi(undefined);setOpen(true);
    dialog.current?.showModal();search.current?.focus();
  }
  function close() {
    endPreview();
    dialog.current?.close();
    setOpen(false);
  }
  function choose(family:string) {
    close();
    const recent=[family,...readRecent().filter(f=>f.toLowerCase()!==family.toLowerCase())].slice(0,8);
    try {localStorage.setItem(recentKey,JSON.stringify(recent));} catch { /* Storage can be unavailable. */ }
    apply(family);
  }
  function step(direction:1|-1) {
    let from=hi;
    if (from===undefined && current) {
      for (let i=rows.length-1;i>=0;i--) {
        const r=rows[i];
        if ("family" in r && r.family.toLowerCase()===current.toLowerCase()) {from=i;break;}
      }
    }
    let i=(from ?? (direction===1 ? -1 : rows.length))+direction;
    while (i>=0 && i<rows.length && !("family" in rows[i])) i+=direction;
    const row=rows[i];if (!row || !("family" in row)) return;
    setHi(i);preview(row.family);
    const viewport=list.current;
    if (viewport) {
      const y=i*rowHeight;
      if (y<viewport.scrollTop) viewport.scrollTop=y;
      else if (y+rowHeight>viewport.scrollTop+viewport.clientHeight) viewport.scrollTop=y+rowHeight-viewport.clientHeight;
    }
  }
  const first=Math.max(0,Math.floor(scroll/rowHeight)-1);
  const visible=useMemo(()=>rows.slice(first,first+visibleRows+3),[rows,first]);
  const [samples,setSamples]=useState<ReadonlyMap<string,FamilySample>>(new Map());
  useEffect(()=>{
    if (!open) return;
    let cancelled=false, frame=0, index=0;
    const prepared=new Map<string,FamilySample>();
    const families=visible.flatMap(row=>"family" in row ? [row.family] : []);
    async function render() {
      const end=Math.min(index+4,families.length);
      while (index<end && !cancelled) {
        const family=families[index++];
        const sample=await familySample(family,window.devicePixelRatio).catch(()=>null);
        if (sample) prepared.set(family,sample);
      }
      if (cancelled) return;
      setSamples(new Map(prepared));
      if (index<families.length) frame=requestAnimationFrame(()=>void render());
    }
    frame=requestAnimationFrame(()=>void render());
    return ()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[open,visible]);
  return <div>
    <span>Font family</span><button type="button" ref={anchor} aria-label="Font family" aria-haspopup="dialog" aria-expanded={open} onClick={show}>{current ?? "Mixed"}</button>
    <dialog ref={dialog} aria-label="Choose font family" style={{position:"fixed",margin:0,padding:8,maxHeight:"90vh",maxWidth:"calc(100vw - 16px)"}}
      onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if (e.target===dialog.current) {
        const r=dialog.current!.getBoundingClientRect();if (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) close();
      }}}>
      {open && canAskForLocalFonts() && <button type="button" onClick={()=>{close();void askForLocalFonts().catch(()=>{});}}>Use fonts installed on this computer…</button>}
      <input ref={search} role="combobox" aria-label="Search fonts" placeholder="Search fonts" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={hi===undefined ? undefined : listId+"-"+hi} value={query}
        onChange={e=>{setQuery(e.target.value);setHi(undefined);setScroll(0);if (list.current) list.current.scrollTop=0;endPreview();}}
        onKeyDown={e=>{
          if (e.key==="ArrowDown" || e.key==="ArrowUp") {e.preventDefault();step(e.key==="ArrowDown" ? 1 : -1);}
          if (e.key==="Enter") {
            e.preventDefault();const row=rows[hi ?? -1] ?? rows.find(r=>"family" in r);
            if (row && "family" in row) choose(row.family);
          }
        }} />
      <div ref={list} id={listId} role="listbox" aria-label="Font families" onScroll={e=>setScroll(e.currentTarget.scrollTop)}
        style={{maxHeight:visibleRows*rowHeight,overflowY:"auto"}} onMouseLeave={()=>{
          const row=rows[hi ?? -1];if (row && "family" in row) preview(row.family);else endPreview();
        }}>
        <div style={{height:rows.length*rowHeight,position:"relative"}}>
          {visible.map((row,slot)=>{
            const i=first+slot, style={position:"absolute" as const,left:0,top:i*rowHeight,width:"100%",height:rowHeight,textAlign:"left" as const};
            const sample="family" in row && samples.get(row.family);
            return "family" in row ? <button key={i} id={listId+"-"+i} aria-label={row.family} role="option" type="button" tabIndex={-1}
              style={{...style,background:hi===i ? "Highlight" : undefined,color:hi===i ? "HighlightText" : undefined,
                fontWeight:row.family.toLowerCase()===current?.toLowerCase() ? 700 : undefined}}
              aria-selected={hi===i || hi===undefined && row.family===current} onMouseEnter={()=>preview(row.family)}
              onMouseDown={e=>e.preventDefault()} onClick={()=>choose(row.family)}>
              {sample ? <span aria-hidden="true" data-font-sample="" style={{display:"block",maxWidth:"100%",width:sample.width,height:sample.height,
                backgroundColor:"currentColor",maskImage:"url("+sample.url+")",maskSize:sample.width+"px "+sample.height+"px",maskRepeat:"no-repeat"}} /> : row.family}
            </button>
              : <strong key={i} style={style}>{row.heading}</strong>;
          })}
        </div>
      </div>
      {open && !rows.length && <p>No fonts match</p>}
    </dialog>
  </div>;
}
