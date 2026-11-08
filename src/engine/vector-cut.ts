import { cubicPoint, type Cubic } from "./cubic";
import { unitIntervalRoots } from "./cubic-nearest";
import type { Point } from "./geometry";
import { splitSegment } from "./vector-edit-ops";
import { freezeNetwork, networkCubic, networkIncident, type VectorNetwork, type VectorRegion, type VectorSegment, type VectorVertex } from "./vector-network";

type Cut = { network: VectorNetwork; vertices: number[] };

/** Start any opened fill loop at its seam so the implicit closing edge crosses the cut. */
function reopen(net: VectorNetwork): VectorNetwork {
  const shares = (a: VectorSegment | undefined, b: VectorSegment | undefined) => a && b && (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b);
  const regions = net.regions.map(r => ({ ...r, loops: r.loops.map(loop => {
    if (loop.length < 2) return loop;
    const at = loop.findIndex((seg, i) => !shares(net.segments[loop[(i + loop.length - 1) % loop.length]], net.segments[seg]));
    return at <= 0 ? loop : [...loop.slice(at), ...loop.slice(0, at)];
  }) }));
  return freezeNetwork({ ...net, regions });
}

export function cutVectorSegment(net: VectorNetwork, segment: number, t: number): Cut | undefined {
  const split = splitSegment(net, segment, t);
  if (!split) return;
  const mid = split.vertex, vertices = [...split.network.vertices], segments = [...split.network.segments];
  const endpoint = { ...vertices[mid], mirror: undefined };
  vertices[mid] = endpoint;
  const other = vertices.length;
  vertices.push(endpoint);
  segments[segments.length - 1] = { ...segments[segments.length - 1], a: other };
  return { network: reopen({ ...split.network, vertices, segments }), vertices: [mid, other] };
}

export function cutVectorVertex(net: VectorNetwork, vertex: number): Cut | undefined {
  if (!net.vertices[vertex]) return;
  const vertices = [...net.vertices], segments = [...net.segments], ends = [vertex];
  const endpoint = { ...vertices[vertex], mirror: undefined };
  vertices[vertex] = endpoint;
  for (const [i, start] of networkIncident(net, vertex).slice(1)) {
    ends.push(vertices.length);
    segments[i] = { ...segments[i], [start ? "a" : "b"]: vertices.length };
    vertices.push(endpoint);
  }
  return { network: reopen({ ...net, vertices, segments }), vertices: ends };
}

/** Intersections with the finite cut line, retaining the native 1% endpoint clearance. */
function crossings(curve: Cubic, from: Point, x: number, y: number, length: number) {
  const [a, b, c, d] = curve.map(p => (p.x - from.x) * y - (p.y - from.y) * x);
  const ts = unitIntervalRoots([a, 3 * (b - a), 3 * (c - 2 * b + a), d - 3 * c + 3 * b - a]);
  const valid: number[] = [];
  for (const t of ts) {
    if (t < .01 || t > .99 || (valid.length && t - valid[valid.length - 1] < 1e-6)) continue;
    const p = cubicPoint(curve, t), along = (p.x - from.x) * x + (p.y - from.y) * y;
    if (along >= 0 && along <= length) valid.push(t);
  }
  return valid;
}

export function cutVectorAcross(net: VectorNetwork, from: Point, to: Point): Cut {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  let network = net;
  const vertices: number[] = [];
  if (Number.isFinite(length) && length >= 1e-9) net.segments.forEach((_, i) => {
    const curve = networkCubic(net, i); if (!curve) return;
    let end = 1;
    for (const t of crossings(curve, from, dx / length, dy / length, length).reverse()) {
      const cut = cutVectorSegment(network, i, t / end);
      if (cut) { network = cut.network; vertices.push(...cut.vertices); }
      end = t;
    }
  });
  return { network, vertices };
}

type Part = { vertices: VectorVertex[]; segments: VectorSegment[]; regions: VectorRegion[] };

/** Connected networks in first-vertex order, retaining per-part pieces of each fill loop. */
export function cutComponents(net: VectorNetwork): VectorNetwork[] {
  const parent = net.vertices.map((_, i) => i);
  function root(i: number) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  for (const s of net.segments) if (net.vertices[s.a] && net.vertices[s.b]) parent[root(s.a)] = root(s.b);
  const parts = new Map<number, Part>(), vertexIndex: number[] = [];
  net.vertices.forEach((v, i) => {
    const group = root(i);
    let part = parts.get(group);
    if (!part) { part = { vertices: [], segments: [], regions: [] }; parts.set(group, part); }
    vertexIndex[i] = part.vertices.length; part.vertices.push(v);
  });
  const remap = net.segments.map(s => {
    if (!net.vertices[s.a] || !net.vertices[s.b]) return;
    const part = parts.get(root(s.a))!, i = part.segments.length;
    part.segments.push({ ...s, a: vertexIndex[s.a], b: vertexIndex[s.b] });
    return { part, i };
  });
  for (const region of net.regions) {
    const loops = new Map<Part, number[][]>();
    for (const loop of region.loops) {
      const pieces = new Map<Part, number[]>();
      for (const segment of loop) {
        const entry = remap[segment]; if (!entry) continue;
        const piece = pieces.get(entry.part);
        if (piece) piece.push(entry.i); else pieces.set(entry.part, [entry.i]);
      }
      for (const [part, piece] of pieces) {
        const existing = loops.get(part);
        if (existing) existing.push(piece); else loops.set(part, [piece]);
      }
    }
    for (const [part, list] of loops) part.regions.push({ ...region, loops: list });
  }
  return [...parts.values()].map(reopen);
}
