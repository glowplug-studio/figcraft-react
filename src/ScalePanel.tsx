import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from "react";
import type { EditorEngine } from "./engine/editor";
import { boundsOf } from "./engine/viewport";
import { anchors } from "./engine/sizing";
import { anchorPoint, type ScaleAnchor } from "./engine/transform-handles";
import type { Point, Rectangle } from "./engine/geometry";
import { pixelRound } from "./engine/geometry";

const names = ["Top left", "Top", "Top right", "Left", "Centre", "Right", "Bottom left", "Bottom", "Bottom right"];
export function scaleAbout(box: Rectangle, anchor: ScaleAnchor, factor: number): { factor: number; pivot: Point } | undefined {
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) <= 1e-9) return;
  const p = anchorPoint(anchor, box.width, box.height);
  return { factor: Math.min(100, Math.max(.01, factor)), pivot: { x: box.x + p.x, y: box.y + p.y } };
}
export function ScalePanel({ engine, enabled, dispatch, onError }: {
  engine: EditorEngine; enabled: boolean; dispatch: (command: string, params?: unknown) => void; onError: (message: string) => void;
}) {
  const document = useSyncExternalStore(engine.subscribeCanvas, engine.getRenderDocument, engine.getRenderDocument), s = engine.getSnapshot();
  const box = boundsOf(document, s.selection), drag = useRef<{ pointer: number; x: number; last: number; amount: number; moved: boolean; side: number; box: Rectangle; anchor: ScaleAnchor } | null>(null);
  function end(commit: boolean) {
    if (!drag.current) return; drag.current = null;
    if (commit) engine.commitInteraction(); else engine.cancelInteraction();
  }
  useEffect(() => () => { if (drag.current) { drag.current = null; engine.cancelInteraction(); } }, [engine]);
  function move(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d || event.pointerId !== d.pointer) return;
    if (!engine.interacting) { drag.current = null; return; }
    const dx = event.clientX - (d.moved ? d.last : d.x); if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true; d.last = event.clientX;
    d.amount += dx * (event.altKey && !event.shiftKey ? .1 : event.shiftKey && !event.altKey ? 10 : 1);
    const quantum = event.altKey ? .1 : 1, factor = (d.side + pixelRound(d.amount / quantum) * quantum) / d.side;
    const next = scaleAbout(d.box, d.anchor, factor);
    try { if (next) engine.previewScale(next.factor, next.pivot); else if (factor === 1) engine.previewScale(1, { x: d.box.x, y: d.box.y }); }
    catch (error) { end(false); onError(error instanceof Error ? error.message : "Could not scale selection"); }
  }
  const apply = (factor: number) => { if (box) { const next = scaleAbout(box, s.scaleAnchor, factor); if (next) dispatch("transform.scale", { factor: next.factor, cx: next.pivot.x, cy: next.pivot.y }); } };
  return <section aria-label="Scale tool"><h3>Scale</h3><fieldset disabled={!enabled || !box}><legend>Scale dimensions</legend>
    {(["width", "height"] as const).map(key => <form key={key} onSubmit={event => { event.preventDefault(); if (box && box[key] > 1e-9) apply(Number(new FormData(event.currentTarget).get("side")) / box[key]); }}>
      <label>Scale {key}<input key={box?.[key]} name="side" type="number" step="any" min="0" required defaultValue={box ? pixelRound(box[key] * 100) / 100 : ""} /></label>
      <button type="button" aria-label={`Scrub scale ${key}`} style={{ touchAction: "none", cursor: "ew-resize" }}
        onPointerDown={event => {
          if (event.button !== 0 || !box || box[key] <= 1e-9) return; event.preventDefault(); event.currentTarget.focus();
          try { engine.beginInteraction(); drag.current = { pointer: event.pointerId, x: event.clientX, last: event.clientX, amount: 0, moved: false, side: box[key], box, anchor: s.scaleAnchor }; event.currentTarget.setPointerCapture(event.pointerId); }
          catch (error) { onError(error instanceof Error ? error.message : "Could not start scale"); }
        }} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)} onLostPointerCapture={() => end(false)}>Drag {key}</button>
      <button type="submit">Set scale {key}</button>
    </form>)}
    <form onSubmit={event => { event.preventDefault(); apply(Number(new FormData(event.currentTarget).get("factor"))); }}>
      <label>Tool scale factor<input name="factor" type="number" step="any" defaultValue="1" required /></label><button type="submit">Apply scale factor</button>
    </form>
    <div role="group" aria-label="Scale anchor" style={{ display: "grid", gridTemplateColumns: "repeat(3, 32px)", gap: 2 }}>
      {anchors.map((anchor, i) => <button key={anchor} type="button" aria-label={`${names[i]} scale anchor`} aria-pressed={s.scaleAnchor === anchor} title={names[i]} onClick={() => dispatch("tool.scaleAnchor", { anchor })}>●</button>)}
    </div>
  </fieldset></section>;
}
