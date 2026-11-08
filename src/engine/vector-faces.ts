import type { PathCommand } from "./corners";
import { cubicDerivative, cubicPoint, reverseCubic, type Cubic } from "./cubic";
import type { Point } from "./geometry";
import { networkCubic, type VectorNetwork } from "./vector-network";
import { appendVectorLoops, pathWinding } from "./vector-path";

export interface VectorFace {
  readonly loops: readonly (readonly number[])[];
  readonly path: readonly PathCommand[];
  readonly area: number;
}

interface HalfEdge {
  segment: number;
  origin: number;
  end: number;
  angle: number;
  along: number;
  area: number;
  next: number;
}

const epsilon = 1e-9;
const difference = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const nonzero = (d: Point) => Math.hypot(d.x, d.y) > epsilon;

// Three-point Gauss integration is exact for the polynomial (x dy - y dx) / 2.
function signedArea(curve: Cubic): number {
  const cross = (t: number) => {
    const p = cubicPoint(curve, t), d = cubicDerivative(curve, t);
    return p.x * d.y - p.y * d.x;
  };
  const offset = Math.sqrt(0.6) / 2;
  return (5 * cross(0.5 - offset) + 8 * cross(0.5) + 5 * cross(0.5 + offset)) / 36;
}

function halfEdge(curve: Cubic, segment: number, origin: number, end: number, forward: boolean, area: number): HalfEdge {
  const tangent = [cubicDerivative(curve, 0), difference(curve[2], curve[0]), difference(curve[3], curve[0])].find(nonzero)
    ?? { x: forward ? 1 : -1, y: 0 };
  const probe = difference(cubicPoint(curve, 0.25), curve[0]);
  return { segment, origin, end, area, angle: Math.atan2(tangent.y, tangent.x),
    along: nonzero(probe) ? Math.atan2(probe.y, probe.x) : Math.atan2(tangent.y, tangent.x), next: -1 };
}

function closedLoops(walk: readonly HalfEdge[]): number[][] {
  const counts = new Map<number, number>();
  for (const edge of walk) counts.set(edge.segment, (counts.get(edge.segment) ?? 0) + 1);
  const kept = walk.filter(edge => counts.get(edge.segment) === 1);
  const used = new Uint8Array(kept.length);
  const result: number[][] = [];
  for (let start = 0; start < kept.length; start++) {
    if (used[start]) continue;
    const loop: number[] = [];
    let pos = start;
    while (!used[pos]) {
      const edge = kept[pos];
      loop.push(edge.segment);
      used[pos] = 1;
      if (edge.end === kept[start].origin) { result.push(loop); break; }
      let offset = 1;
      for (; offset <= kept.length; offset++) {
        const next = (pos + offset) % kept.length;
        if (!used[next] && kept[next].origin === edge.end) { pos = next; break; }
      }
      if (offset > kept.length) break;
    }
  }
  return result;
}

interface Boundary extends VectorFace { component: number; point: Point }
const inside = (path: readonly PathCommand[], p: Point) => pathWinding(path, p) % 2 !== 0;

function boundaries(net: VectorNetwork): Boundary[] {
  const parents = net.vertices.map((_, index) => index);
  const root = (v: number) => {
    while (v !== parents[v]) { parents[v] = parents[parents[v]]; v = parents[v]; }
    return v;
  };
  const edges: HalfEdge[] = [];
  const outgoing: number[][] = net.vertices.map(() => []);
  for (let i = 0; i < net.segments.length; i++) {
    const curve = networkCubic(net, i);
    if (!curve) continue;
    const { a, b } = net.segments[i];
    parents[root(a)] = root(b);
    const index = edges.length, area = signedArea(curve);
    edges.push(halfEdge(curve, i, a, b, true, area), halfEdge(reverseCubic(curve), i, b, a, false, -area));
    outgoing[a].push(index);
    outgoing[b].push(index + 1);
  }
  for (const list of outgoing) {
    list.sort((a, b) => edges[a].angle - edges[b].angle || edges[a].along - edges[b].along);
    for (let i = 0; i < list.length; i++) edges[list[i] ^ 1].next = list[(i + list.length - 1) % list.length];
  }
  const seen = new Uint8Array(edges.length);
  const probes = new Map<number, Point>();
  const result: Boundary[] = [];
  for (let start = 0; start < edges.length; start++) {
    if (seen[start]) continue;
    let current = start, area = 0;
    const walk: HalfEdge[] = [];
    while (!seen[current]) {
      const edge = edges[current];
      seen[current] = 1;
      walk.push(edge);
      area += edge.area;
      current = edge.next;
    }
    const component = root(edges[start].origin);
    if (!probes.has(component)) probes.set(component, net.vertices[edges[start].origin]);
    if (current !== start || !Number.isFinite(area) || Math.abs(area) <= epsilon) continue;
    const loops = closedLoops(walk);
    if (!loops.length) continue;
    const path: PathCommand[] = [];
    appendVectorLoops(path, net, loops);
    result.push({ loops, path, area, component, point: probes.get(component)! });
  }
  return result;
}

const cache = new WeakMap<VectorNetwork, readonly VectorFace[]>();
export function vectorFaces(net: VectorNetwork): readonly VectorFace[] {
  const cached = cache.get(net);
  if (cached) return cached;
  const cycles = boundaries(net);
  const exterior = new Map<number, Boundary>();
  for (const cycle of cycles) {
    if (cycle.area < (exterior.get(cycle.component)?.area ?? 0)) exterior.set(cycle.component, cycle);
  }
  const pieces = [...exterior.values()].sort((a, b) => a.component - b.component);
  const faces = cycles.filter(c => c.area > 0).map(outer => {
    const nested = pieces.filter(p => p.component !== outer.component && inside(outer.path, p.point));
    const holes = nested.filter(p => !nested.some(other => other !== p && inside(other.path, p.point)));
    return { loops: outer.loops.concat(holes.flatMap(h => h.loops)), path: outer.path.concat(holes.flatMap(h => h.path)),
      area: holes.reduce((a, hole) => a + hole.area, outer.area) };
  });
  if (Object.isFrozen(net)) cache.set(net, faces);
  return faces;
}

export function vectorFaceAt(faces: readonly VectorFace[], point: Point): VectorFace | undefined {
  let hit: VectorFace | undefined;
  for (const face of faces) if ((!hit || face.area < hit.area) && inside(face.path, point)) hit = face;
  return hit;
}
