import { useMemo, useRef, useSyncExternalStore, type PointerEvent } from "react";
import type { EditorEngine } from "./engine/editor";
import { pixelRound } from "./engine/geometry";
import { reorderLayout, selectionSpacing } from "./engine/smart-selection";

export function SmartSelectionPanel({ engine, enabled, dispatch, onError }: {
  engine: EditorEngine; enabled: boolean; dispatch: (command: string, params?: unknown) => void; onError: (message: string) => void;
}) {
  const document = useSyncExternalStore(engine.subscribeCanvas, engine.getRenderDocument, engine.getRenderDocument);
  const ids = engine.getSnapshot().selection;
  const base = engine.getInteractionBase();
  const spacing = useMemo(() => selectionSpacing(base, ids), [base, ids]);
  const currentSpacing = useMemo(() => selectionSpacing(document, ids), [document, ids]);
  const reorder = useMemo(() => reorderLayout(base, ids, spacing), [base, ids, spacing]);
  const scrub = useRef<{ pointer: number; start: number; last: number; amount: number; from: number; key: "horizontal" | "vertical"; moved: boolean } | null>(null);
  function move(event: PointerEvent<HTMLButtonElement>) {
    const drag = scrub.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!engine.interacting) { scrub.current = null; return; }
    const dx = event.clientX - (drag.moved ? drag.last : drag.start);
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true; drag.last = event.clientX;
    drag.amount += dx * (event.shiftKey && !event.altKey ? 10 : event.altKey && !event.shiftKey ? .1 : 1);
    const quantum = event.altKey ? .1 : 1, value = Math.max(-1e6, Math.min(1e6, drag.from + pixelRound(drag.amount / quantum) * quantum));
    try { engine.execute("arrange.spacing", { [drag.key]: value, fromGesture: true }); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not change spacing"); }
  }
  function end(commit: boolean) {
    if (!scrub.current) return;
    scrub.current = null;
    if (commit) engine.commitInteraction(); else engine.cancelInteraction();
  }
  return <details className="figcraft-smart-selection"><summary>Smart selection</summary>
    <fieldset disabled={!enabled}><legend>Track spacing</legend>
      {(["horizontal", "vertical"] as const).map(key => {
        const axis = spacing[key], current = currentSpacing[key], label = `${key === "horizontal" ? "Horizontal" : "Vertical"} spacing`;
        return axis ? <form key={key} onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget); dispatch("arrange.spacing", { [key]: data.get("gap") });
        }}>
          <label>{label}<input key={current?.value ?? "mixed"} aria-label={label} name="gap" type="number" step="any" min="-1000000" max="1000000" required placeholder="Mixed" defaultValue={current?.value} /></label>
          <button type="button" aria-label={`Scrub ${label.toLowerCase()}`} disabled={axis.value === undefined} style={{ touchAction: "none", cursor: "ew-resize" }}
            onPointerDown={event => {
              if (event.button !== 0 || axis.value === undefined) return;
              event.preventDefault(); event.currentTarget.focus();
              engine.beginInteraction(); scrub.current = { pointer: event.pointerId, start: event.clientX, last: event.clientX, amount: 0, from: axis.value, key, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)} onLostPointerCapture={() => end(false)}>Drag gap</button>
          <button type="submit">Set {label.toLowerCase()}</button>
        </form> : null;
      })}
      {!spacing.horizontal && !spacing.vertical && <p>Select visible, unlocked siblings in aligned rows or columns.</p>}
    </fieldset>
    {reorder && <form key={ids.join(",")} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      dispatch("arrange.reorder", { source: data.get("source"), target: data.get("target"), swap: data.get("swap") === "on" });
    }}><fieldset disabled={!enabled}><legend>Reorder visual slots</legend>
      <label>Source layer<select name="source" aria-label="Source layer">{reorder.slots.map(({ id }) => <option key={id} value={id}>{document.nodes[id].name}</option>)}</select></label>
      <label>Target slot<select name="target" aria-label="Target slot">{reorder.slots.map(({ id }) => <option key={id} value={id}>{document.nodes[id].name}</option>)}</select></label>
      <label><input name="swap" type="checkbox" />Swap only these two</label><button type="submit">Reorder selection</button>
    </fieldset></form>}
    <button disabled={!enabled || !ids.length} onClick={() => dispatch("arrange.roundToPixels")}>Round to pixels</button>
  </details>;
}
