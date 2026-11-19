// Native crates/pathops/src/round.rs (upstream #2222): a corner radius on a closed path. Every vertex that is still
// sharp rounds with a circular arc, convex and concave alike, the way a boolean group draws its result.
// Independent TypeScript.
import type { PathCommand } from "./corners";
import { cubicLength, cubicLengthParameter, type Cubic } from "./cubic";
import { derivCubic, evalCubic, subsegment } from "./fit-cubic-source";
import type { Point } from "./geometry";
import { smoothedCornerCurves } from "./polygon";
import { pathBounds } from "./vector-path";

/** The smallest turn (radians) that counts as a corner: a sweep can tilt a short piece by more than its accuracy. */
const sharpTurn = 1e-3;
/** Accuracy of arc length measurements. */
const accuracy = 1e-6;

type Segment = { readonly line: true; a: Point; b: Point } | { readonly line: false; c: Cubic };
/** One rounded corner: its curves, and where its cuts sit on the incoming and outgoing segments. */
interface Corner { readonly curves: readonly Cubic[]; readonly tIn: number; readonly tOut: number }

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const hypot = (p: Point): number => Math.hypot(p.x, p.y);
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));
const finitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const finitePath = (path: readonly PathCommand[]): boolean => path.every(c => c.slice(1).every(v => Number.isFinite(v as number)));

const start = (s: Segment): Point => s.line ? s.a : s.c[0];
const end = (s: Segment): Point => s.line ? s.b : s.c[3];
/** As a cubic: a line gets its handles at the thirds. */
const cubic = (s: Segment): Cubic => s.line ? [s.a, lerp(s.a, s.b, 1 / 3), lerp(s.a, s.b, 2 / 3), s.b] : s.c;
const length = (s: Segment): number => s.line ? hypot(sub(s.b, s.a)) : cubicLength(s.c, 1, accuracy);
/** The length of the control polygon: cheap, and zero only for a point. */
function span(s: Segment): number { const c = cubic(s); return hypot(sub(c[1], c[0])) + hypot(sub(c[2], c[1])) + hypot(sub(c[3], c[2])); }
/** The cubic leaving the start of the segment, or leaving its end. */
function outward(s: Segment, fromStart: boolean): Cubic { const c = cubic(s); return fromStart ? c : [c[3], c[2], c[1], c[0]]; }
/** Unit direction in which a cubic leaves its start, skipping coincident handles. */
function startDirection(c: Cubic): Point | undefined {
  for (let i = 1; i < 4; i++) { const d = sub(c[i], c[0]), l = hypot(d); if (l > 1e-9) return { x: d.x / l, y: d.y / l }; }
}
/** The point `t` along `c` from its start, the unit direction back toward the start there, and the parameter reached. */
function trim(c: Cubic, t: number, line: boolean, len: number): { point: Point; back: Point; at: number } | undefined {
  if (line) {
    if (!Number.isFinite(len) || len <= 0) return;
    const u = { x: (c[3].x - c[0].x) / len, y: (c[3].y - c[0].y) / len };
    return { point: { x: c[0].x + u.x * t, y: c[0].y + u.y * t }, back: { x: -u.x, y: -u.y }, at: t / len };
  }
  // The segment's measured length is reused, so a corner that takes all of it reaches the end exactly: measuring
  // the reversed curve again can differ in the last places and leave a sliver.
  // A cut within the measuring accuracy of the far end is the far end: two mirrored curves of one true length
  // measure a hair apart here, where native measures them equal and the corner takes both whole.
  const k = t >= len - accuracy ? 1 : clamp(cubicLengthParameter(c, t, len), 0, 1), d = derivCubic(c, k), l = hypot(d);
  const leaving = l > 1e-9 ? { x: d.x / l, y: d.y / l } : startDirection(c);
  if (!leaving) return;
  return { point: evalCubic(c, k), back: { x: -leaving.x, y: -leaving.y }, at: k };
}

/** The segments of one subpath, with its closing line when the path does not end on its start. */
function segmentsOf(path: readonly PathCommand[]): Segment[] {
  const out: Segment[] = []; let pen: Point | undefined, first: Point | undefined;
  for (const c of path) {
    if (c[0] === "M") pen = first = { x: c[1], y: c[2] };
    else if (c[0] === "L" && pen) { const to = { x: c[1], y: c[2] }; out.push({ line: true, a: pen, b: to }); pen = to; }
    else if (c[0] === "C" && pen) { const to = { x: c[5], y: c[6] }; out.push({ line: false, c: [pen, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, to] }); pen = to; }
    else if (c[0] === "Z" && pen && first) { if (pen.x !== first.x || pen.y !== first.y) out.push({ line: true, a: pen, b: first }); pen = first; }
  }
  return out;
}
/** Two lines A-B and B-C become A-C when B lies within `weld` of that line and between A and C. Cyclic. */
function mergeRuns(segments: Segment[], weld: number): Segment[] {
  const mergeable = (a: Segment, b: Segment): boolean => {
    if (!a.line || !b.line) return false;
    const d = sub(b.b, a.a), e = sub(a.b, a.a), l = hypot(d);
    return l > 1e-12 && Math.abs((d.x * e.y - d.y * e.x) / l) <= weld && dot(e, sub(b.b, a.b)) > 0;
  };
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged.at(-1);
    if (last && mergeable(last, s)) merged[merged.length - 1] = { line: true, a: start(last), b: end(s) };
    else merged.push(s);
  }
  while (merged.length > 2) {
    const first = merged[0], last = merged[merged.length - 1];
    if (!mergeable(last, first)) break;
    merged[0] = { line: true, a: start(last), b: end(first) };
    merged.pop();
  }
  return merged;
}
/** A closed subpath without a sweep's noise: pieces shorter than `weld` dropped, each segment starting where the one
 * before ends, and straight runs merged into one line. */
function clean(path: readonly PathCommand[], weld: number): Segment[] {
  const kept = segmentsOf(path).filter(s => span(s) >= weld), n = kept.length;
  for (let i = 0; i < n; i++) {
    const previous = end(kept[(i + n - 1) % n]), s = kept[i];
    kept[i] = s.line ? { line: true, a: previous, b: s.b } : { line: false, c: [previous, s.c[1], s.c[2], s.c[3]] };
  }
  return mergeRuns(kept, weld);
}

function roundSubpath(path: readonly PathCommand[], radius: number, smoothing: number, weld: number): PathCommand[] | undefined {
  const segments = clean(path, weld), n = segments.length;
  if (n < 2) return;
  // Per vertex: the angle between its segments (pi is straight on) and the length a corner there wants along each.
  const wants = segments.map((b, i): readonly [number, number] | undefined => {
    const a = segments[(i + n - 1) % n], u1 = startDirection(outward(a, false)), u2 = startDirection(outward(b, true));
    if (!u1 || !u2) return;
    const angle = Math.acos(clamp(dot(u1, u2), -1, 1));
    if (angle < 1e-6 || Math.PI - angle < sharpTurn) return;
    const t = radius / Math.tan(angle / 2), want = a.line && b.line ? (1 + smoothing) * t : t;
    return Number.isFinite(want) ? [angle, want] : undefined;
  });
  const want = (i: number): number => wants[i % n]?.[1] ?? 0;
  // Lengths are measured only for segments with a corner at one end.
  const lengths = segments.map((s, i) => wants[i] || wants[(i + 1) % n] ? length(s) : undefined);
  // What a corner may use of a segment: half of it, or what the corner at its other end leaves.
  const room = (len: number, other: number): number => Math.max(len / 2, len - other);
  const corner = (i: number): Corner | undefined => {
    const wanted = wants[i]; if (!wanted) return;
    const previous = (i + n - 1) % n, a = segments[previous], b = segments[i], la = lengths[previous], lb = lengths[i];
    if (la === undefined || lb === undefined) return;
    const space = Math.min(room(la, want(previous)), room(lb, want(i + 1)));
    if (!Number.isFinite(space) || space <= weld) return;
    const c1 = outward(a, false), c2 = outward(b, true);
    if (a.line && b.line) {
      const u1 = startDirection(c1), u2 = startDirection(c2); if (!u1 || !u2) return;
      const curves = smoothedCornerCurves(c1[0], u1, u2, space, radius, smoothing); if (!curves?.length) return;
      const tIn = 1 - hypot(sub(curves[0][0], c1[0])) / la, tOut = hypot(sub(curves[curves.length - 1][3], c1[0])) / lb;
      return Number.isFinite(tIn) && Number.isFinite(tOut) && curves.every(c => c.every(finitePoint)) ? { curves, tIn, tOut } : undefined;
    }
    // Beside a curve: one cubic between the cuts on both sides, its handles along each side's direction at its cut.
    const t = Math.min(radius / Math.tan(wanted[0] / 2), space), p = trim(c1, t, a.line, la), q = trim(c2, t, b.line, lb);
    if (!p || !q) return;
    const turn = Math.acos(clamp(-dot(p.back, q.back), -1, 1)), chord = hypot(sub(q.point, p.point));
    const k = turn < 1e-9 ? chord / 3 : 4 / 3 * Math.tan(turn / 4) * chord / (2 * Math.sin(turn / 2));
    if (!Number.isFinite(k) || !finitePoint(p.point) || !finitePoint(q.point)) return;
    return { curves: [[p.point, { x: p.point.x + p.back.x * k, y: p.point.y + p.back.y * k }, { x: q.point.x + q.back.x * k, y: q.point.y + q.back.y * k }, q.point]], tIn: 1 - p.at, tOut: q.at };
  };
  const corners = segments.map((_, i) => corner(i));
  if (!corners.some(Boolean)) return;
  // What is left of each segment between the corner at its start and the one at its end, then the next corner's curves.
  const first = corners[0]?.curves.at(-1)?.[3] ?? start(segments[0]), out: PathCommand[] = [["M", first.x, first.y]];
  segments.forEach((s, i) => {
    const next = corners[(i + 1) % n], t0 = corners[i]?.tOut ?? 0, t1 = next?.tIn ?? 1;
    if (t1 - t0 > 1e-9) {
      if (s.line) { const p = lerp(s.a, s.b, t1); out.push(["L", p.x, p.y]); }
      else { const q = subsegment(s.c, t0, t1); out.push(["C", q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y]); }
    }
    for (const c of next?.curves ?? []) out.push(["C", c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y]);
  });
  out.push(["Z"]);
  return finitePath(out) ? out : undefined;
}

/**
 * Native `round_corners`: `path` with every corner still sharp rounded by `radius`, and corner `smoothing` (0..1)
 * between straight edges. A corner shrinks to what its edges can hold. A closed subpath with no sharp corner, an open
 * one, and a path with a bad radius or coordinates come back as they are.
 */
export function roundCorners(path: readonly PathCommand[], radius: number, smoothing: number): readonly PathCommand[] {
  if (!(Number.isFinite(radius) && radius > 0) || !path.length || !finitePath(path)) return path;
  const amount = Number.isFinite(smoothing) ? clamp(smoothing, 0, 1) : 0, subpaths: PathCommand[][] = [];
  for (const c of path) { if (c[0] === "M" || !subpaths.length) subpaths.push([]); subpaths[subpaths.length - 1].push(c); }
  const out: PathCommand[] = []; let changed = false;
  for (const subpath of subpaths) {
    // Each contour's own size sets its cleanup tolerance, so a large contour cannot weld away a small one's edges.
    const box = pathBounds(subpath), weld = Math.max(Math.max(box?.width ?? 0, box?.height ?? 0) * 1e-6, 1e-9);
    const rounded = subpath.at(-1)?.[0] === "Z" ? roundSubpath(subpath, radius, amount, weld) : undefined;
    if (rounded) changed = true;
    out.push(...(rounded ?? subpath));
  }
  return changed ? out : path;
}
