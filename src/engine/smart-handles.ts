import { canvasAccent } from "./canvas-colours";
import type { EditorEngine } from "./editor";
import type { Document, NodeId } from "./document";
import { pixelRound, type Point, type Rectangle } from "./geometry";
import { axisEnd, axisStart, reorderLayout, selectionSpacing, type ReorderLayout, type SelectionSpacing, type SpacingAxis } from "./smart-selection";
import { sameIds } from "./rotation";
import { boundsOf, pageToScreen, type Viewport } from "./viewport";

type Modifiers = { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
interface GapHandle { readonly axis: SpacingAxis; readonly value: number; readonly point: Point }
type Action = { kind: "spacing"; axis: SpacingAxis; value: number; last?: number }
  | { kind: "reorder"; layout: ReorderLayout; source: NodeId; target: NodeId; swap: boolean };
interface Drag { ids: readonly NodeId[]; start: Point; moved: boolean; plain: boolean; action: Action }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p: Point, width: number, height: number) => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
const centre = (box: Rectangle) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

function ring(box: Rectangle, view: Viewport): { point: Point; radius: number } | undefined {
  const side = Math.min(box.width, box.height) * view.zoom;
  return side < 16 ? undefined : { point: pageToScreen(view, centre(box)), radius: Math.min(8, side / 4) };
}
export function gapHandles(document: Document, axis: SpacingAxis, view: Viewport): GapHandle[] {
  const out: GapHandle[] = [];
  for (let k = 1; k < axis.tracks.length; k++) {
    const a = axis.tracks[k - 1], b = axis.tracks[k], ab = boundsOf(document, a.ids), bb = boundsOf(document, b.ids);
    if (!ab || !bb) continue;
    const value = axisStart(bb, axis.vertical) - axisEnd(ab, axis.vertical), middle = (axisStart(bb, axis.vertical) + axisEnd(ab, axis.vertical)) / 2;
    const spans = (ids: readonly NodeId[]) => ids.map(id => boundsOf(document, [id])).filter((box): box is Rectangle => Boolean(box))
      .map(box => [axisStart(box, !axis.vertical), axisEnd(box, !axis.vertical)] as const).sort((a, b) => a[0] - b[0]);
    const aa = spans(a.ids), bs = spans(b.ids); let i = 0, j = 0;
    while (i < aa.length && j < bs.length) {
      const lo = Math.max(aa[i][0], bs[j][0]), hi = Math.min(aa[i][1], bs[j][1]);
      if (hi > lo) out.push({ axis, value, point: pageToScreen(view, axis.vertical ? { x: (lo + hi) / 2, y: middle } : { x: middle, y: (lo + hi) / 2 }) });
      if (aa[i][1] <= bs[j][1]) i++; else j++;
    }
  }
  return out;
}
const onGap = (p: Point, handle: GapHandle) => Math.abs(p.x - handle.point.x) <= (handle.axis.vertical ? 12 : 5) && Math.abs(p.y - handle.point.y) <= (handle.axis.vertical ? 5 : 12);

/** Browser equivalent of native smart-selection input/drawing; no React frame state. */
export class SmartHandles {
  #drag?: Drag;
  #hover?: Point;
  #cache?: { document: Document; ids: readonly NodeId[]; spacing: SelectionSpacing; reorder?: ReorderLayout };
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return this.#drag !== undefined; }
  #layout() {
    const document = this.engine.getRenderDocument(), ids = this.engine.getSnapshot().selection;
    if (this.#cache?.document === document && sameIds(this.#cache.ids, ids)) return this.#cache;
    const spacing = selectionSpacing(document, ids);
    return this.#cache = { document, ids, spacing, reorder: reorderLayout(document, ids, spacing) };
  }
  #hit(point: Point, modifiers: Modifiers): Action | undefined {
    const snapshot = this.engine.getSnapshot();
    if (!snapshot.editable || snapshot.tool !== "move") return;
    const layout = this.#layout(), view = this.engine.getView();
    for (const slot of layout.reorder?.slots ?? []) {
      const handle = ring(slot.box, view);
      if (handle && distance(point, handle.point) <= handle.radius) return { kind: "reorder", layout: layout.reorder!, source: slot.id, target: slot.id, swap: false };
    }
    if (modifiers.ctrlKey || modifiers.metaKey) return;
    for (const axis of [layout.spacing.horizontal, layout.spacing.vertical]) if (axis) for (const handle of gapHandles(layout.document, axis, view)) {
      if (onGap(point, handle)) return { kind: "spacing", axis, value: handle.value, last: axis.value };
    }
  }
  hover(point: Point | undefined, modifiers: Modifiers): string {
    this.#hover = point;
    const action = point ? this.#hit(point, modifiers) : undefined;
    return action?.kind === "reorder" ? "grab" : action?.kind === "spacing" ? action.axis.vertical ? "ns-resize" : "ew-resize" : "";
  }
  down(point: Point, modifiers: Modifiers): boolean {
    const action = this.#hit(point, modifiers);
    if (!action) return false;
    this.engine.beginInteraction();
    this.#drag = { ids: this.engine.getSnapshot().selection, start: point, moved: false, plain: !(modifiers.altKey || modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey), action };
    return true;
  }
  move(point: Point, modifiers: Modifiers, width: number, height: number): void {
    this.#hover = point;
    const drag = this.#drag;
    if (!drag) return;
    if (!this.engine.interacting || !sameIds(drag.ids, this.engine.getSnapshot().selection)) { this.cancel(); return; }
    const action = drag.action, view = this.engine.getView();
    try {
      if (action.kind === "spacing") {
        const delta = action.axis.vertical ? point.y - drag.start.y : point.x - drag.start.x;
        drag.moved ||= Math.abs(delta) >= 3;
        const quantum = modifiers.altKey ? .1 : modifiers.shiftKey ? 10 : 1;
        const value = Math.max(-1e6, Math.min(1e6, pixelRound((action.value + delta / view.zoom) / quantum) * quantum));
        if (drag.moved && action.last !== value) {
          this.engine.execute("arrange.spacing", { ids: drag.ids, [action.axis.vertical ? "vertical" : "horizontal"]: value, fromGesture: true }); action.last = value;
        }
      } else if (inside(point, width, height)) {
        drag.moved ||= distance(point, drag.start) >= 3;
        let nearest = action.source, closest = Infinity;
        for (const slot of action.layout.slots) {
          const d = distance(point, pageToScreen(view, centre(slot.box)));
          if (d < closest) { closest = d; nearest = slot.id; }
        }
        const swap = modifiers.metaKey || modifiers.ctrlKey;
        if (drag.moved && (nearest !== action.target || swap !== action.swap)) {
          this.engine.execute("arrange.reorder", { ids: drag.ids, source: action.source, target: nearest, swap, fromGesture: true }); action.target = nearest; action.swap = swap;
        }
      }
    } catch (error) { this.onError(error instanceof Error ? error.message : "Could not change smart selection"); }
  }
  up(point: Point, modifiers: Modifiers, width: number, height: number): void {
    this.move(point, modifiers, width, height);
    const drag = this.#drag; this.#drag = undefined;
    if (!drag || !this.engine.interacting) return;
    const clicked = drag.action.kind === "reorder" && drag.plain && !drag.moved && inside(point, width, height) && distance(point, drag.start) < 3 ? drag.action.source : undefined;
    this.engine.commitInteraction();
    if (clicked) this.engine.execute("select.set", { ids: [clicked] });
  }
  cancel(): void { this.#drag = undefined; this.engine.cancelInteraction(); }
  draw(context: CanvasRenderingContext2D): void {
    const snapshot = this.engine.getSnapshot(), document = this.engine.getRenderDocument(), view = this.engine.getView(), drag = this.#drag;
    if (!snapshot.editable || snapshot.tool !== "move") return;
    const box = boundsOf(document, snapshot.selection);
    if (!box) return;
    const p = pageToScreen(view, { x: box.x, y: box.y });
    if (!drag && (!this.#hover || this.#hover.x < p.x - 12 || this.#hover.x > p.x + box.width * view.zoom + 12 || this.#hover.y < p.y - 12 || this.#hover.y > p.y + box.height * view.zoom + 12)) return;
    const layout = this.#layout(), reorder = drag?.action.kind === "reorder" ? drag.action.layout : drag ? undefined : layout.reorder;
    context.save(); context.strokeStyle = context.fillStyle = "#f2488c";
    for (const slot of reorder?.slots ?? []) {
      const bounds = boundsOf(document, [slot.id]), handle = bounds && ring(bounds, view);
      if (!handle) continue;
      const hot = this.#hover && distance(this.#hover, handle.point) <= handle.radius;
      context.lineWidth = hot ? 2.5 : 1.5; context.beginPath(); context.arc(handle.point.x, handle.point.y, 4.5, 0, Math.PI * 2);
      if (drag?.action.kind === "reorder" && drag.action.source === slot.id) context.fill(); else context.stroke();
    }
    if (drag?.action.kind === "reorder" && drag.moved) {
      const target = drag.action.layout.slots.find(slot => slot.id === (drag.action as Extract<Action, { kind: "reorder" }>).target)!;
      const start = pageToScreen(view, { x: target.box.x, y: target.box.y });
      context.strokeStyle = canvasAccent(this.engine.getRenderDocument()); context.lineWidth = 2; context.strokeRect(start.x - 3, start.y - 3, target.box.width * view.zoom + 6, target.box.height * view.zoom + 6);
    } else for (const axis of drag?.action.kind === "spacing" ? [drag.action.axis] : [layout.spacing.horizontal, layout.spacing.vertical]) if (axis) {
      for (const handle of gapHandles(document, axis, view)) {
        const hot = Boolean(drag || this.#hover && onGap(this.#hover, handle));
        const { x, y } = handle.point; context.lineWidth = hot ? 3 : 2; context.beginPath();
        context.moveTo(x - (axis.vertical ? 10 : 0), y - (axis.vertical ? 0 : 10)); context.lineTo(x + (axis.vertical ? 10 : 0), y + (axis.vertical ? 0 : 10)); context.stroke();
        if (hot) {
          const label = String(Math.round(handle.value * 100) / 100), cx = x + (axis.vertical ? 18 : 0), cy = y + (axis.vertical ? 0 : -22);
          context.font = "600 10px system-ui"; context.textAlign = "center"; context.textBaseline = "middle";
          const width = context.measureText(label).width + 8;
          context.fillStyle = "#f2488c"; context.beginPath(); context.roundRect(cx - width / 2, cy - 7, width, 14, 3); context.fill();
          context.fillStyle = "#ffffff"; context.fillText(label, cx, cy); context.fillStyle = "#f2488c";
        }
      }
    }
    context.restore();
  }
}
