import { inverse, transformPoint, type Affine } from "./affine";
import type { PathCommand } from "./corners";
import { hidesContents, isFrameLike, type Document, type DocumentNode, type LayerNode, type NodeId } from "./document";
import { fitCubicRoots } from "./fit-polynomial";
import type { Point, Rectangle } from "./geometry";
import { worldTransform } from "./hierarchy";
import { shapePath } from "./shape-path";
import { pathWinding, vectorFillContains } from "./vector-path";
import { drawnVectorNetwork } from "./vector-rounded";
import { boundsOf } from "./viewport";

/**
 * Marquee selection. Source: doc/src/geometry.rs `marquee_select`, `marquee_deep`, `marquee_children`,
 * `marquee_touches` and `path_touches_rect` (upstream cb526214, 604c7846), the rules upstream measured in the target
 * application on 11 November 2026.
 */

type Curve = readonly [Point, Point, Point, Point];
const overlaps = (a: Rectangle, b: Rectangle): boolean => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
/** Native `Rect::contains`: the far edges are outside. */
const holds = (r: Rectangle, p: Point): boolean => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/** The segments of `path` under `m`, a closing line included, each as a cubic. */
function worldSegments(path: readonly PathCommand[], m: Affine): Curve[] {
  const out: Curve[] = [], at = (x: number, y: number) => transformPoint(m, { x, y });
  let start: Point | undefined, current: Point | undefined;
  const line = (a: Point, b: Point) => { out.push([a, a, b, b]); };
  for (const c of path) {
    if (c[0] === "M") start = current = at(c[1], c[2]);
    else if (!current) continue;
    else if (c[0] === "L") { const next = at(c[1], c[2]); line(current, next); current = next; }
    else if (c[0] === "C") { const next = at(c[5], c[6]); out.push([current, at(c[1], c[2]), at(c[3], c[4]), next]); current = next; }
    else if (start) { if (current.x !== start.x || current.y !== start.y) line(current, start); current = start; }
  }
  return out;
}

/** Whether curve `c` and the line from `p` to `q` share a point (Kurbo's `intersect_line`, with the line's own span). */
function crosses(c: Curve, p: Point, q: Point): boolean {
  const dx = q.x - p.x, dy = q.y - p.y, length = dx * dx + dy * dy;
  const power = (k: "x" | "y") => [c[0][k], 3 * (c[1][k] - c[0][k]), 3 * (c[2][k] - 2 * c[1][k] + c[0][k]), c[3][k] - 3 * c[2][k] + 3 * c[1][k] - c[0][k]];
  const x = power("x"), y = power("y");
  const roots = fitCubicRoots(dy * (x[0] - p.x) - dx * (y[0] - p.y), dy * x[1] - dx * y[1], dy * x[2] - dx * y[2], dy * x[3] - dx * y[3]);
  return roots.some(t => {
    if (!(t >= -1e-9 && t <= 1 + 1e-9)) return false;
    const px = ((x[3] * t + x[2]) * t + x[1]) * t + x[0], py = ((y[3] * t + y[2]) * t + y[1]) * t + y[0];
    const along = ((px - p.x) * dx + (py - p.y) * dy) / length;
    return along >= 0 && along <= 1;
  });
}

/** Native `path_touches_rect`: the marquee and the shape drawn as local `path` under `m` share a point: a path end
 * inside the marquee, a path segment crossing a marquee edge, or the marquee inside the filled shape. */
function pathTouchesBox(node: LayerNode, path: readonly PathCommand[], m: Affine, box: Rectangle): boolean {
  const inside = (p: Point) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
  const segments = worldSegments(path, m);
  if (segments.some(s => inside(s[0]) || inside(s[3]))) return true;
  const tl = { x: box.x, y: box.y }, tr = { x: box.x + box.width, y: box.y }, br = { x: box.x + box.width, y: box.y + box.height }, bl = { x: box.x, y: box.y + box.height };
  for (const [p, q] of [[tl, tr], [tr, br], [br, bl], [bl, tl]] as const) {
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue;
    if (segments.some(s => crosses(s, p, q))) return true;
  }
  if (node.kind === "line" || node.kind === "vector" && !node.network.regions.length) return false;
  const local = transformPoint(inverse(m), tl);
  return node.kind === "vector" ? vectorFillContains(drawnVectorNetwork(node), local) : pathWinding(path, local) !== 0;
}

/** Native `marquee_touches`: the layer's page box overlaps the marquee (edges count, so lines and zero-size marquees
 * do too) and, for a rotated shape, its outline on the page does as well. */
function marqueeTouches(document: Document, id: NodeId, node: LayerNode, box: Rectangle): boolean {
  const bounds = boundsOf(document, [id]);
  if (!bounds || !overlaps(box, bounds)) return false;
  if (node.kind !== "rectangle" && node.kind !== "ellipse" && node.kind !== "polygon" && node.kind !== "star" && node.kind !== "line" && node.kind !== "vector") return true;
  const m = worldTransform(document, id), tiny = 1e-9, det = m[0] * m[3] - m[1] * m[2];
  const rotated = !(Math.abs(m[1]) < tiny && Math.abs(m[2]) < tiny || Math.abs(m[0]) < tiny && Math.abs(m[3]) < tiny);
  if (!rotated || ![...m, det].every(Number.isFinite) || Math.abs(det) < tiny) return true;
  return pathTouchesBox(node, shapePath(node), m, box);
}

/** Native `marquee_children`: the visible, unlocked children of `parent` the marquee touches. */
export function marqueeChildren(document: Document, parent: DocumentNode | undefined, box: Rectangle): NodeId[] {
  if (!parent || !("children" in parent)) return [];
  return parent.children.filter(id => { const n = document.nodes[id]; return n && n.kind !== "page" && n.visible !== false && !n.locked && marqueeTouches(document, id, n, box); });
}

/** Native `marquee_deep`: what a Ctrl or Cmd marquee selects: the innermost layers it touches. Frames, groups and
 * instances are looked into, a container none of whose children is touched counts itself, and a boolean group
 * counts as one shape. */
export function marqueeDeep(document: Document, box: Rectangle): NodeId[] {
  const out: NodeId[] = [];
  const walk = (parent: NodeId, depth: number): void => {
    for (const id of marqueeChildren(document, document.nodes[parent], box)) {
      const before = out.length, node = document.nodes[id];
      if ("children" in node && node.children.length && node.kind !== "booleanOp" && depth < 256) walk(id, depth + 1);
      if (out.length === before) out.push(id);
    }
  };
  walk(document.currentPage, 0);
  return out;
}

/**
 * Native `marquee_select`: each top-level layer the marquee touches is selected whole, except a frame with children
 * or a section with its contents shown: enclosed by the marquee it is selected itself, otherwise the marquee takes
 * the layers in it that it touches. The frame the drag started in (`startInside`) is selected only when the marquee
 * also takes another top-level frame, then whole; otherwise only the layers in it the marquee touches. Selecting a
 * frame or section whole keeps the marquee at the top level: no frame opens then, and a partly covered one is
 * selected whole. Components, instances and sections with hidden contents are selected only when enclosed.
 */
export function marqueeSelect(document: Document, box: Rectangle, startInside: NodeId | undefined): NodeId[] {
  const page = document.nodes[document.currentPage];
  const classified = marqueeChildren(document, page, box).map(id => {
    const node = document.nodes[id] as LayerNode, bounds = boundsOf(document, [id]);
    const enclosed = !!bounds && holds(box, bounds) && holds(box, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    const container = isFrameLike(node) || node.kind === "section";
    const opens = (node.kind === "frame" || node.kind === "section") && !hidesContents(node) && node.children.length > 0;
    const emptyFrame = node.kind === "frame" && !node.children.length;
    const act = startInside === id ? "open" : opens ? (enclosed ? "whole" : "partial") : emptyFrame || !container || enclosed ? "whole" : "skip";
    return { id, act, wholeContainer: container && act === "whole" };
  });
  const topLevel = classified.some(c => c.wholeContainer), out: NodeId[] = [];
  for (const { id, act } of classified) {
    if (act === "whole" || act !== "skip" && topLevel) out.push(id);
    else if (act !== "skip") out.push(...marqueeChildren(document, document.nodes[id], box));
  }
  return out;
}
