import { inverse, transformPoint } from "./affine";
import { cornerKeys, zeroCorners } from "./corners";
import type { Document, NodeId } from "./document";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import type { EditorEngine } from "./editor";
import { canvasAccent } from "./canvas-colours";
import { pageToScreen } from "./viewport";
import { frameCorners, handleAt } from "./transform-handles";
import { selectionFrame } from "./rotation";

export function cornerHandles(document: Document, ids: readonly NodeId[], zoom: number): readonly { index: number; point: Point }[] {
  if (ids.length !== 1 || !Number.isFinite(zoom) || zoom <= 0) return [];
  const n = document.nodes[ids[0]];
  if (!n || n.kind === "page" || n.kind === "group" || n.visible === false || n.locked) return [];
  const t = worldTransform(document, n.id), scale = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2]));
  if (!Number.isFinite(scale) || scale <= 1e-9 || Math.min(n.width, n.height) * scale * zoom < 48) return [];
  const radius = n.corners?.radii ?? zeroCorners.radii, max = Math.min(n.width, n.height) / 2;
  return radius.map((r, index) => {
    const inset = Math.max(Math.max(0, Math.min(max, r)), 10 / (zoom * scale * Math.SQRT2));
    return { index, point: transformPoint(t, { x: index === 0 || index === 3 ? inset : n.width - inset, y: index < 2 ? inset : n.height - inset }) };
  });
}
export function cornerDrag(document: Document, id: NodeId, index: number, point: Point, alt: boolean): Record<string, number> | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const n = document.nodes[id]; if (!n || n.kind === "page" || n.kind === "group" || index < 0 || index > 3) return;
  const q = transformPoint(inverse(worldTransform(document, id)), point); if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
  const dx = index === 0 || index === 3 ? q.x : n.width - q.x, dy = index < 2 ? q.y : n.height - q.y;
  return { [alt ? cornerKeys[index] : "cornerRadius"]: Math.max(0, Math.min(Math.min(n.width, n.height) / 2, (dx + dy) / 2)) };
}
/** Radius previews use node.set semantics, one history transaction and no root React updates. */
export class CornerInteraction {
  #gesture?: { id: NodeId; index: number; base: Document };
  #hover?: number;
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return Boolean(this.#gesture); }
  #handles() {
    const s = this.engine.getSnapshot();
    return s.editable && s.tool === "move" ? cornerHandles(this.engine.getRenderDocument(), this.engine.getRenderSelection(), this.engine.getView().zoom) : [];
  }
  hover(point?: Point): string | undefined {
    this.#hover = undefined; if (!point) return;
    const s = this.engine.getSnapshot(), zoom = this.engine.getView().zoom, frame = selectionFrame(s.document, s.selection);
    if (frame) {
      const corners = frameCorners(frame), handle = handleAt(corners, point, zoom);
      if (handle?.kind === "corner" && corners.some(p => Math.abs(p.x - point.x) <= 4 / zoom && Math.abs(p.y - point.y) <= 4 / zoom)) return;
    }
    let nearest = 6 / zoom;
    for (const h of this.#handles()) { const d = Math.hypot(h.point.x - point.x, h.point.y - point.y); if (d <= nearest && (d < nearest || this.#hover === undefined)) { nearest = d; this.#hover = h.index; } }
    return this.#hover === undefined ? undefined : "default";
  }
  down(point: Point): boolean {
    if (this.hover(point) === undefined || this.#hover === undefined) return false;
    const s = this.engine.getSnapshot(); this.engine.beginInteraction(); this.#gesture = { id: s.selection[0], index: this.#hover, base: s.document }; return true;
  }
  move(point: Point, alt: boolean): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#gesture = undefined; return; }
    try { const props = cornerDrag(g.base, g.id, g.index, point, alt); if (props) this.engine.previewProperties(g.id, props); }
    catch (error) { this.cancel(); this.onError(error instanceof Error ? error.message : "Could not round corners"); }
  }
  up(): void { if (this.#gesture) { this.#gesture = undefined; this.engine.commitInteraction(); } }
  cancel(): void { if (this.#gesture) { this.#gesture = undefined; this.engine.cancelInteraction(); } this.#hover = undefined; }
  draw(context: CanvasRenderingContext2D): void {
    const handles = this.#handles(), document = this.engine.getRenderDocument(), view = this.engine.getView();
    context.save(); context.strokeStyle = canvasAccent(document); context.lineWidth = 1;
    for (const h of handles) {
      const p = pageToScreen(view, h.point); context.fillStyle = "white"; context.beginPath(); context.arc(p.x, p.y, h.index === (this.#gesture?.index ?? this.#hover) ? 4.5 : 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
      if (h.index === this.#gesture?.index) {
        const node = document.nodes[this.#gesture.id]; if (node.kind === "page") continue;
        const radius = Math.round(Math.max(0, Math.min(Math.min(node.width, node.height) / 2, (node.corners ?? zeroCorners).radii[h.index])) * 10) / 10;
        const label = `Radius ${radius}`; context.font = "600 11px sans-serif"; context.fillStyle = "#00875f"; context.beginPath(); context.roundRect(p.x + 12, p.y + 12, context.measureText(label).width + 8, 18, 3); context.fill(); context.fillStyle = "white"; context.textBaseline = "top"; context.fillText(label, p.x + 16, p.y + 14);
      }
    }
    context.restore();
  }
}
