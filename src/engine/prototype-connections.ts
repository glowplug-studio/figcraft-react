import type { Document, NodeId } from "./document";
import type { Point } from "./geometry";
import { ancestors, pageForNode, subtreeIds } from "./hierarchy";
import { topFrames, topLevelFrame } from "./prototype-commands";
import type { PrototypeAction } from "./prototype-data";
import { sectionsIn } from "./prototype-summaries";
import { boundsOf } from "./viewport";

/** Source: upstream ui-egui/src/canvas/proto_canvas.rs: prototype connections drawn on the canvas, and connections dragged out of a layer. */
export interface ScreenRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
export type Curve = readonly [Point, Point, Point, Point];
export interface Connection { readonly source: NodeId; readonly index: number; readonly dest: NodeId }
/** Native `HANDLE_R`: the radius of a selected layer's connection handle. */
export const handleRadius = 7;

const centre = (r: ScreenRect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
/** Native `curve_between`: from layer `a` to frame `b`, leaving the side facing the destination. */
export function curveBetween(a: ScreenRect, b: ScreenRect): Curve {
  const right = centre(b).x >= centre(a).x, ay = centre(a).y, by = centre(b).y;
  const p0 = right ? { x: a.x1, y: ay } : { x: a.x0, y: ay }, p3 = right ? { x: b.x0, y: by } : { x: b.x1, y: by };
  const dx = Math.max(Math.abs(p3.x - p0.x) * 0.5, 40) * (right ? 1 : -1);
  return [p0, { x: p0.x + dx, y: p0.y }, { x: p3.x - dx, y: p3.y }, p3];
}
/** A dragged connection from `from` to the pointer (native's draw while dragging). */
export function dragCurve(from: Point, to: Point): Curve {
  const dx = Math.max(Math.abs(to.x - from.x) * 0.5, 30) * (to.x >= from.x ? 1 : -1);
  return [from, { x: from.x + dx, y: from.y }, { x: to.x - dx, y: to.y }, to];
}
export function bezierAt(p: Curve, t: number): Point {
  const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * p[0].x + w[1] * p[1].x + w[2] * p[2].x + w[3] * p[3].x, y: w[0] * p[0].y + w[1] * p[1].y + w[2] * p[2].y + w[3] * p[3].y };
}
function segmentDistance(a: Point, b: Point, q: Point) {
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.min(Math.max(((q.x - a.x) * abx + (q.y - a.y) * aby) / len2, 0), 1) : 0;
  return Math.hypot(a.x + abx * t - q.x, a.y + aby * t - q.y);
}
/** Native `bezier_distance`: the distance from `q` to a cubic, sampled. */
export function bezierDistance(p: Curve, q: Point): number {
  let best = Infinity, prev = p[0];
  for (let i = 1; i <= 32; i++) { const cur = bezierAt(p, i / 32); best = Math.min(best, segmentDistance(prev, cur, q)); prev = cur; }
  return best;
}
/** The first destination an interaction's actions point at, conditional blocks included (native `walk(..).find_map(dest)`). */
function firstDest(actions: readonly PrototypeAction[], depth = 0): NodeId | undefined {
  for (const a of actions) {
    if ("dest" in a) return a.dest;
    if (a.type === "conditional" && depth < 16) for (const b of a.blocks) { const d = firstDest(b.actions, depth + 1); if (d !== undefined) return d; }
  }
  return undefined;
}
/** Native `noodles` without drawing: each interaction on `page` with a destination on the same page. */
export function connections(doc: Document, page: NodeId): Connection[] {
  const out: Connection[] = [];
  for (const id of subtreeIds(doc, page)) {
    for (const [index, it] of (doc.nodes[id].interactions ?? []).entries()) {
      const dest = firstDest(it.actions);
      if (dest !== undefined && doc.nodes[dest] && pageForNode(doc, dest) === page) out.push({ source: id, index, dest });
    }
  }
  return out;
}
const contains = (doc: Document, id: NodeId, p: Point) => { const b = boundsOf(doc, [id]); return !!b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height; };
/** Native `frame_at`: the top-level frame under a page point (top-most first), else the innermost section there. */
export function frameAt(doc: Document, page: NodeId, p: Point): NodeId | undefined {
  return [...topFrames(doc, page)].reverse().find(f => contains(doc, f, p)) ?? [...sectionsIn(doc, page)].reverse().find(s => contains(doc, s, p));
}
/** Native `variant_of`: the variant (a child of a component set) the layer is or sits in. */
function variantOf(doc: Document, source: NodeId): NodeId | undefined {
  return [source, ...ancestors(doc, source)].find(v => { const p = doc.nodes[v]?.parent; return p != null && doc.nodes[p]?.kind === "componentSet"; });
}
export type ConnectionTarget = { readonly kind: "navigate" | "changeTo"; readonly node: NodeId };
/** Native `target_at`: a sibling variant of the source's own (Change to), else a frame other than the source's own (Navigate to). */
export function targetAt(doc: Document, page: NodeId, source: NodeId, p: Point): ConnectionTarget | undefined {
  const v = variantOf(doc, source);
  if (v !== undefined) {
    const set = doc.nodes[v].parent!;
    const siblings = [...((doc.nodes[set] as { children: readonly NodeId[] }).children)].reverse();
    const w = siblings.find(s => contains(doc, s, p));
    if (w !== undefined) return w !== v ? { kind: "changeTo", node: w } : undefined;
    // The set's own background: nothing, whatever holds the set.
    if (contains(doc, set, p)) return undefined;
  }
  const f = frameAt(doc, page, p);
  return f !== undefined && topLevelFrame(doc, source) !== f ? { kind: "navigate", node: f } : undefined;
}
