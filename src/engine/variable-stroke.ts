import type { PathCommand } from "./corners";
import { ellipticalArcPath, TAU } from "./ellipse";
import type { Point } from "./geometry";
import { MAX_PATH_SAMPLES, PATH_FLATTEN_TOLERANCE, measurePath, polylineLength, type MeasuredPolyline } from "./path-measure";
import { bandCaps, capShape, dashPattern, lineDashes, type StrokeCap, type StrokeJoin, type StrokeProps } from "./stroke";
import { sanitiseWidthProfile, widthProfileSidesAt, type WidthProfile } from "./width-profile";

type Half = readonly [number, number];
interface Segment { a: Point; b: Point; ha: Half; hb: Half; d: Point; n: Point }
interface Style { join: StrokeJoin; miterLimit: number; capStart: StrokeCap; capEnd: StrokeCap }
const add = (a: Point, b: Point, k: number): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const on = (h: Half, sigma: number): number => h[sigma > 0 ? 0 : 1];
const length = (p: Point): number => Math.hypot(p.x, p.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function arc(out: Point[], centre: Point, from: Point, sweep: number, r0: number, r1: number): void {
  const r = Math.max(r0, r1); if (r <= PATH_FLATTEN_TOLERANCE || !Number.isFinite(sweep)) return;
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - PATH_FLATTEN_TOLERANCE / r))), n = Math.max(2, Math.min(64, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3))));
  const start = Math.atan2(from.y, from.x);
  for (let k = 1; k < n; k++) { const t = k / n, angle = start + sweep * t, radius = r0 + (r1 - r0) * t; out.push({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius }); }
}
function join(out: Point[], previous: Segment, current: Segment, sigma: number, style: Style): void {
  const ph = on(previous.hb, sigma), ch = on(current.ha, sigma), pe = add(previous.b, previous.n, sigma * ph), cs = add(current.a, current.n, sigma * ch);
  out.push(pe);
  const cross = previous.d.x * current.d.y - previous.d.y * current.d.x, dot = previous.d.x * current.d.x + previous.d.y * current.d.y;
  if (Math.abs(cross) < 1e-12 && dot > 0) { out.push(cs); return; }
  const outer = Math.abs(cross) < 1e-12 ? sigma < 0 : cross * sigma < 0, v = current.a;
  if (outer) {
    const theta = Math.abs(cross) < 1e-12 ? Math.PI : Math.atan2(cross, dot);
    if (style.join === "round") arc(out, v, { x: pe.x - v.x, y: pe.y - v.y }, theta, ph, ch);
    else if (style.join === "miter") {
      const half = Math.cos(theta / 2), bis = add(previous.n, current.n, 1), norm = length(bis);
      if (half > 1e-6 && 1 / half <= style.miterLimit && norm > 1e-9) out.push(add(v, bis, sigma * (ph + ch) / 2 / half / norm));
    }
  } else out.push(v);
  out.push(cs);
}
function side(segments: readonly Segment[], sigma: number, closed: boolean, style: Style): Point[] {
  const out: Point[] = [];
  segments.forEach((segment, i) => {
    const previous = i ? segments[i - 1] : closed ? segments.at(-1) : undefined;
    if (previous) join(out, previous, segment, sigma, style); else out.push(add(segment.a, segment.n, sigma * on(segment.ha, sigma)));
  });
  const last = segments.at(-1); if (!closed && last) out.push(add(last.b, last.n, sigma * on(last.hb, sigma)));
  return out;
}
function cap(out: Point[], centre: Point, direction: Point, from: number, to: number, kind: StrokeCap): void {
  const normal = { x: -direction.y, y: direction.x }, middle = add(centre, normal, (from - to) / 2), radius = (from + to) / 2;
  if (capShape(kind) === "square") out.push(add(add(middle, normal, radius), direction, radius), add(add(middle, normal, -radius), direction, radius));
  else if (capShape(kind) === "round") arc(out, middle, normal, -Math.PI, radius, radius);
}
function contour(path: PathCommand[], points: readonly Point[]): void {
  if (!points.length) return;
  points.forEach((p, i) => path.push([i === 0 ? "M" : "L", p.x, p.y])); path.push(["Z"]);
}
function outlinePiece(path: PathCommand[], points: readonly Point[], widths: readonly Half[], closed: boolean, style: Style): void {
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y); if (len <= 1e-9) continue;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }; segments.push({ a, b, ha: widths[i], hb: widths[i + 1], d, n: { x: -d.y, y: d.x } });
  }
  const first = segments[0], last = segments.at(-1);
  if (!first || !last) {
    const radius = widths[0] ? (widths[0][0] + widths[0][1]) / 2 : 0, p = points[0];
    if (p && capShape(style.capStart) === "round" && radius > 0) path.push(...ellipticalArcPath(p.x, p.y, radius, radius, 0, TAU), ["Z"]);
    return;
  }
  const left = side(segments, 1, closed, style), right = side(segments, -1, closed, style).reverse();
  if (closed) { contour(path, left); contour(path, right); return; }
  cap(left, last.b, last.d, last.hb[0], last.hb[1], style.capEnd);
  for (const point of right) left.push(point);
  cap(left, first.a, { x: -first.d.x, y: -first.d.y }, first.ha[1], first.ha[0], style.capStart); contour(path, left);
}
function dashedPieces(points: readonly Point[], widths: readonly Half[], pattern: readonly number[], offset: number): { points: Point[]; widths: Half[] }[] {
  const out: { points: Point[]; widths: Half[] }[] = []; if (!pattern.length) return out;
  let index = 0, left = Math.max(0, pattern[0] - offset), on = true;
  let current = { points: points.slice(0, 1), widths: widths.slice(0, 1) };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], ha = widths[i], hb = widths[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y); let used = 0;
    while (len - used > left) {
      used += left; const t = len > 0 ? used / len : 0, p = mix(a, b, t), h: Half = [ha[0] + (hb[0] - ha[0]) * t, ha[1] + (hb[1] - ha[1]) * t];
      if (on) { current.points.push(p); current.widths.push(h); out.push(current); current = { points: [], widths: [] }; if (out.length >= 20_000) return out; }
      else current = { points: [p], widths: [h] };
      on = !on; index = (index + 1) % pattern.length; left = pattern[index];
    }
    left -= len - used; if (on) { current.points.push(b); current.widths.push(hb); }
  }
  if (on && current.points.length) out.push(current); return out;
}
function resample(line: MeasuredPolyline, budget: number): { points: Point[]; lengths: number[] } | undefined {
  const step = polylineLength(line) / 128, points: Point[] = [], lengths: number[] = [];
  for (let i = 0; i < line.points.length; i++) {
    const p = line.points[i], s = line.lengths[i] ?? 0, previous = points.at(-1), last = lengths.at(-1);
    if (previous && last !== undefined) {
      const count = Math.max(1, Math.min(MAX_PATH_SAMPLES, Math.ceil((s - last) / step)));
      if (points.length + count > budget) return undefined;
      for (let k = 1; k < count; k++) { points.push(mix(previous, p, k / count)); lengths.push(last + (s - last) * k / count); }
    }
    points.push(p); lengths.push(s); if (points.length > budget) return undefined;
  }
  return { points, lengths };
}
/** Native width::variable_outline; undefined requests the caller's uniform fallback. */
export function variableStrokeOutline(path: readonly PathCommand[], width: number, props: StrokeProps, rawProfile: WidthProfile): readonly PathCommand[] | undefined {
  if (!Number.isFinite(width) || width <= 0) return [];
  const profile = sanitiseWidthProfile(rawProfile), lines = measurePath(path); if (!lines) return undefined;
  const [capStart, capEnd] = bandCaps(props), style: Style = { join: props.join, miterLimit: Math.max(1, Math.min(100, props.miterLimit)), capStart, capEnd };
  const pattern = dashPattern(props.dashes), result: PathCommand[] = []; let budget = MAX_PATH_SAMPLES;
  for (const line of lines) {
    const len = polylineLength(line); if (len <= 1e-9) continue;
    const samples = resample(line, budget); if (!samples) return undefined; budget -= samples.points.length;
    const widths = samples.lengths.map((s): Half => { const [left, right] = widthProfileSidesAt(profile, s / len); return [.5 * width * right, .5 * width * left]; });
    if (pattern && len / pattern.reduce((a, b) => a + b, 0) * pattern.length < 20_000) {
      const fitted = lineDashes(len, line.closed, pattern);
      for (const piece of dashedPieces(samples.points, widths, fitted.pattern, fitted.offset)) outlinePiece(result, piece.points, piece.widths, false, style);
    } else outlinePiece(result, samples.points, widths, line.closed, style);
  }
  return result;
}
