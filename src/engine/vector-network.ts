import { identity, inverse, multiply, transformPoint, type Affine } from "./affine";
import type { PathCommand } from "./corners";
import type { Cubic } from "./cubic";
import type { Point } from "./geometry";
import type { SolidPaint } from "./solid-paint";
import type { StrokeCap, StrokeJoin } from "./stroke";

export type HandleMirroring = "none" | "angle" | "angleAndLength";
export interface VectorVertex extends Readonly<Point> { readonly radius: number; readonly mirror?: HandleMirroring; readonly cap?: StrokeCap; readonly join?: StrokeJoin }
export interface VectorSegment { readonly a: number; readonly b: number; readonly ta: readonly [number, number]; readonly tb: readonly [number, number] }
export interface RegionPaintSpace { readonly width: number; readonly height: number; readonly transform: Affine }
export interface VectorRegion { readonly loops: readonly (readonly number[])[]; readonly winding: "nonZero" | "evenOdd"; readonly fills?: readonly SolidPaint[]; readonly paintSpace?: RegionPaintSpace }
export interface VectorNetwork { readonly vertices: readonly VectorVertex[]; readonly segments: readonly VectorSegment[]; readonly regions: readonly VectorRegion[] }
export const vectorVertex = (x: number, y: number): VectorVertex => ({ x, y, radius: 0 });
export const vectorLine = (a: number, b: number): VectorSegment => ({ a, b, ta: [0, 0], tb: [0, 0] });
export function freezeNetwork(net: VectorNetwork): VectorNetwork {
  return Object.freeze({ vertices: Object.freeze(net.vertices.map(v => Object.freeze({ ...v }))),
    segments: Object.freeze(net.segments.map(s => Object.freeze({ ...s, ta: Object.freeze([...s.ta]) as readonly [number, number], tb: Object.freeze([...s.tb]) as readonly [number, number] }))),
    regions: Object.freeze(net.regions.map(r => Object.freeze({ ...r, loops: Object.freeze(r.loops.map(l => Object.freeze([...l]))), ...(r.fills ? { fills: Object.freeze([...r.fills]) } : {}), ...(r.paintSpace ? { paintSpace: Object.freeze({ ...r.paintSpace, transform: Object.freeze([...r.paintSpace.transform]) as Affine }) } : {}) }))) });
}
export const emptyNetwork = (): VectorNetwork => freezeNetwork({ vertices: [], segments: [], regions: [] });
export function networkFromPoints(points: readonly Point[], closed: boolean): VectorNetwork {
  const vertices = points.map(p => vectorVertex(p.x, p.y)), segments = points.slice(1).map((_, i) => vectorLine(i, i + 1)), regions: VectorRegion[] = [];
  if (closed && points.length > 2) { segments.push(vectorLine(points.length - 1, 0)); regions.push({ loops: [segments.map((_, i) => i)], winding: "nonZero" }); }
  return freezeNetwork({ vertices, segments, regions });
}
/** Close duplicate endpoints without scanning earlier subpaths. Quadratics are normalised to cubics by the SVG reader. */
export function networkFromPath(path: readonly PathCommand[]): VectorNetwork {
  const vertices: VectorVertex[] = [], segments: VectorSegment[] = [], loops: number[][] = []; let active: number[] = [], first: number | undefined, current: number | undefined;
  const push = (x: number, y: number) => { vertices.push(vectorVertex(x, y)); return vertices.length - 1; };
  const mergeEnd = (a: number, b: number) => { const i = active.at(-1); if (i !== undefined && segments[i].b === a) segments[i] = { ...segments[i], b }; if (a + 1 === vertices.length) vertices.pop(); };
  const closeOpen = () => {
    if (current === undefined || first === undefined || current === first || active.length < 2 || current + 1 !== vertices.length) return;
    const a = vertices[current], b = vertices[first]; if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) return;
    mergeEnd(current, first); loops.push(active); active = [];
  };
  for (const c of path) {
    if (c[0] === "M") { closeOpen(); active = []; first = current = push(c[1], c[2]); }
    else if (c[0] === "Z") {
      if (current === undefined || first === undefined) continue;
      const a = vertices[current], b = vertices[first];
      if (current !== first) {
        if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) mergeEnd(current, first);
        else { segments.push(vectorLine(current, first)); active.push(segments.length - 1); }
      }
      if (active.length) { loops.push(active); active = []; } current = first;
    } else {
      if (current === undefined) continue;
      const a = vertices[current], end = c[0] === "C" ? [c[5], c[6]] : [c[1], c[2]], b = push(end[0], end[1]);
      segments.push(c[0] === "C" ? { a: current, b, ta: [c[1] - a.x, c[2] - a.y], tb: [c[3] - end[0], c[4] - end[1]] } : vectorLine(current, b));
      active.push(segments.length - 1); current = b;
    }
  }
  closeOpen(); return freezeNetwork({ vertices, segments, regions: loops.length ? [{ loops, winding: "nonZero" }] : [] });
}
export function networkCubic(net: VectorNetwork, index: number): Cubic | undefined {
  const s = net.segments[index]; if (!s) return undefined;
  const a = net.vertices[s.a], b = net.vertices[s.b]; if (!a || !b) return undefined;
  return [a, { x: a.x + s.ta[0], y: a.y + s.ta[1] }, { x: b.x + s.tb[0], y: b.y + s.tb[1] }, b];
}
export function networkIncident(net: VectorNetwork, v: number): readonly (readonly [number, boolean])[] {
  const out: [number, boolean][] = []; net.segments.forEach((s, i) => { if (s.a === v) out.push([i, true]); else if (s.b === v) out.push([i, false]); }); return out;
}
export function networkMirroring(net: VectorNetwork, v: number): HandleMirroring {
  if (net.vertices[v]?.mirror) return net.vertices[v].mirror;
  const inc = networkIncident(net, v); if (inc.length !== 2) return "none";
  const handles = inc.map(([i, start]) => start ? net.segments[i].ta : net.segments[i].tb), [a, b] = handles, l1 = Math.hypot(...a), l2 = Math.hypot(...b);
  if (l1 < 1e-9 || l2 < 1e-9 || Math.abs((a[0] * b[1] - a[1] * b[0]) / (l1 * l2)) > 1e-3 || (a[0] * b[0] + a[1] * b[1]) / (l1 * l2) > -.999) return "none";
  return Math.abs(l1 - l2) <= 1e-6 * Math.max(l1, l2, 1) ? "angleAndLength" : "angle";
}
/** Invalid segment references remove only affected loops, retaining empty regions and metadata. */
export function sanitiseNetwork(net: VectorNetwork): VectorNetwork {
  const remap = net.segments.map(() => -1), segments: VectorSegment[] = [];
  net.segments.forEach((s, i) => { if (s.a >= 0 && s.b >= 0 && s.a < net.vertices.length && s.b < net.vertices.length) { remap[i] = segments.length; segments.push(s); } });
  return freezeNetwork({ ...net, segments, regions: net.regions.map(r => ({ ...r, loops: r.loops.filter(l => l.every(i => remap[i] !== undefined && remap[i] >= 0)).map(l => l.map(i => remap[i])) })) });
}
/** Geometry transforms retain dimensionless styles and radii; uniform Scale handles radii separately. */
export function transformNetwork(net: VectorNetwork, m: Affine): VectorNetwork {
  const handle = (t: readonly [number, number]): readonly [number, number] => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1]];
  const vertices = net.vertices.map(v => ({ ...v, ...transformPoint(m, v) })), segments = net.segments.map(s => ({ ...s, ta: handle(s.ta), tb: handle(s.tb) }));
  if (segments.some(s => ![...s.ta, ...s.tb].every(Number.isFinite))) throw new Error("Vector handles must remain finite");
  return freezeNetwork({ vertices, segments, regions: net.regions.map(r => ({ ...r, ...(r.paintSpace ? { paintSpace: { ...r.paintSpace, transform: multiply(m, r.paintSpace.transform) } } : {}) })) });
}
export function regionPaintFrame(region: VectorRegion, width: number, height: number): RegionPaintSpace {
  const f = region.paintSpace;
  if (f && f.width > 0 && f.height > 0 && Number.isFinite(f.width) && Number.isFinite(f.height)) {
    try { inverse(f.transform); return f; } catch { /* Native invalid-frame fallback. */ }
  }
  return { width, height, transform: identity };
}
