import { inverse, transformPoint } from "./affine";
import { arcOf, fullSweep, modulo, TAU, type Arc } from "./ellipse";
import type { Document } from "./document";
import { pixelRound, type Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import type { EditorEngine } from "./editor";
import { canvasAccent } from "./canvas-colours";
import { pageToScreen } from "./viewport";

export type ArcHandle = "sweep" | "start" | "ratio";
function ellipse(document: Document, id: string) {
  const node = document.nodes[id]; if (!node || node.kind !== "ellipse" || node.width <= 0 || node.height <= 0) return;
  const matrix = worldTransform(document, id), determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12 || !Number.isFinite(node.width) || !Number.isFinite(node.height)) return;
  const rx = node.width / 2, ry = node.height / 2;
  const point = (angle: number, ratio: number): Point => transformPoint(matrix, { x: rx * (1 + ratio * Math.cos(angle)), y: ry * (1 + ratio * Math.sin(angle)) });
  return { node, matrix, rx, ry, point };
}
export function arcHandlePoint(document: Document, id: string, handle: ArcHandle, arc: Arc, zoom: number): Point | undefined {
  const e = ellipse(document, id); if (!e) return;
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
  if (handle === "ratio") return e.point(arc.start + arc.sweep / 2, arc.inner);
  const edge = e.point(handle === "sweep" ? arc.start + arc.sweep : arc.start, 1), centre = e.point(0, 0);
  const dx = centre.x - edge.x, dy = centre.y - edge.y, length = Math.hypot(dx, dy);
  if (length <= 1e-12) return edge;
  const inset = Math.min(10 / Math.max(zoom, 1e-6), length / 2) / length;
  return { x: edge.x + dx * inset, y: edge.y + dy * inset };
}
export function arcHandles(document: Document, ids: readonly string[], zoom: number): readonly { handle: ArcHandle; point: Point }[] {
  if (ids.length !== 1 || !Number.isFinite(zoom) || zoom <= 0) return [];
  const e = ellipse(document, ids[0]); if (!e || e.node.visible === false || e.node.locked) return [];
  const side = Math.min(Math.hypot(e.matrix[0], e.matrix[1]) * e.node.width, Math.hypot(e.matrix[2], e.matrix[3]) * e.node.height);
  if (side * zoom < 40) return [];
  const a = arcOf(e.node), full = fullSweep(a.sweep), handles: ArcHandle[] = ["sweep"];
  if (!full) handles.push("start"); if (!full || a.inner > 0) handles.push("ratio");
  return handles.map(handle => ({ handle, point: arcHandlePoint(document, ids[0], handle, a, zoom)! }));
}
export function hitArc(document: Document, ids: readonly string[], point: Point, zoom: number): ArcHandle | undefined {
  let closest = 7 / zoom, best: ArcHandle | undefined;
  for (const h of arcHandles(document, ids, zoom)) { const d = Math.hypot(point.x - h.point.x, point.y - h.point.y); if (d <= closest && (best === undefined || d < closest)) { best = h.handle; closest = d; } }
  return best;
}
export function dragArc(document: Document, id: string, handle: ArcHandle, current: Arc, point: Point, shift: boolean, zoom: number): Arc | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const e = ellipse(document, id); if (!e) return;
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
  let local: Point;
  try { local = transformPoint(inverse(e.matrix), point); } catch { return; }
  const ux = local.x / e.rx - 1, uy = local.y / e.ry - 1;
  if (!Number.isFinite(ux) || !Number.isFinite(uy)) return;
  const angle = Math.atan2(uy, ux), snap = (n: number, step: number) => pixelRound(n / step) * step;
  let { start, sweep, inner } = current;
  if (handle === "sweep") {
    const d = modulo(angle - start, TAU), distance = (s: number) => { const n = modulo(s - current.sweep, 2 * TAU); return Math.min(n, 2 * TAU - n); };
    sweep = distance(d - TAU) < distance(d) ? d - TAU : d;
    if (shift) sweep = snap(sweep, Math.PI / 12);
    const a = e.point(start + sweep, 1), b = e.point(start, 1), gap = Math.hypot(a.x - b.x, a.y - b.y) * zoom;
    sweep = Math.abs(sweep) > TAU / 2 && gap <= 6 ? TAU * Math.sign(sweep) : Math.max(-TAU, Math.min(TAU, sweep));
  } else if (handle === "start") start = modulo(shift ? snap(angle, Math.PI / 12) : angle, TAU);
  else {
    const ratio = Math.hypot(ux, uy); inner = Math.max(0, Math.min(.99, shift ? snap(ratio, .05) : ratio));
    const centre = e.point(0, 0), along = current.sweep >= 0 ? angle - current.start : current.start - angle;
    if (Math.hypot(point.x - centre.x, point.y - centre.y) * zoom > 7 && !fullSweep(current.sweep) && modulo(along, TAU) > Math.abs(current.sweep)) {
      start = modulo(current.start + current.sweep, TAU); sweep = (TAU - Math.abs(current.sweep)) * (current.sweep < 0 || Object.is(current.sweep, -0) ? -1 : 1);
    }
  }
  return [start, sweep, inner].every(Number.isFinite) ? { start, sweep, inner } : undefined;
}
export function arcLabel(arc: Arc, handle: ArcHandle): string {
  const n = handle === "start" ? modulo(arc.start * 180 / Math.PI, 360) : handle === "sweep" ? arc.sweep / TAU * 100 : arc.inner * 100;
  return `${handle === "start" ? "Start" : handle === "sweep" ? "Sweep" : "Ratio"} ${pixelRound(n * 10) / 10 || 0}${handle === "start" ? "°" : "%"}`;
}
export class ArcInteraction {
  #gesture?: { id: string; handle: ArcHandle; arc: Arc };
  #hover?: ArcHandle;
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return Boolean(this.#gesture); }
  #shown(): boolean { const s = this.engine.getSnapshot(); return s.editable && s.tool === "move"; }
  hover(point?: Point): string | undefined {
    this.#hover = point && this.#shown() ? hitArc(this.engine.getRenderDocument(), this.engine.getRenderSelection(), point, this.engine.getView().zoom) : undefined;
    return this.#hover === undefined ? undefined : "default";
  }
  down(point: Point): boolean {
    if (this.hover(point) === undefined || !this.#hover) return false;
    const s = this.engine.getSnapshot(), node = s.document.nodes[s.selection[0]]; if (node.kind !== "ellipse") return false;
    this.engine.beginInteraction(); this.#gesture = { id: node.id, handle: this.#hover, arc: arcOf(node) }; return true;
  }
  move(point: Point, shift: boolean): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#gesture = undefined; return; }
    try {
      const arc = dragArc(this.engine.getRenderDocument(), g.id, g.handle, g.arc, point, shift, this.engine.getView().zoom); if (!arc) return;
      this.engine.previewProperties(g.id, { arcStart: arc.start * 180 / Math.PI, arcSweep: arc.sweep * 180 / Math.PI, arcInner: arc.inner }); g.arc = arc;
    } catch (error) { this.cancel(); this.onError(error instanceof Error ? error.message : "Could not edit arc"); }
  }
  up(): void { if (this.#gesture) { this.#gesture = undefined; this.engine.commitInteraction(); } }
  cancel(): void { if (this.#gesture) { this.#gesture = undefined; this.engine.cancelInteraction(); } this.#hover = undefined; }
  draw(context: CanvasRenderingContext2D): void {
    if (!this.#shown()) return;
    const doc = this.engine.getRenderDocument(), ids = this.engine.getRenderSelection(), view = this.engine.getView();
    context.save(); context.lineWidth = 1; context.strokeStyle = canvasAccent(doc);
    for (const h of arcHandles(doc, ids, view.zoom)) {
      const p = pageToScreen(view, h.point); context.fillStyle = "white"; context.beginPath(); context.arc(p.x, p.y, h.handle === (this.#gesture?.handle ?? this.#hover) ? 5 : 4, 0, TAU); context.fill(); context.stroke();
      if (h.handle === "start") { context.fillStyle = canvasAccent(doc); context.beginPath(); context.arc(p.x, p.y, 1.5, 0, TAU); context.fill(); }
    }
    const g = this.#gesture;
    if (g) {
      const position = arcHandlePoint(doc, g.id, g.handle, g.arc, view.zoom);
      if (position) { const p = pageToScreen(view, position), label = arcLabel(g.arc, g.handle); context.font = "600 11px sans-serif"; context.fillStyle = "#00875f"; context.beginPath(); context.roundRect(p.x + 12, p.y + 12, context.measureText(label).width + 8, 18, 3); context.fill(); context.fillStyle = "white"; context.textBaseline = "top"; context.fillText(label, p.x + 16, p.y + 14); }
    }
    context.restore();
  }
}
