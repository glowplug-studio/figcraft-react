import { transformPoint } from "./affine";
import type { Point } from "./geometry";
import { anchors } from "./sizing";
import type { selectionFrame } from "./rotation";

export type Handle = { kind: "corner" | "edge" | "rotate"; index: number };
export type HandleFrame = NonNullable<ReturnType<typeof selectionFrame>>;
export type ScaleAnchor = typeof anchors[number];
export const nativeSign = (n: number): number => n < 0 || Object.is(n, -0) ? -1 : 1;
export function anchorPoint(anchor: ScaleAnchor, width: number, height: number): Point {
  const i = anchors.indexOf(anchor); return { x: width * (i % 3) / 2, y: height * Math.floor(i / 3) / 2 };
}
export function handlePoint(h: Handle, width: number, height: number): Point {
  const points = h.kind === "edge" ? [[.5, 0], [1, .5], [.5, 1], [0, .5]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
  return { x: points[h.index][0] * width, y: points[h.index][1] * height };
}
export function frameCorners(frame: HandleFrame): Point[] {
  return [0, 1, 2, 3].map(index => transformPoint(frame.matrix, handlePoint({ kind: "corner", index }, frame.width, frame.height)));
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function handleAt(c: readonly Point[], p: Point, zoom: number, line = false): Handle | undefined {
  const tol = 5 / Math.max(zoom, 1e-6);
  const sides = c.map((a, i) => { const b = c[(i + 1) % 4]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); });
  if (sides.some(s => !Number.isFinite(s))) return;
  const inside = sides.some(s => s < 0) !== sides.some(s => s > 0);
  const inner = inside && !line ? Math.min(distance(c[0], c[1]), distance(c[0], c[3])) / 4 : Infinity;
  let nearest: { distance: number; handle: Handle } | undefined;
  for (let i = 0; i < (line ? 2 : 4); i++) {
    const d = distance(c[i], p);
    if (d <= Math.min(tol * 1.6, inner) && (!nearest || d < nearest.distance)) nearest = { distance: d, handle: { kind: "corner", index: i } };
  }
  if (nearest) return nearest.handle;
  for (let i = 0; !line && i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = distance(p, { x: a.x + t * dx, y: a.y + t * dy });
    if (t > .05 && t < .95 && d <= Math.min(tol, inner) && (!nearest || d < nearest.distance)) nearest = { distance: d, handle: { kind: "edge", index: i } };
  }
  if (nearest) return nearest.handle;
  const centre = { x: c.reduce((n, p) => n + p.x, 0) / 4, y: c.reduce((n, p) => n + p.y, 0) / 4 };
  for (let i = 0; i < 4; i++) {
    const d = distance(c[i], p), outward = (p.x - c[i].x) * (c[i].x - centre.x) + (p.y - c[i].y) * (c[i].y - centre.y) > 0;
    if (d <= 18 / Math.max(zoom, 1e-6) && d > tol && outward) return { kind: "rotate", index: i };
  }
  return;
}
export function handleCursor(c: readonly Point[], h: Handle): string {
  if (h.kind === "rotate") return "crosshair";
  const a = c[h.index], b = c[(h.index + 1) % 4], previous = c[(h.index + 3) % 4], opposite = c[(h.index + 2) % 4];
  const w = distance(a, b), height = distance(a, previous);
  const angle = h.kind === "edge" ? Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2
    : w > 1e-9 && height > 1e-9 ? Math.atan2((b.y - a.y) / w + (previous.y - a.y) / height, (b.x - a.x) / w + (previous.x - a.x) / height)
    : Math.atan2(opposite.y - a.y, opposite.x - a.x);
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4];
}
function sides(h: Handle): readonly [boolean | undefined, boolean | undefined] {
  if (h.kind === "rotate") return [undefined, undefined];
  return h.kind === "corner" ? [[false, false], [true, false], [true, true], [false, true]][h.index] as [boolean, boolean]
    : [[undefined, false], [true, undefined], [undefined, true], [false, undefined]][h.index] as [boolean | undefined, boolean | undefined];
}
export function resizedBox(h: Handle, q: Point, w: number, height: number, keep: boolean, centre: boolean): readonly [number, number, number, number] {
  let x0 = 0, y0 = 0, x1 = w, y1 = height; const [sx, sy] = sides(h);
  if (sx !== undefined) { x0 = sx ? centre ? w - q.x : 0 : q.x; x1 = sx ? q.x : centre ? w - q.x : w; }
  if (sy !== undefined) { y0 = sy ? centre ? height - q.y : 0 : q.y; y1 = sy ? q.y : centre ? height - q.y : height; }
  if (keep && w > 1e-9 && height > 1e-9 && h.kind !== "rotate") {
    const kx = (x1 - x0) / w, ky = (y1 - y0) / height;
    const k = sx === undefined ? ky : sy === undefined ? kx : Math.abs(kx) > Math.abs(ky) ? kx : ky;
    const pivot = centre ? { x: w / 2, y: height / 2 } : handlePoint({ ...h, index: (h.index + 2) % 4 }, w, height);
    x0 = pivot.x * (1 - k); x1 = pivot.x + (w - pivot.x) * k; y0 = pivot.y * (1 - k); y1 = pivot.y + (height - pivot.y) * k;
  }
  return [x0, y0, x1, y1];
}
export function scaleFactor(h: Handle, q: Point, w: number, height: number, anchor: ScaleAnchor, centre: boolean): { factor: number; pivot: Point } | undefined {
  if (![q.x, q.y, w, height].every(Number.isFinite) || h.kind === "rotate") return;
  const point = handlePoint(h, w, height), a = anchorPoint(anchor, w, height), [sx, sy] = sides(h);
  const onSide = sx !== undefined && Math.abs(a.x - point.x) < 1e-9 || sy !== undefined && Math.abs(a.y - point.y) < 1e-9;
  const pivot = centre ? { x: w / 2, y: height / 2 } : onSide ? handlePoint({ ...h, index: (h.index + 2) % 4 }, w, height) : a;
  const kx = sx !== undefined && Math.abs(point.x - pivot.x) > 1e-9 ? (q.x - pivot.x) / (point.x - pivot.x) : undefined;
  const ky = sy !== undefined && Math.abs(point.y - pivot.y) > 1e-9 ? (q.y - pivot.y) / (point.y - pivot.y) : undefined;
  const k = kx === undefined ? ky : ky === undefined || Math.abs(kx) > Math.abs(ky) ? kx : ky;
  if (k === undefined || !Number.isFinite(k)) return;
  return { factor: nativeSign(k) * Math.max(.01, Math.min(1000, Math.abs(k))), pivot };
}
