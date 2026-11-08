import { useId, useRef } from "react";
import { booleanOperations, type BooleanOperation, type Document, type NodeId } from "./engine/document";
import { booleanLabel } from "./engine/structure";

const squarePair = "M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z";
const shapes: Record<BooleanOperation, string> = {
  union: "M2.5 2.5h7v4h4v7h-7v-4h-4z",
  subtract: "M2.5 2.5h7v4h-3v3h-4z",
  intersect: "M6.5 6.5h3v3h-3z",
  exclude: squarePair,
};
export function BooleanIcon({ op }: { op: BooleanOperation }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ verticalAlign: "middle" }}>
    <path d={shapes[op]} fill="currentColor" fillOpacity=".45" fillRule="evenodd" />
    <path d={op === "union" ? shapes.union : squarePair} stroke="currentColor" fill="none" />
  </svg>;
}

export function BooleanMenu({ document, selection, editable, dispatch }: {
  document: Document; selection: readonly NodeId[]; editable: boolean; dispatch: (command: string) => void;
}) {
  const id = useId(), popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const first = document.nodes[selection[0]];
  const ops = selection.map(id => {
    const n = document.nodes[id], parent = n?.parent && document.nodes[n.parent];
    return n && n.kind !== "page" && parent && parent.kind === "booleanOp" ? n.boolOp ?? parent.op : undefined;
  });
  const current = selection.length === 1 && first?.kind === "booleanOp" ? first.op : ops.every(op=>op===ops[0]) ? ops[0] : undefined;
  const run = (command: string) => { popup.current?.hidePopover(); dispatch(command); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" aria-label="Boolean groups" title="Boolean groups" aria-haspopup="menu" popoverTarget={id} disabled={!editable || !selection.length}
      onClick={() => {
        const rect = trigger.current!.getBoundingClientRect(), menu = popup.current!;
        menu.style.left = Math.max(4,Math.min(window.innerWidth-184,rect.right-180))+"px";
        menu.style.top = Math.max(4,Math.min(window.innerHeight-204,rect.bottom+4))+"px";
      }}><BooleanIcon op={current ?? "union"} /></button>
    <div ref={popup} id={id} popover="auto" role="menu" aria-label="Boolean operations" style={{ position:"fixed", margin:0, inset:"auto", width:180 }}
      onToggle={e => { if (e.newState === "open") popup.current?.querySelector("button")?.focus(); }}
      onKeyDown={e => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.hidePopover();
          trigger.current?.focus();
          return;
        }
        const buttons = Array.from(e.currentTarget.querySelectorAll("button")), at = buttons.indexOf(e.target as HTMLButtonElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); buttons[(at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
      }}>
      {booleanOperations.map(op => <button key={op} type="button" role="menuitemradio" aria-label={booleanLabel(op)} aria-checked={current === op} style={{ display:"block", width:"100%", textAlign:"start" }}
        onClick={()=>run("bool."+op)}><BooleanIcon op={op}/> {booleanLabel(op)} {current === op ? "✓" : ""}</button>)}
      <button type="button" role="menuitem" onClick={()=>run("vector.flatten")}>Flatten</button>
    </div>
  </>;
}
