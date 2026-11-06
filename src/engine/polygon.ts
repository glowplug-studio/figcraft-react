import type { Point } from "./geometry";
import type { PathCommand } from "./corners";
import { ellipticalArcPath } from "./ellipse";

const finite = (n: number): number => Number.isFinite(n) ? n : 0;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, n: number): Point => ({ x: a.x * n, y: a.y * n });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const length = (p: Point): number => Math.hypot(p.x, p.y);
const unit = (p: Point): Point => mul(p, 1 / length(p));
const pair = (p: Point): [number, number] => [p.x, p.y];
/** Native inscribed vertices: y-down, first vertex at the top centre. */
export function polygonPoints(width: number, height: number, count: number): readonly Point[] {
  const n = clamp(Math.trunc(finite(count)), 3, 120), rx = finite(width) / 2, ry = finite(height) / 2;
  return Array.from({ length: n }, (_, i) => { const angle = -Math.PI / 2 + 2 * Math.PI * i / n; return { x: rx + rx * Math.cos(angle), y: ry + ry * Math.sin(angle) }; });
}
export function starPoints(width: number, height: number, count: number, ratio: number): readonly Point[] {
  const n = clamp(Math.trunc(finite(count)), 3, 120), rx = finite(width) / 2, ry = finite(height) / 2, inner = clamp(finite(ratio), .001, 1);
  return Array.from({ length: n * 2 }, (_, i) => { const angle = -Math.PI / 2 + Math.PI * i / n, k = i % 2 === 0 ? 1 : inner; return { x: rx + rx * k * Math.cos(angle), y: ry + ry * k * Math.sin(angle) }; });
}
function vertex(points: readonly Point[], i: number) {
  const cur = points[i], v1 = sub(points[(i + points.length - 1) % points.length], cur), v2 = sub(points[(i + 1) % points.length], cur), l1 = length(v1), l2 = length(v2);
  if (l1 < 1e-9 || l2 < 1e-9 || !Number.isFinite(l1) || !Number.isFinite(l2)) return;
  const u1 = mul(v1, 1 / l1), u2 = mul(v2, 1 / l2), angle = Math.acos(clamp(dot(u1, u2), -1, 1));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return;
  return { cur, u1, u2, angle, max: Math.min(l1, l2) / 2 };
}
function line(path: PathCommand[], p: Point): void { path.push([path.length ? "L" : "M", ...pair(p)]); }
function curve(path: PathCommand[], a: Point, b: Point, end: Point): void { path.push(["C", ...pair(a), ...pair(b), ...pair(end)]); }
export function roundedPolygon(points: readonly Point[], radius: number): readonly PathCommand[] {
  const path: PathCommand[] = [], n = points.length, r = Math.max(0, finite(radius)); if (n < 2) return path;
  if (r <= 0 || n < 3) { for (const p of points) line(path, p); path.push(["Z"]); return path; }
  for (let i = 0; i < n; i++) {
    const v = vertex(points, i);
    if (!v) { const p = points[i]; line(path, p); curve(path, p, p, p); continue; }
    const { cur, u1, u2, angle, max } = v;
    let tangent = r / Math.tan(angle / 2), actual = r;
    if (tangent > max) { actual *= max / tangent; tangent = max; }
    const a = add(cur, mul(u1, tangent)), b = add(cur, mul(u2, tangent)), arm = 4 / 3 * Math.tan((Math.PI - angle) / 4) * actual;
    line(path, a); curve(path, sub(a, mul(u1, arm)), sub(b, mul(u2, arm)), b);
  }
  path.push(["Z"]); return path;
}
/** Independent native smoothing profile, including concave star vertices and half-edge fit. */
export function smoothedPolygon(points: readonly Point[], radius: number, smoothing: number): readonly PathCommand[] {
  const s = clamp(finite(smoothing), 0, 1), rad = Math.max(0, finite(radius));
  if (s <= 0 || rad <= 0 || points.length < 3) return roundedPolygon(points, rad);
  const path: PathCommand[] = [];
  for (let i = 0; i < points.length; i++) {
    const v = vertex(points, i); if (!v) { line(path, points[i]); continue; }
    const { cur, u1, u2, angle, max } = v; let r = rad, tangent = r / Math.tan(angle / 2), sm = s;
    if ((1 + sm) * tangent > max) sm = clamp(max / tangent - 1, 0, sm);
    if (tangent > max) { r *= max / tangent; tangent = max; }
    const p = Math.min((1 + sm) * tangent, max), beta = (Math.PI - angle) * sm / 2;
    const back = tangent - r * Math.sin(beta), side = r * (1 - Math.cos(beta)), c = r * Math.tan(beta / 2) * Math.cos(beta), b = Math.max((p - back - c) / 3, 0), a = 2 * b;
    const bisector = unit(add(u1, u2)), centre = add(cur, mul(bisector, r / Math.sin(angle / 2)));
    const at = (u: Point, along: number, across: number) => add(add(cur, mul(u, along)), mul(unit(sub(bisector, mul(u, dot(bisector, u)))), across));
    line(path, at(u1, p, 0)); const p3 = at(u1, back, side), p4 = at(u2, back, side);
    if (a + b + c > 1e-9) curve(path, at(u1, p - a, 0), at(u1, p - a - b, 0), p3); else line(path, p3);
    const start = Math.atan2(p3.y - centre.y, p3.x - centre.x); let sweep = Math.atan2(p4.y - centre.y, p4.x - centre.x) - start;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (Math.abs(sweep) > 1e-9) path.push(...ellipticalArcPath(centre.x, centre.y, r, r, start, sweep).slice(1));
    const end = at(u2, p, 0); if (a + b + c > 1e-9) curve(path, at(u2, p - a - b, 0), at(u2, p - a, 0), end); else line(path, end);
  }
  path.push(["Z"]); return path;
}
