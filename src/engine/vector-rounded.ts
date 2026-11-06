import { cubicDerivative, cubicLength, cubicLengthParameter, cubicPart, cubicPoint, cubicStartDirection, isStraightCubic, reverseCubic, type Cubic } from "./cubic";
import type { Point } from "./geometry";
import { freezeNetwork, networkCubic, vectorVertex, type VectorNetwork } from "./vector-network";

type End = readonly [number, boolean];
interface Corner { vertex: number; one: End; two: End; a: Point; b: Point; ta: readonly [number, number]; tb: readonly [number, number]; cut1: number; cut2: number }
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const angle = (value: number) => Math.acos(Math.max(-1, Math.min(1, value)));
function trim(c: Cubic, distance: number, length: number): { point: Point; back: Point; t: number } {
  if (isStraightCubic(c)) {
    const x = (c[3].x - c[0].x) / length, y = (c[3].y - c[0].y) / length;
    return { point: { x: c[0].x + x * distance, y: c[0].y + y * distance }, back: { x: -x, y: -y }, t: distance / length };
  }
  const t = cubicLengthParameter(c, distance, length), d = cubicDerivative(c, t), size = Math.hypot(d.x, d.y), fallback = cubicStartDirection(c);
  return { point: cubicPoint(c, t), back: size > 1e-9 ? { x: -d.x / size, y: -d.y / size } : { x: -(fallback?.x ?? 0), y: -(fallback?.y ?? 0) }, t };
}
function corner(net: VectorNetwork, vertex: number, incident: readonly End[]): Corner | undefined {
  const radius = net.vertices[vertex].radius;
  if (!(radius > 0 && Number.isFinite(radius)) || incident.length !== 2 || incident[0][0] === incident[1][0]) return undefined;
  const [one, two] = incident, raw1 = networkCubic(net, one[0]), raw2 = networkCubic(net, two[0]); if (!raw1 || !raw2) return undefined;
  const c1 = one[1] ? raw1 : reverseCubic(raw1), c2 = two[1] ? raw2 : reverseCubic(raw2), u1 = cubicStartDirection(c1), u2 = cubicStartDirection(c2);
  if (!u1 || !u2) return undefined;
  const theta = angle(dot(u1, u2)); if (theta < 1e-6 || Math.PI - theta < 1e-6) return undefined;
  const l1 = cubicLength(c1), l2 = cubicLength(c2); if (!(l1 > 1e-9 && l2 > 1e-9 && Number.isFinite(l1) && Number.isFinite(l2))) return undefined;
  const distance = Math.min(radius / Math.tan(theta / 2), Math.min(l1, l2) / 2), a = trim(c1, distance, l1), b = trim(c2, distance, l2);
  const turn = angle(-dot(a.back, b.back)), chord = Math.hypot(b.point.x - a.point.x, b.point.y - a.point.y);
  const k = turn < 1e-9 ? chord / 3 : 4 / 3 * Math.tan(turn / 4) * chord / (2 * Math.sin(turn / 2));
  if (![k, a.point.x, a.point.y, b.point.x, b.point.y].every(Number.isFinite)) return undefined;
  return { vertex, one, two, a: a.point, b: b.point, ta: [a.back.x * k, a.back.y * k], tb: [b.back.x * k, b.back.y * k], cut1: one[1] ? a.t : 1 - a.t, cut2: two[1] ? b.t : 1 - b.t };
}
const cache = new WeakMap<VectorNetwork, VectorNetwork | null>();
/** Native rounded geometry; the authored network remains untouched. */
export function roundedNetwork(net: VectorNetwork): VectorNetwork | undefined {
  const prior = cache.get(net); if (prior !== undefined) return prior ?? undefined;
  if (!net.vertices.some(v => v.radius > 0)) { if (Object.isFrozen(net)) cache.set(net, null); return undefined; }
  const incident: End[][] = net.vertices.map(() => []);
  net.segments.forEach((s, i) => { incident[s.a]?.push([i, true]); incident[s.b]?.push([i, false]); });
  const corners: Corner[] = [];
  net.vertices.forEach((_, i) => { const c = corner(net, i, incident[i]); if (c) corners.push(c); });
  const vertices = net.vertices.map(v => ({ ...v, radius: 0 })), segments = net.segments.map(s => ({ ...s })), cuts = segments.map(() => [0, 1]);
  for (const c of corners) for (const [end, t] of [[c.one, c.cut1], [c.two, c.cut2]] as const) cuts[end[0]][end[1] ? 0 : 1] = t;
  cuts.forEach(([a, b], i) => {
    const original = networkCubic(net, i); if (!original || isStraightCubic(original) || a === 0 && b === 1) return;
    const c = cubicPart(original, a, b); segments[i].ta = [c[1].x - c[0].x, c[1].y - c[0].y]; segments[i].tb = [c[2].x - c[3].x, c[2].y - c[3].y];
  });
  const arcs = new Map<number, number>();
  for (const c of corners) {
    vertices[c.vertex] = { ...vertices[c.vertex], ...c.a }; const next = vertices.length; vertices.push(vectorVertex(c.b.x, c.b.y));
    const segment = segments[c.two[0]]; if (c.two[1]) segment.a = next; else segment.b = next;
    arcs.set(c.vertex, segments.length); segments.push({ a: c.vertex, b: next, ta: c.ta, tb: c.tb });
  }
  const regions = net.regions.map(r => ({ ...r, loops: r.loops.map(loop => {
    if (!loop.length) return loop;
    const first = net.segments[loop[0]], second = net.segments[loop[1]], rebuilt: number[] = [];
    let current = first ? second && (first.a === second.a || first.a === second.b) ? first.b : first.a : 0;
    for (const i of loop) { rebuilt.push(i); const s = net.segments[i]; if (!s) continue; current = s.a === current ? s.b : s.a; const arc = arcs.get(current); if (arc !== undefined) rebuilt.push(arc); }
    return rebuilt;
  }) }));
  const result = freezeNetwork({ vertices, segments, regions }); if (Object.isFrozen(net)) cache.set(net, result); return result;
}
