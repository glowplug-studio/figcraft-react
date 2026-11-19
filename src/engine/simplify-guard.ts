// Native crates/geom/src/simplify.rs (upstream #1741): simplification that keeps to its input where Kurbo's fit
// would shoot past it. Independent TypeScript; the per-run fit is supplied by the caller.
import type { PathCommand } from "./corners";
import { cubicPoint, type Cubic } from "./cubic";
import { nearestCubic } from "./cubic-nearest";
import type { Point } from "./geometry";

/** How far, as a multiple of the accuracy asked for, a fitted run may stray from the run it replaces (native `STRAY`). */
const stray = 2;
/** Parts each fitted segment is cut into; the points between them are the ones measured (native `SAMPLES`). */
const samples = 16;

type Segment = readonly [Point, Point] | Cubic;
type Fit = (run: readonly PathCommand[], accuracy: number) => readonly PathCommand[];

const end = (segment: Segment): Point => segment[segment.length - 1];
const at = (segment: Segment, t: number): Point => segment.length === 4 ? cubicPoint(segment, t)
  : { x: segment[0].x + (segment[1].x - segment[0].x) * t, y: segment[0].y + (segment[1].y - segment[0].y) * t };
function distanceSquared(segment: Segment, point: Point): number {
  if (segment.length === 4) { const nearest = nearestCubic(segment, point); return nearest ? nearest.distance * nearest.distance : Infinity; }
  const [a, b] = segment, dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  const x = a.x + dx * t - point.x, y = a.y + dy * t - point.y;
  return x * x + y * y;
}
/** The segments of one open subpath: a move and the lines and cubics after it. */
function segments(path: readonly PathCommand[]): Segment[] {
  const out: Segment[] = []; let pen: Point | undefined;
  for (const c of path) {
    if (c[0] === "M") pen = { x: c[1], y: c[2] };
    else if (c[0] === "L" && pen) { const to = { x: c[1], y: c[2] }; out.push([pen, to]); pen = to; }
    else if (c[0] === "C" && pen) { const to = { x: c[5], y: c[6] }; out.push([pen, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, to]); pen = to; }
  }
  return out;
}
/** Native `keeps_to`: whether every point of `fitted` lies within `tolerance` of `source`. The fit ends each segment
 * on the source, so the two are walked together; a fitted end found on no source segment counts as straying. */
function keepsTo(fitted: readonly PathCommand[], source: readonly PathCommand[], tolerance: number): boolean {
  const src = segments(source), on = (tolerance * 1e-3) ** 2, limit = tolerance * tolerance;
  let current = 0;
  for (const segment of segments(fitted)) {
    let last = -1;
    for (let i = current; i < src.length; i++) if (distanceSquared(src[i], end(segment)) <= on) { last = i; break; }
    if (last < 0) return false;
    for (let i = 1; i < samples; i++) {
      const point = at(segment, i / samples);
      let near = false;
      for (let j = current; j <= last && !near; j++) near = distanceSquared(src[j], point) <= limit;
      if (!near) return false;
    }
    current = last;
  }
  return true;
}
/** Native `tangents`: the directions a segment leaves its start and reaches its end, skipping control points that
 * sit on an end; undefined for a segment of no length. */
function tangents(segment: Segment): readonly [Point, Point] | undefined {
  const first = segment[0], last = end(segment);
  let leave: Point | undefined, reach: Point | undefined;
  for (const p of segment) { const d = { x: p.x - first.x, y: p.y - first.y }; if (d.x * d.x + d.y * d.y > 0) { leave = d; break; } }
  for (let i = segment.length - 1; i >= 0; i--) { const p = segment[i], d = { x: last.x - p.x, y: last.y - p.y }; if (d.x * d.x + d.y * d.y > 0) { reach = d; break; } }
  return leave && reach ? [leave, reach] : undefined;
}

/**
 * Native `simplify_path`. The path is cut where it turns back by more than a right angle, so a turn stays a sharp
 * corner; each run between cuts is simplified by `fit`; a fitted run that strays more than twice `accuracy` from the
 * run it replaces is kept as it was. Subpaths and closes are kept, and a closing segment stays implicit.
 */
export function simplifyKeeping(input: readonly PathCommand[], accuracy: number, fit: Fit): PathCommand[] {
  const out: PathCommand[] = [];
  let run: PathCommand[] = [], start: Point = { x: 0, y: 0 }, pen: Point = start, lastTangent: Point | undefined;
  // Whether the next run that draws anything has to start the subpath with its move.
  let fresh = true;
  const flush = () => {
    if (run.length > 1) {
      const fitted = fit(run, accuracy), kept = keepsTo(fitted, run, stray * accuracy) ? fitted : run;
      for (const c of kept) { if (c[0] === "M" && !fresh) continue; out.push(c); fresh = false; }
    }
    run = [];
  };
  for (const c of input) {
    if (c[0] === "M") {
      flush(); start = pen = { x: c[1], y: c[2] }; lastTangent = undefined; fresh = true; run.push(["M", pen.x, pen.y]);
      continue;
    }
    if (c[0] === "Z") {
      flush(); if (!fresh) out.push(["Z"]);
      // A segment after a close starts a new subpath at the closed one's start.
      pen = start; lastTangent = undefined; fresh = true; run.push(["M", start.x, start.y]);
      continue;
    }
    const segment: Segment = c[0] === "C" ? [pen, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, { x: c[5], y: c[6] }] : [pen, { x: c[1], y: c[2] }];
    if (!run.length) run.push(["M", pen.x, pen.y]);
    const directions = tangents(segment);
    if (!directions) continue;
    if (lastTangent && lastTangent.x * directions[0].x + lastTangent.y * directions[0].y < 0) { flush(); run.push(["M", pen.x, pen.y]); }
    run.push(c); pen = end(segment); lastTangent = directions[1];
  }
  flush();
  return out;
}
