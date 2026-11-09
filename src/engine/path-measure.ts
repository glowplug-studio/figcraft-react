import { flattenCurve, type CurveElement } from "./curve-flatten";
import {transformPoint,type Affine} from "./affine";
import type { Point } from "./geometry";

export const PATH_FLATTEN_TOLERANCE = .05, MAX_PATH_SAMPLES = 40_000;
export interface MeasuredPolyline { readonly points: readonly Point[]; readonly lengths: readonly number[]; readonly closed: boolean }
export const polylineLength = (line: MeasuredPolyline): number => line.lengths.at(-1) ?? 0;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function measurePath(path: readonly CurveElement[], limit = MAX_PATH_SAMPLES, tolerance = PATH_FLATTEN_TOLERANCE): readonly MeasuredPolyline[] | undefined {
  if (!(Number.isFinite(tolerance) && tolerance > 0)) return undefined;
  if (path.length > limit || path.some(c => c.slice(1).some(n => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1.5e9))) return undefined;
  const out: MeasuredPolyline[] = []; let points: Point[] = [], lengths: number[] = [], count = 0, closed = false;
  let start: Point = { x: 0, y: 0 }, pen = start;
  const push = (p: Point) => {
    const last = points.at(-1), distance = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0;
    if (!last || distance > 1e-9) { points.push(p); lengths.push((lengths.at(-1) ?? 0) + distance); }
  };
  const finish = () => { if (points.length >= 2) out.push({ points, lengths, closed }); points = []; lengths = []; closed = false; };
  for (const command of path) {
    if (count > limit) return undefined;
    if (command[0] === "M") { count++; finish(); start = pen = { x: command[1], y: command[2] }; push(pen); }
    else if (command[0] === "L") { count++; if (!points.length) push(start); pen = { x: command[1], y: command[2] }; push(pen); }
    else if (command[0] === "Q" || command[0] === "C") {
      const control = {x:command[1],y:command[2]}, point = {x:command[3],y:command[4]};
      const end = command[0]==="C" ? {x:command[5],y:command[6]} : point;
      if (!points.length) push(pen);
      if (!flattenCurve(command[0]==="C" ? [pen,control,point,end] : [pen,control,end],
        tolerance,limit-count,p=>{ count++; push(p); })) return undefined;
      pen = end;
    } else { count++; push(start); closed = points.length >= 3; pen = start; finish(); }
  }
  finish(); return count <= limit ? out : undefined;
}
export function polylineAt(line: MeasuredPolyline, t: number): { point: Point; normal: Point } | undefined {
  const length = polylineLength(line); if (length <= 1e-9 || !Number.isFinite(t)) return undefined;
  const s = Math.max(0, Math.min(1, t)) * length;
  let lo = 0, hi = line.lengths.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (line.lengths[mid] <= s) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, Math.min(line.points.length - 1, lo)), a = line.points[i - 1], b = line.points[i];
  if (!a || !b) return undefined;
  const la = line.lengths[i - 1], lb = line.lengths[i], u = lb - la > 1e-12 ? Math.max(0, Math.min(1, (s - la) / (lb - la))) : 0;
  const dx = b.x - a.x, dy = b.y - a.y, norm = Math.max(1e-12, Math.hypot(dx, dy));
  return { point: lerp(a, b, u), normal: { x: -dy / norm, y: dx / norm } };
}
export function nearestOnPolylines(lines: readonly MeasuredPolyline[], point: Point, world?:Affine): { subpath: number; t: number; distance: number } | undefined {
  let best: { subpath: number; t: number; distance: number } | undefined;
  lines.forEach((line, subpath) => {
    const length = polylineLength(line); if (length <= 1e-9) return;
    for (let i = 0; i < line.points.length - 1; i++) {
      const a = world ? transformPoint(world,line.points[i]) : line.points[i];
      const b = world ? transformPoint(world,line.points[i+1]) : line.points[i+1];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const u = l2 > 1e-18 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2)) : 0;
      const p = lerp(a, b, u), distance = Math.hypot(p.x - point.x, p.y - point.y);
      if (!best || distance < best.distance) best = { subpath, t: (line.lengths[i] + u * (line.lengths[i+1]-line.lengths[i])) / length, distance };
    }
  });
  return best;
}
