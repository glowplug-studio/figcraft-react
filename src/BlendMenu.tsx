import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { blendLabel, blendModes, type BlendMode } from "./engine/blend";
import type { EditorEngine, PaintPicker } from "./engine/editor";

const separators = new Set<BlendMode>(["normal","colorBurn","colorDodge","hardLight","exclusion"]);
const paintModes = blendModes.filter(mode=>mode !== "passThrough");

interface Props {
  engine: EditorEngine;
  label: string;
  value?: BlendMode;
  picker?: PaintPicker;
  change: (value:BlendMode) => void;
}

export function BlendMenu({engine,label,value,picker,change}: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const preview = useRef<ReturnType<EditorEngine["beginBlendPreview"]>>(undefined);
  const hovered = useRef<BlendMode>(undefined);
  const [open,setOpen] = useState(false);
  const modes = picker ? paintModes : blendModes;
  function restore() {
    preview.current?.cancel();
    preview.current = undefined;
    hovered.current = undefined;
  }
  function show(mode:BlendMode) {
    if (hovered.current === mode) return;
    preview.current ??= engine.beginBlendPreview(picker);
    preview.current?.show(mode);
    hovered.current = mode;
  }
  function close(refocus:boolean) {
    restore(); setOpen(false);
    if (refocus) trigger.current?.focus({preventScroll:true});
  }

  useLayoutEffect(()=>{
    const popup=menu.current, anchor=trigger.current;
    if (!open || !popup || !anchor) return;
    popup.showPopover();
    function position() {
      if (!popup || !anchor) return;
      const box=anchor.getBoundingClientRect();
      const above=Math.max(0,box.top-8), below=Math.max(0,window.innerHeight-box.bottom-8);
      const up=below<popup.scrollHeight && above>below;
      popup.style.maxHeight=Math.max(48,up?above:below)+"px";
      popup.style.top=Math.max(4,Math.min(window.innerHeight-popup.offsetHeight-4,up?box.top-popup.offsetHeight-2:box.bottom+2))+"px";
      popup.style.left=Math.max(4,Math.min(window.innerWidth-popup.offsetWidth-4,box.left))+"px";
    }
    function outside(event:PointerEvent) {
      if (event.target instanceof Node && !popup?.contains(event.target) && !anchor?.contains(event.target)) {
        restore(); setOpen(false);
      }
    }
    const unsubscribe=engine.subscribe(()=>{ restore(); setOpen(false); });
    position(); popup.focus({preventScroll:true});
    window.addEventListener("resize",position);
    window.addEventListener("scroll",position,true);
    document.addEventListener("pointerdown",outside,true);
    return ()=>{
      unsubscribe(); restore();
      document.removeEventListener("pointerdown",outside,true);
      window.removeEventListener("scroll",position,true);
      window.removeEventListener("resize",position);
    };
  },[open,engine]);

  function navigate(event:KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key==="Tab") {close(true); return;}
    if (event.key==="Escape") {event.preventDefault(); close(true); return;}
    if (!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const at=items.findIndex(item=>item===document.activeElement);
    let next=event.key==="Home" ? 0 : items.length-1;
    if (event.key==="ArrowDown") next=(at+1)%items.length;
    if (event.key==="ArrowUp" && at>=0) next=(at+items.length-1)%items.length;
    items[next].focus();
  }
  return <>
    <button type="button" ref={trigger} title={label} aria-label={label} aria-description={value ? blendLabel(value) : "Mixed"} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open?id:undefined} onClick={()=>open?close(true):setOpen(true)}
      onKeyDown={event=>{
        if (["ArrowDown","Enter"," "].includes(event.key)) event.stopPropagation();
        if (event.key==="ArrowDown") {event.preventDefault();setOpen(true);}
      }}>
      {value ? blendLabel(value) : "Mixed"}
    </button>
    {open && <div id={id} ref={menu} popover="manual" role="menu" aria-label={label} tabIndex={-1}
      style={{position:"fixed",inset:"auto",margin:0,padding:4,width:"min(200px, calc(100vw - 8px))",overflowY:"auto",boxSizing:"border-box",background:"Canvas",color:"CanvasText",border:"1px solid GrayText",borderRadius:4}}
      onKeyDown={navigate} onPointerLeave={restore} onBlur={event=>{
        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget!==trigger.current) close(false);
      }}>
      {modes.map(mode=><div key={mode} role="none">
        <button type="button" role="menuitemradio" aria-checked={value===mode} tabIndex={-1}
          style={{display:"block",width:"100%",textAlign:"left",fontWeight:value===mode?700:400}}
          onPointerEnter={()=>show(mode)} onPointerLeave={restore} onFocus={()=>show(mode)}
          onClick={()=>{close(true);change(mode);}}>{blendLabel(mode)}</button>
        {separators.has(mode) && <hr role="separator" style={{margin:"3px 0"}}/>}
      </div>)}
    </div>}
  </>;
}
