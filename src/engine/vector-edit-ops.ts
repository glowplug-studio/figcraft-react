import { multiply, type Affine } from "./affine";
import { splitCubic } from "./cubic";
import type { Point } from "./geometry";
import { freezeNetwork, networkCubic, networkIncident, networkMirroring, sanitiseNetwork, vectorVertex, type HandleMirroring, type VectorNetwork, type VectorRegion, type VectorSegment, type VectorVertex } from "./vector-network";
import { vectorLoopWalk } from "./vector-path";

export type VectorHandle = readonly [segment: number, start: boolean];
type Handle = readonly [number, number];
const zero: Handle = [0, 0];
const finite = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const length = (h: Handle): number => Math.hypot(h[0], h[1]);
const straight = (s: VectorSegment): boolean => [...s.ta, ...s.tb].every(x => x === 0);
const indices = (values: readonly number[], count: number): number[] => [...new Set(values.filter(i => Number.isInteger(i) && i >= 0 && i < count))].sort((a, b) => a - b);
const sameHandle = (a: Handle, b: Handle): boolean => a[0] === b[0] && a[1] === b[1];

/** Private copy-on-write editing; previously published networks and their caches never mutate. */
class NetworkDraft implements VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  regions: VectorRegion[];
  changed = false;
  constructor(readonly source: VectorNetwork) {
    this.vertices = [...source.vertices]; this.segments = [...source.segments]; this.regions = [...source.regions];
  }
  vertex(i: number, next: VectorVertex): void {
    const prev = this.vertices[i]; if (!prev) return;
    if (prev.x === next.x && prev.y === next.y && prev.radius === next.radius && prev.mirror === next.mirror && prev.cap === next.cap && prev.join === next.join) return;
    if (!finite(next)) throw new Error("Vector points must remain finite");
    this.vertices[i] = next; this.changed = true;
  }
  segment(i: number, next: VectorSegment): void {
    const prev = this.segments[i]; if (!prev) return;
    if (prev.a === next.a && prev.b === next.b && sameHandle(prev.ta, next.ta) && sameHandle(prev.tb, next.tb)) return;
    if (![...next.ta, ...next.tb].every(Number.isFinite)) throw new Error("Vector handles must remain finite");
    this.segments[i] = next; this.changed = true;
  }
  handle(i: number, start: boolean): Handle | undefined { const s = this.segments[i]; return s ? start ? s.ta : s.tb : undefined; }
  putHandle(i: number, start: boolean, h: Handle): void { const s = this.segments[i]; if (s) this.segment(i, { ...s, [start ? "ta" : "tb"]: h }); }
  paintFrames(m: Affine): void {
    this.regions = this.regions.map(r => {
      if (!r.paintSpace) return r;
      const transform = multiply(m, r.paintSpace.transform);
      if (transform.every((x, i) => x === r.paintSpace!.transform[i])) return r;
      this.changed = true; return { ...r, paintSpace: { ...r.paintSpace, transform } };
    });
  }
  finish(): VectorNetwork { return this.changed ? freezeNetwork(this) : this.source; }
}

export function moveVertices(net: VectorNetwork, values: readonly number[], delta: Point): VectorNetwork {
  if (!finite(delta)) return net;
  const d = new NetworkDraft(net), selected = indices(values, net.vertices.length);
  for (const i of selected) { const v = d.vertices[i]; d.vertex(i, { ...v, x: v.x + delta.x, y: v.y + delta.y }); }
  if (selected.length === net.vertices.length) d.paintFrames([1, 0, 0, 1, delta.x, delta.y]);
  return d.finish();
}

export function transformVertices(net: VectorNetwork, values: readonly number[], m: Affine): VectorNetwork {
  const selected = new Set(indices(values, net.vertices.length)), d = new NetworkDraft(net);
  const points = [...selected].map(i => ({ i, x: m[0] * net.vertices[i].x + m[2] * net.vertices[i].y + m[4], y: m[1] * net.vertices[i].x + m[3] * net.vertices[i].y + m[5] }));
  const handles: { i: number; start: boolean; h: Handle }[] = [];
  net.segments.forEach((s, i) => { for (const start of [true, false]) if (selected.has(start ? s.a : s.b)) {
    const h = start ? s.ta : s.tb; handles.push({ i, start, h: [m[0] * h[0] + m[2] * h[1], m[1] * h[0] + m[3] * h[1]] });
  } });
  if (!points.every(finite) || handles.some(x => !x.h.every(Number.isFinite))) return net;
  for (const { i, x, y } of points) d.vertex(i, { ...d.vertices[i], x, y });
  for (const { i, start, h } of handles) d.putHandle(i, start, h);
  if (selected.size === net.vertices.length) d.paintFrames(m);
  return d.finish();
}

function putHandle(d: NetworkDraft, segment: number, start: boolean, rel: Handle, independent: boolean): void {
  if (!rel.every(Number.isFinite)) return;
  const s = d.segments[segment]; if (!s) return;
  const vi = start ? s.a : s.b, mode = independent ? "none" : networkMirroring(d, vi);
  d.putHandle(segment, start, rel);
  if (independent) { const v = d.vertices[vi]; if (v) d.vertex(vi, { ...v, mirror: "none" }); return; }
  const others = networkIncident(d, vi).filter(([i, st]) => i !== segment || st !== start);
  if (others.length !== 1 || mode === "none") return;
  const [oi, os] = others[0];
  if (mode === "angleAndLength") d.putHandle(oi, os, [-rel[0], -rel[1]]);
  else {
    const size = length(rel); if (size < 1e-9) return;
    const old = length(d.handle(oi, os) ?? zero), factor = -(old > 1e-9 ? old : size) / size;
    d.putHandle(oi, os, [rel[0] * factor, rel[1] * factor]);
  }
}
export function setHandle(net: VectorNetwork, segment: number, start: boolean, rel: Handle, independent = false): VectorNetwork {
  const d = new NetworkDraft(net); putHandle(d, segment, start, rel, independent); return d.finish();
}
export function moveHandles(net: VectorNetwork, handles: readonly VectorHandle[], delta: Point, independent = false): VectorNetwork {
  const d = new NetworkDraft(net), from = handles.map(([i, st]) => d.handle(i, st));
  handles.forEach(([i, st], n) => { const h = from[n]; if (h) putHandle(d, i, st, [h[0] + delta.x, h[1] + delta.y], independent); });
  return d.finish();
}
export function setMirroring(net: VectorNetwork, values: readonly number[], mode: HandleMirroring): VectorNetwork {
  const d = new NetworkDraft(net);
  for (const vi of values) {
    const inc = networkIncident(d, vi);
    if (inc.length === 2 && mode !== "none") {
      const [first, second] = inc, h1 = d.handle(...first)!, h2 = d.handle(...second)!, l1 = length(h1), l2 = length(h2);
      const leadFirst = l1 >= l2, lead = leadFirst ? h1 : h2, size = length(lead);
      if (size > 1e-9) {
        const other = mode === "angleAndLength" ? (l1 + l2) / 2 : leadFirst ? l2 : l1;
        const leadLength = mode === "angleAndLength" ? other : size, otherLength = other > 1e-9 ? other : leadLength;
        const a: Handle = [lead[0] / size * leadLength, lead[1] / size * leadLength], b: Handle = [-lead[0] / size * otherLength, -lead[1] / size * otherLength];
        d.putHandle(...first, leadFirst ? a : b); d.putHandle(...second, leadFirst ? b : a);
      }
    }
    const v = d.vertices[vi]; if (v) d.vertex(vi, { ...v, mirror: mode });
  }
  return d.finish();
}
function away(net: VectorNetwork, segment: number, start: boolean): Point | undefined {
  const c = networkCubic(net, segment); if (!c) return undefined;
  const sign = start ? 1 : -1, x = (c[3].x - c[0].x) * sign, y = (c[3].y - c[0].y) * sign, size = Math.hypot(x, y);
  return size > 1e-9 ? { x: x / size, y: y / size } : undefined;
}
export function makeSmooth(net: VectorNetwork, vi: number, delta: Point): VectorNetwork {
  if (!finite(delta) || Math.hypot(delta.x, delta.y) < 1e-9) return net;
  const d = new NetworkDraft(net), scored = networkIncident(net, vi).map(([i, start]) => {
    const dir = away(net, i, start); return { i, start, score: dir ? dir.x * delta.x + dir.y * delta.y : 0 };
  });
  if (!scored.length) return net;
  const handle: Handle = [delta.x, delta.y], opposite: Handle = [-delta.x, -delta.y];
  if (scored.length === 1) { const h = scored[0]; d.putHandle(h.i, h.start, h.score >= 0 ? handle : opposite); }
  else {
    // Rust max_by keeps the last tie; min_by keeps the first.
    const forward = scored.reduce((a, b) => b.score >= a.score ? b : a), rest = scored.filter(x => x !== forward);
    const back = rest.reduce((a, b) => b.score < a.score ? b : a);
    d.putHandle(forward.i, forward.start, handle); d.putHandle(back.i, back.start, opposite);
  }
  const v = d.vertices[vi]; if (v) d.vertex(vi, { ...v, mirror: "angle" });
  return d.finish();
}
export function smoothVertices(net: VectorNetwork, values: readonly number[], smooth = true): VectorNetwork {
  const d = new NetworkDraft(net);
  for (const vi of values) {
    const inc = networkIncident(d, vi), v = d.vertices[vi]; if (!v) continue;
    if (!smooth) {
      for (const h of inc) d.putHandle(...h, zero);
      const { mirror: _mirror, ...sharp } = v; d.vertex(vi, sharp); continue;
    }
    if (inc.length !== 2) continue;
    const neighbours = inc.map(([i, st]) => d.vertices[st ? d.segments[i].b : d.segments[i].a]), [a, b] = neighbours;
    if (!a || !b) continue;
    const x = a.x - b.x, y = a.y - b.y, size = Math.hypot(x, y); if (size < 1e-9) continue;
    const l1 = Math.hypot(a.x - v.x, a.y - v.y) / 3, l2 = Math.hypot(b.x - v.x, b.y - v.y) / 3;
    d.putHandle(...inc[0], [x / size * l1, y / size * l1]); d.putHandle(...inc[1], [-x / size * l2, -y / size * l2]);
    d.vertex(vi, { ...v, mirror: "angle" });
  }
  return d.finish();
}
export function bendSegment(net: VectorNetwork, segment: number, t: number, point: Point): VectorNetwork {
  const s = net.segments[segment], a = s && net.vertices[s.a], b = s && net.vertices[s.b];
  if (!a || !b || !Number.isFinite(t) || !finite(point)) return net;
  t = Math.max(.05, Math.min(.95, t)); const k = 3 * t * (1 - t), dx = b.x - a.x, dy = b.y - a.y;
  const x = (point.x - (a.x * (1 - t) + b.x * t)) / k, y = (point.y - (a.y * (1 - t) + b.y * t)) / k;
  const d = new NetworkDraft(net); d.putHandle(segment, true, [dx / 3 + x, dy / 3 + y]); d.putHandle(segment, false, [-dx / 3 + x, -dy / 3 + y]); return d.finish();
}
export function splitSegment(net: VectorNetwork, segment: number, t: number): { network: VectorNetwork; vertex: number } | undefined {
  const s = net.segments[segment], cubic = networkCubic(net, segment); if (!s || !cubic) return undefined;
  t = Number.isFinite(t) ? Math.max(.01, Math.min(.99, t)) : .5;
  const [l, r] = splitCubic(cubic, t), d = new NetworkDraft(net), mid = d.vertices.length, next = d.segments.length, line = straight(s);
  const handle = (a: Point, b: Point): Handle => [a.x - b.x, a.y - b.y];
  d.vertices.push({ ...vectorVertex(l[3].x, l[3].y), ...(!line ? { mirror: "angle" as const } : {}) });
  d.segment(segment, { ...s, b: mid, ta: line ? zero : handle(l[1], l[0]), tb: line ? zero : handle(l[2], l[3]) });
  d.segments.push({ a: mid, b: s.b, ta: line ? zero : handle(r[1], r[0]), tb: line ? zero : handle(r[2], r[3]) });
  d.regions = net.regions.map(region => ({ ...region, loops: region.loops.map(loop => {
    const position = loop.indexOf(segment); if (position < 0) return loop;
    const reverse = vectorLoopWalk(net, loop).find(([i]) => i === segment)?.[1] ?? false;
    const out = [...loop]; out.splice(position + (reverse ? 0 : 1), 0, next); return out;
  }) }));
  d.changed = true; return { network: d.finish(), vertex: mid };
}

function removeVertexIndex(d: NetworkDraft, vi: number): void {
  if (!d.vertices[vi]) return;
  d.vertices.splice(vi, 1); d.segments = d.segments.map(s => ({ ...s, a: s.a > vi ? s.a - 1 : s.a, b: s.b > vi ? s.b - 1 : s.b })); d.changed = true;
}
function removeSegmentsOnly(d: NetworkDraft, values: readonly number[]): void {
  const removed = new Set(indices(values, d.segments.length)), map: (number | undefined)[] = [], kept: VectorSegment[] = [];
  d.segments.forEach((s, i) => { if (!removed.has(i)) { map[i] = kept.length; kept.push(s); } });
  d.segments = kept;
  d.regions = d.regions.flatMap(r => {
    const loops = r.loops.map(loop => loop.flatMap(i => map[i] === undefined ? [] : [map[i]!])).filter(l => l.length >= 2);
    if (!loops.length || loops.length !== r.loops.length || loops.some((l, i) => l.length !== r.loops[i].length || l.some((x, j) => x !== r.loops[i][j]))) d.changed = true;
    return loops.length ? [{ ...r, loops }] : [];
  });
  if (removed.size) d.changed = true;
}
function reopenLoops(d: NetworkDraft): void {
  const shares = (x: number, y: number): boolean => { const a = d.segments[x], b = d.segments[y]; return Boolean(a && b && (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b)); };
  d.regions = d.regions.map(r => ({ ...r, loops: r.loops.map(loop => {
    if (loop.length < 2) return loop;
    const at = loop.findIndex((s, i) => !shares(loop[(i + loop.length - 1) % loop.length], s));
    if (at <= 0) return loop;
    d.changed = true; return [...loop.slice(at), ...loop.slice(0, at)];
  }) }));
}
export function removeSegments(net: VectorNetwork, values: readonly number[]): VectorNetwork {
  const d = new NetworkDraft(net), touched = indices(values.flatMap(i => net.segments[i] ? [net.segments[i].a, net.segments[i].b] : []), net.vertices.length);
  removeSegmentsOnly(d, values);
  for (const vi of touched.reverse()) if (!networkIncident(d, vi).length) removeVertexIndex(d, vi);
  reopenLoops(d); return d.finish();
}
function healHandles(net: VectorNetwork, vi: number, o1: readonly [number, Handle], o2: readonly [number, Handle]): readonly [Handle, Handle] | undefined {
  const p = net.vertices[vi], a = net.vertices[o1[0]], b = net.vertices[o2[0]]; if (!p || !a || !b) return undefined;
  const direction = (h: Handle, from: Point): Handle | undefined => { const d: Handle = length(h) > 1e-9 ? h : [p.x - from.x, p.y - from.y], size = length(d); return size > 1e-9 ? [d[0] / size, d[1] / size] : undefined; };
  const d1 = direction(o1[1], a), d2 = direction(o2[1], b); if (!d1 || !d2) return undefined;
  const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(p.x - b.x, p.y - b.y), t = la / Math.max(la + lb, 1e-12), u = 1 - t;
  const k1 = 3 * u * u * t, k2 = 3 * u * t * t, ba = u ** 3 + k1, bb = k2 + t ** 3;
  const rx = p.x - a.x * ba - b.x * bb, ry = p.y - a.y * ba - b.y * bb;
  const x1 = d1[0] * k1, y1 = d1[1] * k1, x2 = d2[0] * k2, y2 = d2[1] * k2, det = x1 * y2 - y1 * x2;
  let l1: number, l2: number;
  if (Math.abs(det) > 1e-9 * Math.hypot(x1, y1) * Math.hypot(x2, y2)) { l1 = (rx * y2 - ry * x2) / det; l2 = (x1 * ry - y1 * rx) / det; }
  else { const x = x1 + x2, y = y1 + y2; l1 = l2 = (rx * x + ry * y) / Math.max(x * x + y * y, 1e-12); }
  return Number.isFinite(l1) && Number.isFinite(l2) && l1 > 0 && l2 > 0 ? [[d1[0] * l1, d1[1] * l1], [d2[0] * l2, d2[1] * l2]] : undefined;
}
export function deleteVertices(net: VectorNetwork, values: readonly number[], heal = false): VectorNetwork {
  const d = new NetworkDraft(net);
  for (const vi of indices(values, net.vertices.length).reverse()) {
    const touching = networkIncident(d, vi).map(([i]) => i); let healed: VectorSegment | undefined;
    if (heal && touching.length === 2) {
      const [x, y] = touching.map(i => d.segments[i]);
      const o1: readonly [number, Handle] = x.a === vi ? [x.b, x.tb] : [x.a, x.ta], o2: readonly [number, Handle] = y.a === vi ? [y.b, y.tb] : [y.a, y.ta];
      if (o1[0] !== o2[0]) {
        const [ta, tb] = !straight(x) || !straight(y) ? healHandles(d, vi, o1, o2) ?? [o1[1], o2[1]] : [o1[1], o2[1]];
        healed = { a: o1[0], b: o2[0], ta, tb };
      }
    }
    const gone = new Set(touching), map: (number | undefined)[] = [], kept: VectorSegment[] = [];
    d.segments.forEach((s, i) => { if (!gone.has(i)) { map[i] = kept.length; kept.push(s); } });
    const healedIndex = healed ? kept.length : undefined; if (healed) kept.push(healed); d.segments = kept;
    d.regions = d.regions.flatMap(r => {
      const loops = r.loops.map(loop => { let inserted = false; return loop.flatMap(i => {
        if (map[i] !== undefined) return [map[i]!];
        if (healedIndex === undefined || inserted) return []; inserted = true; return [healedIndex];
      }); }).filter(loop => loop.length >= 2);
      return loops.length ? [{ ...r, loops }] : [];
    });
    removeVertexIndex(d, vi);
  }
  const clean = sanitiseNetwork(d);
  if (clean.segments.length !== d.segments.length || clean.regions.some((r, i) => r.loops.length !== d.regions[i].loops.length)) d.changed = true;
  d.segments = [...clean.segments]; d.regions = [...clean.regions]; reopenLoops(d); return d.finish();
}

/** Dropping one point onto another keeps the destination's coordinates and styles. */
export function mergeVertices(net: VectorNetwork, keep: number, drop: number): VectorNetwork {
  if (keep === drop || !net.vertices[keep] || !net.vertices[drop]) return net;
  const d = new NetworkDraft(net);
  d.segments = d.segments.map(s => ({ ...s, a: s.a === drop ? keep : s.a, b: s.b === drop ? keep : s.b }));
  removeSegmentsOnly(d, d.segments.flatMap((s, i) => s.a === s.b && straight(s) ? [i] : []));
  removeVertexIndex(d, drop); reopenLoops(d); return d.finish();
}
