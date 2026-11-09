import { polygonPoints, starPoints } from "./polygon";
import { inverse, transformPoint } from "./affine";
import { cornerKeys, zeroCorners } from "./corners";
import { isFrameLike, type Document, type LayerNode, type NodeId } from "./document";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import type { EditorEngine } from "./editor";
import { canvasAccent } from "./canvas-colours";
import { pageToScreen } from "./viewport";
import { frameCorners, handleAt } from "./transform-handles";
import { selectionFrame } from "./rotation";

export type CornerHandle = number | "ratio";
function corners(n: LayerNode) {
  const radii = n.corners?.radii ?? zeroCorners.radii;
  if (n.kind === "polygon" || n.kind === "star") {
    const points = n.kind === "polygon" ? polygonPoints(n.width, n.height, n.count) : starPoints(n.width, n.height, n.count, n.innerRatio);
    const at = points[0], prev = points.at(-1)!, next = points[1];
    const v1 = { x: prev.x - at.x, y: prev.y - at.y }, v2 = { x: next.x - at.x, y: next.y - at.y }, l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9) return [];
    const u1 = { x: v1.x / l1, y: v1.y / l1 }, u2 = { x: v2.x / l2, y: v2.y / l2 }, x = u1.x + u2.x, y = u1.y + u2.y, length = Math.hypot(x, y);
    const half = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))) / 2;
    return length > 1e-9 && half > 1e-6 ? [{ at, into: { x: x / length, y: y / length }, half, max: Math.min(l1, l2) / 2 * Math.tan(half), radius: radii[0] }] : [];
  }
  if (n.kind !== "rectangle" && !isFrameLike(n)) return [];
  return radii.map((radius, i) => ({ at: { x: i === 0 || i === 3 ? 0 : n.width, y: i < 2 ? 0 : n.height }, into: { x: (i === 0 || i === 3 ? 1 : -1) * Math.SQRT1_2, y: (i < 2 ? 1 : -1) * Math.SQRT1_2 }, half: Math.PI / 4, max: Math.min(n.width, n.height) / 2, radius }));
}
export function cornerHandles(document: Document, ids: readonly NodeId[], zoom: number): readonly { index: CornerHandle; point: Point }[] {
  if (ids.length !== 1 || !Number.isFinite(zoom) || zoom <= 0) return [];
  const n = document.nodes[ids[0]];
  if (!n || n.kind === "page" || n.kind === "group" || n.kind === "ellipse" || n.visible === false || n.locked) return [];
  const t = worldTransform(document, n.id), scale = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2]));
  if (!Number.isFinite(scale) || scale <= 1e-9 || Math.min(n.width, n.height) * scale * zoom < 48) return [];
  const result: { index: CornerHandle; point: Point }[] = corners(n).map((c, index) => {
    const distance = Math.max(Math.max(0, Math.min(c.max, c.radius)) / Math.sin(c.half), 10 / (zoom * scale));
    return { index, point: transformPoint(t, { x: c.at.x + c.into.x * distance, y: c.at.y + c.into.y * distance }) };
  });
  if (n.kind === "star") result.push({ index: "ratio", point: transformPoint(t, starPoints(n.width, n.height, n.count, n.innerRatio)[1]) });
  return result;
}
export function cornerDrag(document: Document, id: NodeId, index: CornerHandle, point: Point, alt: boolean): Record<string, number> | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const n = document.nodes[id]; if (!n || n.kind === "page" || n.kind === "group" || n.kind === "ellipse") return;
  let q: Point; try { q = transformPoint(inverse(worldTransform(document, id)), point); } catch { return; }
  if (index === "ratio") {
    if (n.kind !== "star" || n.width <= 0 || n.height <= 0) return;
    const rx = n.width / 2, ry = n.height / 2, dir = starPoints(n.width, n.height, n.count, 1)[1], ray = { x: dir.x / rx - 1, y: dir.y / ry - 1 };
    const ratio = ((q.x / rx - 1) * ray.x + (q.y / ry - 1) * ray.y) / Math.max(1e-12, ray.x * ray.x + ray.y * ray.y);
    return Number.isFinite(ratio) ? { innerRadius: Math.max(.001, Math.min(1, ratio)) } : undefined;
  }
  const c = corners(n)[index]; if (!c) return;
  const independent = n.kind === "rectangle" || isFrameLike(n);
  const dx = index === 0 || index === 3 ? q.x : n.width - q.x, dy = index < 2 ? q.y : n.height - q.y;
  const radius = independent ? (dx + dy) / 2 : ((q.x - c.at.x) * c.into.x + (q.y - c.at.y) * c.into.y) * Math.sin(c.half);
  if (!Number.isFinite(radius)) return;
  return { [alt && independent ? cornerKeys[index] : "cornerRadius"]: Math.max(0, Math.min(c.max, radius)) };
}
export function cornerValue(node: LayerNode, index: CornerHandle): number | undefined {
  if (index === "ratio") return node.kind === "star" ? Math.round(node.innerRatio * 1000) / 10 : undefined;
  const c = corners(node)[index]; return c ? Math.round(Math.max(0, Math.min(c.max, c.radius)) * 10) / 10 : undefined;
}
/** Radius previews use node.set semantics, one history transaction and no root React updates. */
export class CornerInteraction {
  #gesture?: { id: NodeId; index: CornerHandle; base: Document };
  #hover?: CornerHandle;
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
        const value = cornerValue(node, h.index); if (value === undefined) continue;
        const label = h.index === "ratio" ? `Ratio ${value}%` : `Radius ${value}`; context.font = "600 11px sans-serif"; context.fillStyle = "#00875f"; context.beginPath(); context.roundRect(p.x + 12, p.y + 12, context.measureText(label).width + 8, 18, 3); context.fill(); context.fillStyle = "white"; context.textBaseline = "top"; context.fillText(label, p.x + 16, p.y + 14);
      }
    }
    context.restore();
  }
}
