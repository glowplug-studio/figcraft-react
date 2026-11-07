import type { Cubic } from "./cubic";
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
type VertexCorner = NonNullable<ReturnType<typeof vertex>>;
function cornerProfile(v: VertexCorner, radius: number, smoothing: number) {
  const { cur, u1, u2, angle, max } = v;
  let r = radius, tangent = r / Math.tan(angle / 2), sm = smoothing;
  if ((1 + sm) * tangent > max) sm = clamp(max / tangent - 1, 0, sm);
  if (tangent > max) { r *= max / tangent; tangent = max; }
  const p = Math.min((1 + sm) * tangent, max), beta = (Math.PI - angle) * sm / 2;
  const back = tangent - r * Math.sin(beta), side = r * (1 - Math.cos(beta)), c = r * Math.tan(beta / 2) * Math.cos(beta), b = Math.max((p - back - c) / 3, 0), a = 2 * b;
  const bisector = unit(add(u1, u2)), centre = add(cur, mul(bisector, r / Math.sin(angle / 2)));
  const at = (u: Point, along: number, across: number) => add(add(cur, mul(u, along)), mul(unit(sub(bisector, mul(u, dot(bisector, u)))), across));
  const p3 = at(u1, back, side), p4 = at(u2, back, side);
  const start = Math.atan2(p3.y - centre.y, p3.x - centre.x); let sweep = Math.atan2(p4.y - centre.y, p4.x - centre.x) - start;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
  const eased = a + b + c > 1e-9;
  return { first: at(u1, p, 0), last: at(u2, p, 0), p3, p4, centre, r, start, sweep,
    easeIn: eased ? [at(u1, p - a, 0), at(u1, p - a - b, 0)] as const : undefined,
    easeOut: eased ? [at(u2, p - a - b, 0), at(u2, p - a, 0)] as const : undefined };
}

/** Vector networks store the circular section as one cubic between two easing pieces. */
export function smoothedCornerCurves(cur: Point, first: Point, second: Point, room: number, radius: number, smoothing: number): Cubic[] | undefined {
  const l1 = length(first), l2 = length(second);
  if (![l1, l2, radius, room, cur.x, cur.y].every(Number.isFinite) || l1 <= 1e-9 || l2 <= 1e-9 || room <= 0 || radius <= 0) return;
  const u1 = unit(first), u2 = unit(second), angle = Math.acos(clamp(dot(u1, u2), -1, 1));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return;
  const k = cornerProfile({ cur, u1, u2, angle, max: room }, radius, clamp(finite(smoothing), 0, 1));
  const curves: Cubic[] = [[k.first, ...(k.easeIn ?? [k.first, k.p3] as const), k.p3]];
  if (Math.abs(k.sweep) > 1e-9) {
    const arm = 4 / 3 * Math.tan(k.sweep / 4) * k.r;
    const tangent = (angle: number) => ({ x: -Math.sin(angle) * arm, y: Math.cos(angle) * arm });
    curves.push([k.p3, add(k.p3, tangent(k.start)), sub(k.p4, tangent(k.start + k.sweep)), k.p4]);
  }
  curves.push([k.p4, ...(k.easeOut ?? [k.p4, k.last] as const), k.last]);
  const nonempty = curves.filter(([a, b, c, d]) => [sub(d, a), sub(b, a), sub(c, d)].some(v => length(v) > 1e-9));
  if (nonempty.length && nonempty.every(points => points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))) return nonempty;
}

/** Independent native smoothing profile, including concave star vertices and half-edge fit. */
export function smoothedPolygon(points: readonly Point[], radius: number, smoothing: number): readonly PathCommand[] {
  const s = clamp(finite(smoothing), 0, 1), rad = Math.max(0, finite(radius));
  if (s <= 0 || rad <= 0 || points.length < 3) return roundedPolygon(points, rad);
  const path: PathCommand[] = [];
  for (let i = 0; i < points.length; i++) {
    const v = vertex(points, i); if (!v) { line(path, points[i]); continue; }
    const k = cornerProfile(v, rad, s);
    line(path, k.first);
    if (k.easeIn) curve(path, ...k.easeIn, k.p3); else line(path, k.p3);
    if (Math.abs(k.sweep) > 1e-9) path.push(...ellipticalArcPath(k.centre.x, k.centre.y, k.r, k.r, k.start, k.sweep).slice(1));
    if (k.easeOut) curve(path, ...k.easeOut, k.last); else line(path, k.last);
  }
  path.push(["Z"]); return path;
}
