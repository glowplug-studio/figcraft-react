import {useEffect, useRef, useState, type PointerEvent} from "react";
import { LayerVariablePicker, type InspectorDispatch } from "./StyleVariablePicker";
import type {EditorEngine} from "./engine/editor";
import {fieldValue, parseFieldEdit, steppedField, type FieldEdit} from "./engine/field-math";
import {pixelRound} from "./engine/geometry";

export interface LayoutFieldHost {
  engine: EditorEngine;
  dispatch: InspectorDispatch;
  onError: (message: string) => void;
}

interface LayoutFieldProps extends LayoutFieldHost {
  label: string;
  value?: number;
  variableField?: string;
  min?: number;
  placeholder?: string;
  step?: number;
  suffix?: string;
  command?: "node.set" | "layout.setTrack";
  onMixedRelative?: (edit: FieldEdit) => void;
  params: (n: number, all: boolean) => Record<string,unknown>;
}

type Drag = {
  pointer: number; x: number; y: number; lastX: number; amount: number; speed: number; from: number; fineOnAlt: boolean;
  preview?: ReturnType<EditorEngine["beginLayoutField"]>;
};

export function LayoutNumber({variableField,...props}: LayoutFieldProps) {
  const input = <NumberInput {...props}/>;
  if (!variableField) return input;
  const {document,selection} = props.engine.getSnapshot();
  return <LayerVariablePicker doc={document} ids={selection} field={variableField} label={props.label} type="number" run={props.dispatch}>{input}</LayerVariablePicker>;
}

function NumberInput({engine, dispatch, onError, label, value, min, step = 1, suffix, placeholder, command = "node.set", onMixedRelative, params}: LayoutFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const all = useRef(false);
  const [notice,setNotice] = useState("");
  const [draft,setDraft] = useState<string | undefined>(undefined);
  const clamp = (n: number) => min === undefined ? n : Math.max(min,n);
  const shown = draft ?? String(value ?? "");

  function end(commit: boolean) {
    const preview = drag.current?.preview;
    drag.current = null;
    setNotice("");
    if (preview) {
      if (commit) preview.commit(); else preview.cancel();
      setDraft(undefined);
    }
  }
  useEffect(() => () => {
    drag.current?.preview?.cancel();
    drag.current = null;
  }, []);
  function start(e: PointerEvent<HTMLElement>, fineOnAlt: boolean) {
    if (e.button !== 0 || value === undefined || drag.current || input.current?.matches(":disabled")) return;
    if (!fineOnAlt && (!e.altKey || document.activeElement === input.current)) return;
    e.preventDefault();
    input.current?.focus({preventScroll:true});
    drag.current = {pointer:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,amount:0,speed:1,from:value,fineOnAlt};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function show(d: Drag, alt: boolean) {
    const quantum = alt ? step*.1 : step;
    const next = clamp(steppedField(d.from,pixelRound(d.amount/quantum),quantum));
    d.preview?.preview(params(next,false));
    setDraft(String(next));
  }
  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    try {
      if (!d.preview) {
        if (Math.hypot(e.clientX-d.x,e.clientY-d.y) < 3) return;
        d.preview = engine.beginLayoutField(command);
      }
      const rise = d.y-e.clientY, speed = rise > 100 ? 2 : rise < -200 ? .25 : rise < -100 ? .5 : 1;
      if (d.speed !== speed) {
        d.speed = speed;
        setNotice("Scrubbing at "+({2:"2×",1:"1×",0.5:"½×",0.25:"¼×"}[speed]));
      }
      const alt = d.fineOnAlt && e.altKey;
      const rate = e.shiftKey === alt ? 1 : alt ? .1 : 10;
      const edge = e.clientX <= 1 || e.clientX >= window.innerWidth-1;
      const dx = e.clientX-d.lastX || (edge ? e.movementX : 0);
      d.lastX = e.clientX;
      d.amount += dx*step*rate*speed;
      show(d,alt);
    } catch (error) {
      end(false);
      onError(error instanceof Error ? error.message : "Could not adjust this field");
    }
  }
  const pointer = {
    onPointerMove:move,
    onPointerUp:(e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      try {
        if (d.preview) show(d,d.fineOnAlt && e.altKey);
        end(true);
      } catch (error) {
        end(false);
        onError(error instanceof Error ? error.message : "Could not commit this field");
      }
    },
    onPointerCancel:(e: PointerEvent) => { if (drag.current?.pointer === e.pointerId) end(false); },
    onLostPointerCapture:(e: PointerEvent) => { if (drag.current?.pointer === e.pointerId) end(false); },
  };
  return <label><span style={{cursor:"ew-resize",touchAction:"none",userSelect:"none"}}
    onPointerDown={e => start(e,true)} {...pointer}>{label}</span>
    <input ref={input} data-figcraft-number="" type="text" role="spinbutton" inputMode="decimal" aria-label={label} aria-valuenow={drag.current?.preview ? Number(shown) : value} aria-valuemin={min}
      placeholder={placeholder} value={shown} onChange={e => setDraft(e.target.value)}
      onPointerDown={e => { all.current = e.metaKey || e.ctrlKey; start(e,false); }} {...pointer}
      onFocus={e => e.currentTarget.select()}
      onKeyDown={e => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (drag.current) { e.stopPropagation(); end(false); return; }
          setDraft(undefined); all.current = false;
          // Blur must see the cancellation before React applies the state update.
          e.currentTarget.value = String(value ?? ""); e.currentTarget.blur();
        } else if (e.key === "Enter") {
          e.preventDefault(); e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const typed = draft === undefined ? undefined : parseFieldEdit(draft);
          const by = (e.key === "ArrowUp" ? 1 : -1)*(e.shiftKey ? 10 : 1)*step;
          if (value === undefined && typed?.kind !== "set" && onMixedRelative) {
            setDraft(undefined);
            onMixedRelative({kind:"add",value:by});
          } else {
            const current = draft === undefined ? value : fieldValue(typed,value);
            if (current === undefined && value !== undefined) return;
            setDraft(undefined);
            dispatch(command,params(clamp(steppedField(current ?? 0,1,by)),all.current));
          }
          requestAnimationFrame(() => input.current?.select());
        }
      }}
      onBlur={e => {
        if (drag.current) { end(false); return; }
        const raw = e.currentTarget.value;
        if (draft !== undefined && (raw !== String(value ?? "") || all.current)) {
          const edit = parseFieldEdit(raw);
          if (value === undefined && edit && edit.kind !== "set" && onMixedRelative) onMixedRelative(edit);
          else {
            const n = fieldValue(edit,value);
            if (n !== undefined) dispatch(command,params(clamp(n),all.current));
          }
        }
        setDraft(undefined); all.current = false;
      }}/>{suffix}{notice && <small role="status">{notice}</small>}</label>;
}
