import type { LayerNode } from "./document";
import type { Point } from "./geometry";
import { parseNumber } from "./parameters";

export type Radii = readonly [number, number, number, number];
export interface Corners { readonly radii: Radii; readonly smoothing: number }
export const zeroCorners: Corners = Object.freeze({ radii: Object.freeze([0, 0, 0, 0]) as Radii, smoothing: 0 });
export const cornerKeys = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"] as const;
export const isCornerKey = (key: string): boolean => key === "cornerRadius" || key === "cornerSmoothing" || (cornerKeys as readonly string[]).includes(key);
export function setCorners(current: Corners, props: Record<string, unknown>): Corners {
  let radii = [...current.radii]; let smoothing = current.smoothing;
  for (const key of Object.keys(props).filter(isCornerKey).sort()) {
    const value = props[key];
    if (key === "cornerSmoothing") {
      try { smoothing = Math.max(0, Math.min(1, parseNumber(value))); } catch { smoothing = 0; }
    } else if (key === "cornerRadius") {
      const values = (Array.isArray(value) ? value : [value]).map(v => Math.max(0, parseNumber(v, key)));
      if (values.length === 1) radii = Array(4).fill(values[0]);
      else if (values.length === 2) radii = [...values, ...values];
      else if (values.length === 4) radii = values;
      else throw new Error("cornerRadius requires a number or 1, 2 or 4 numbers");
    } else radii[cornerKeys.indexOf(key as typeof cornerKeys[number])] = Math.max(0, parseNumber(value, key));
  }
  return radii.every((r, i) => r === current.radii[i]) && smoothing === current.smoothing ? current
    : Object.freeze({ radii: Object.freeze(radii) as unknown as Radii, smoothing });
}

export type PathCommand = readonly ["M" | "L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];
export interface PathSink { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void; closePath(): void }
const clean = (n: number) => Number.isFinite(n) ? n : 0;
function profile(radius: number, smoothing: number, max: number) {
  let r = radius, s = smoothing;
  if (r <= 0) return { r: 0, p: 0, a: 0, b: 0, c: 0, d: 0 };
  if ((1 + s) * r > max) s = Math.max(0, Math.min(s, max / r - 1));
  r = Math.min(r, max);
  const p = Math.min((1 + s) * r, max), arc = Math.PI / 2 * (1 - s);
  const length = Math.sin(arc / 2) * r * Math.SQRT2, alpha = (Math.PI / 2 - arc) / 2;
  const join = r * Math.tan(alpha / 2), beta = Math.PI / 4 * s;
  const c = join * Math.cos(beta), d = c * Math.tan(beta), b = Math.max((p - length - c - d) / 3, 0);
  return { r, p, a: 2 * b, b, c, d };
}
/** Independent numeric port of geom::rounded_rect; circular cubics follow Kurbo 0.13.1's 0.01 tolerance. */
export function roundedRect(width: number, height: number, corners: Corners = zeroCorners): readonly PathCommand[] {
  const w = Math.max(0, clean(width)), h = Math.max(0, clean(height)), max = Math.min(w, h) / 2;
  if (w <= 0 && h <= 0) return [];
  const s = Math.max(0, Math.min(1, clean(corners.smoothing))), radii = corners.radii.map(r => Math.max(0, Math.min(max, clean(r))));
  if (radii.every(r => r === 0)) return [["M", 0, 0], ["L", w, 0], ["L", w, h], ["L", 0, h], ["Z"]];
  const profiles = radii.map(r => profile(r, s, max)), path: PathCommand[] = [["M", profiles[0].p, 0]];
  const append = (index: number, x: number, y: number, ix: number, iy: number, ox: number, oy: number) => {
    const { r, p, a, b, c, d } = profiles[index], at = (back: number, side: number): [number, number] => [x - ix * back + ox * side, y - iy * back + oy * side];
    if (r <= 0) { path.push(["L", x, y]); return; }
    path.push(["L", ...at(p, 0)]);
    const p3 = at(p - a - b - c, d), p4 = at(d, p - a - b - c), centre = at(r, r);
    if (a + b + c > 1e-9) path.push(["C", ...at(p - a, 0), ...at(p - a - b, 0), ...p3]);
    let angle = Math.atan2(p3[1] - centre[1], p3[0] - centre[0]);
    let sweep = Math.atan2(p4[1] - centre[1], p4[0] - centre[0]) - angle;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (Math.abs(sweep) > 1e-9) {
      // Kurbo arc.rs append_iter: error-dependent segment count and tangent arms.
      const n = Math.min(4096, Math.ceil(Math.max((1.1163 * r / .01) ** (1 / 6), 3.999999) * Math.abs(sweep) / (2 * Math.PI)));
      const step = sweep / n, arm = 4 / 3 * Math.tan(Math.abs(step / 4)) * Math.sign(sweep);
      for (let j = 0; j < n; j++) {
        const end = angle + step, x0 = r * Math.cos(angle), y0 = r * Math.sin(angle), x1 = r * Math.cos(end), y1 = r * Math.sin(end);
        path.push(["C", centre[0] + x0 - arm * y0, centre[1] + y0 + arm * x0, centre[0] + x1 + arm * y1, centre[1] + y1 - arm * x1, centre[0] + x1, centre[1] + y1]); angle = end;
      }
    }
    if (a + b + c > 1e-9) path.push(["C", ...at(0, p - a - b), ...at(0, p - a), ...at(0, p)]);
    else path.push(["L", ...at(0, p)]);
  };
  append(1, w, 0, 1, 0, 0, 1); append(2, w, h, 0, 1, -1, 0); append(3, 0, h, -1, 0, 0, -1); append(0, 0, 0, 0, -1, 1, 0); path.push(["Z"]);
  return path;
}
export function tracePath(sink: PathSink, path: readonly PathCommand[], map: (p: Point) => Point = p => p): void {
  for (const c of path) {
    if (c[0] === "Z") sink.closePath();
    else if (c[0] === "C") { const a = map({ x: c[1], y: c[2] }), b = map({ x: c[3], y: c[4] }), p = map({ x: c[5], y: c[6] }); sink.bezierCurveTo(a.x, a.y, b.x, b.y, p.x, p.y); }
    else { const p = map({ x: c[1], y: c[2] }); if (c[0] === "M") sink.moveTo(p.x, p.y); else sink.lineTo(p.x, p.y); }
  }
}
const paths = new WeakMap<Corners, Map<string, readonly PathCommand[]>>();
export const hasRoundedCorners = (n: LayerNode): boolean => (n.kind === "rectangle" || n.kind === "frame") && Boolean(n.corners?.radii.some(r => r > 0));
export function cornerPath(node: LayerNode): readonly PathCommand[] {
  const corners = node.corners ?? zeroCorners, key = `${node.width}:${node.height}`;
  let cache = paths.get(corners); if (!cache) { cache = new Map(); paths.set(corners, cache); }
  let path = cache.get(key); if (!path) { path = roundedRect(node.width, node.height, corners); if (cache.size >= 32) cache.clear(); cache.set(key, path); } return path;
}
const flattened = new WeakMap<readonly PathCommand[], readonly (readonly Point[])[]>();
const midpoint = (a: Point, b: Point): Point => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
function distance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Adaptive cubic flattening; error is smaller than native nearest's 0.01 tolerance. */
export function flattenContours(path: readonly PathCommand[], tolerance = .001): readonly (readonly Point[])[] {
  const cached = tolerance === .001 && flattened.get(path); if (cached) return cached;
  const contours: Point[][] = []; let out: Point[] = []; let previous = { x: 0, y: 0 }, subdivisions = 0;
  const cubic = (a: Point, b: Point, c: Point, d: Point, depth: number) => {
    if (depth >= 24 || subdivisions++ >= 65536 || Math.max(distance(b, a, d), distance(c, a, d)) <= tolerance) { out.push(d); return; }
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), abc = midpoint(ab, bc), bcd = midpoint(bc, cd), mid = midpoint(abc, bcd);
    cubic(a, ab, abc, mid, depth + 1); cubic(mid, bcd, cd, d, depth + 1);
  };
  for (const cmd of path) {
    if (cmd[0] === "Z") { if (out.length) out.push(out[0]); }
    else if (cmd[0] === "C") { const next = { x: cmd[5], y: cmd[6] }; cubic(previous, { x: cmd[1], y: cmd[2] }, { x: cmd[3], y: cmd[4] }, next, 0); previous = next; }
    else { if (cmd[0] === "M") { out = []; contours.push(out); } previous = { x: cmd[1], y: cmd[2] }; out.push(previous); }
  }
  if (tolerance === .001) flattened.set(path, contours);
  return contours;
}
export function flattenPath(path: readonly PathCommand[]): readonly Point[] { return flattenContours(path).flat(); }
/** Open subpaths have no implicit closing edge when measuring stroke proximity. */
export function nearPath(path: readonly PathCommand[], point: Point, tolerance: number): boolean {
  for (const points of flattenContours(path)) for (let i = 1; i < points.length; i++) if (distance(point, points[i - 1], points[i]) <= tolerance) return true;
  return false;
}
export function hitsPath(path: readonly PathCommand[], point: Point, tolerance: number, includeInterior = true): boolean {
  let winding = 0;
  for (const points of flattenContours(path)) for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (distance(point, a, b) <= tolerance) return true;
    const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && cross > 0) winding++;
    else if (a.y > point.y && b.y <= point.y && cross < 0) winding--;
  }
  return includeInterior && winding !== 0;
}
export function hitsCornerPath(node: LayerNode, point: Point, tolerance: number): boolean {
  if (point.x < -tolerance || point.y < -tolerance || point.x > node.width + tolerance || point.y > node.height + tolerance) return false;
  return hitsPath(cornerPath(node), point, tolerance);
}
