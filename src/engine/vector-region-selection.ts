import { inverse, transformPoint, type Affine } from "./affine";
import { flattenContours, mapVectorPath, type PathCommand } from "./corners";
import { nearestCubic } from "./cubic-nearest";
import { rectanglePaints, type Document, type NodeId } from "./document";
import type { Point, Rectangle } from "./geometry";
import { worldTransform } from "./hierarchy";
import { networkCubic, type VectorRegion } from "./vector-network";
import { pathBounds, vectorRegionContains, vectorRegionPath } from "./vector-path";
import { drawnVectorNetwork } from "./vector-rounded";

export function hitPaintedRegion(document: Document, id: NodeId, page: Point, zoom: number): number | undefined {
  const node = document.nodes[id];
  if (node?.kind !== "vector" || !Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(page.x) || !Number.isFinite(page.y)) return;
  const net = node.network, inherited = rectanglePaints(node);
  const visible = (r: VectorRegion) => (r.fills ?? inherited).some(p => p.visible);
  if (!net.regions.some(visible)) return;
  const world = worldTransform(document, id), determinant = world[0] * world[3] - world[1] * world[2];
  if (!determinant || !Number.isFinite(determinant)) return;
  const p = transformPoint(inverse(world), page);
  const unit = 1 / (zoom * Math.max(1e-9, Math.sqrt(Math.abs(determinant))));
  if (net.vertices.some(v => Math.hypot(v.x - p.x, v.y - p.y) <= 3.5 * unit)) return;
  for (let i = 0; i < net.segments.length; i++) {
    const curve = networkCubic(net, i);
    if (curve && (nearestCubic(curve, p)?.distance ?? Infinity) <= 2 * unit) return;
  }
  const drawn = drawnVectorNetwork(node);
  for (let i = drawn.regions.length - 1; i >= 0; i--) {
    if (visible(drawn.regions[i]) && vectorRegionContains(drawn, i, p)) return i;
  }
  return undefined;
}

export function regionHatchSpacing(zoom: number): number | undefined {
  if (!Number.isFinite(zoom) || zoom <= 0) return;
  const log = Math.log2(zoom);
  const octave = Math.min(1000, Math.max(-1000, Math.sign(log) * Math.round(Math.abs(log))));
  const spacing = 8 * zoom / 2 ** octave;
  return Number.isFinite(spacing) && spacing > 0 ? spacing : undefined;
}

export { mapVectorPath } from "./corners";

type Line = readonly [Point, Point];
const normal = (p: Point) => (p.x + p.y) * Math.SQRT1_2;
const along = (p: Point) => (p.x - p.y) * Math.SQRT1_2;
const unproject = (along: number, offset: number): Point => ({
  x: (along + offset) * Math.SQRT1_2, y: (offset - along) * Math.SQRT1_2,
});

/** Scan screen-space edges along the hatch normal. Clip the range of line indices to the viewport. */
function hatchRegion(path: readonly PathCommand[], rule: VectorRegion["winding"], anchor: Point, spacing: number, clip: Rectangle): Line[] {
  const box = pathBounds(path);
  if (!box) return [];
  const left = Math.max(box.x, clip.x), top = Math.max(box.y, clip.y);
  const right = Math.min(box.x + box.width, clip.x + clip.width), bottom = Math.min(box.y + box.height, clip.y + clip.height);
  if (!(right > left && bottom > top)) return [];
  const base = normal(anchor);
  const first = Math.floor((normal({ x: left, y: top }) - base) / spacing);
  const last = Math.ceil((normal({ x: right, y: bottom }) - base) / spacing);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 20_000) return [];
  const edges: { start: number; end: number; a: number; b: number }[] = [];
  for (const poly of flattenContours(path, .25)) {
    if (poly.length < 3) continue;
    let prev = poly[poly.length - 1];
    for (const p of poly) {
      edges.push({ start: normal(prev), end: normal(p), a: along(prev), b: along(p) });
      prev = p;
    }
  }
  const output: Line[] = [];
  for (let k = first; k <= last; k++) {
    const n = base + k * spacing;
    const crossings: { x: number; change: number }[] = [];
    for (const e of edges) {
      if ((e.start <= n) === (e.end <= n)) continue;
      crossings.push({ x: e.a + (e.b - e.a) * (n - e.start) / (e.end - e.start), change: e.end > e.start ? 1 : -1 });
    }
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0, previous = 0;
    for (const c of crossings) {
      if ((rule === "evenOdd" ? winding % 2 !== 0 : winding !== 0) && c.x > previous) {
        output.push([unproject(previous, n), unproject(c.x, n)]);
      }
      previous = c.x; winding += c.change;
    }
  }
  return output;
}

export function regionHatch(document: Document, id: NodeId, indices: readonly number[], view: Affine, clip: Rectangle): Line[] {
  const node = document.nodes[id];
  const gap = regionHatchSpacing(Math.sqrt(Math.abs(view[0] * view[3] - view[1] * view[2])));
  if (!indices.length || node?.kind !== "vector" || !gap) return [];
  const world = worldTransform(document, id), net = drawnVectorNetwork(node);
  const screen = (p: Point) => transformPoint(view, transformPoint(world, p));
  const anchor = screen({ x: 0, y: 0 });
  return [...new Set(indices)].sort((a, b) => a - b).flatMap(i => {
    const path = vectorRegionPath(net, i);
    return path ? hatchRegion(mapVectorPath(path, screen), net.regions[i].winding, anchor, gap, clip) : [];
  });
}
