import { flattenContours, roundedRect, zeroCorners, type PathCommand, type Radii } from "./corners";
import { isFrameLike, type LayerNode } from "./document";
import { ellipticalArcPath } from "./ellipse";
import type { Point } from "./geometry";
import type { StrokeAlign, StrokeSides } from "./stroke";

/** Outer minus hole. A clip is required when the native boolean subtraction trims a protruding hole. */
export interface SideStrokeGeometry {
  readonly outer: readonly PathCommand[];
  readonly hole: readonly PathCommand[];
  readonly clip: boolean;
}
type Box = readonly [number, number, number, number];
type Corner = readonly [number, number];
const nonNegative = (v: number): number => Number.isFinite(v) ? Math.max(0, v) : 0;
const fraction = (align: StrokeAlign): number => align === "inside" ? 0 : align === "center" ? .5 : 1;
const rectangle = ([x0, y0, x1, y1]: Box): PathCommand[] => [["M", x0, y0], ["L", x1, y0], ["L", x1, y1], ["L", x0, y1], ["Z"]];
function translated(path: readonly PathCommand[], x: number, y: number): PathCommand[] {
  return path.map(c => c[0] === "Z" ? c : c[0] === "C" ? ["C", c[1] + x, c[2] + y, c[3] + x, c[4] + y, c[5] + x, c[6] + y] : [c[0], c[1] + x, c[2] + y]);
}
/** Preserve native bar ordering and inverted rectangles; the renderer uses even-odd filling. */
export function rectSideStrokes(w: number, h: number, sides: StrokeSides, align: StrokeAlign): readonly PathCommand[] {
  const [t, r, b, l] = sides.map(nonNegative), f = fraction(align);
  const x0 = -l * f, y0 = -t * f, x1 = w + r * f, y1 = h + b * f;
  return [
    ...(t > 0 ? rectangle([x0, y0, x1, y0 + t]) : []),
    ...(b > 0 ? rectangle([x0, y1 - b, x1, y1]) : []),
    ...(l > 0 ? rectangle([x0, y0 + t, x0 + l, y1 - b]) : []),
    ...(r > 0 ? rectangle([x1 - r, y0 + t, x1, y1 - b]) : []),
  ];
}
function cornerRect(box: Box, corners: readonly Corner[], smoothing: number): readonly PathCommand[] {
  const [x0, y0, x1, y1] = box, [tl, tr, br, bl] = corners;
  if (smoothing > 0 && corners.every(([rx, ry]) => rx === ry)) {
    return translated(roundedRect(x1 - x0, y1 - y0, { radii: corners.map(c => c[0]) as unknown as Radii, smoothing }), x0, y0);
  }
  const path: PathCommand[] = [["M", x0 + tl[0], y0]];
  const quarters = [
    [x1, y0, -1, 1, tr, -Math.PI / 2], [x1, y1, -1, -1, br, 0],
    [x0, y1, 1, -1, bl, Math.PI / 2], [x0, y0, 1, 1, tl, Math.PI],
  ] as const;
  for (const [x, y, sx, sy, [rx, ry], angle] of quarters) {
    if (rx <= 0 || ry <= 0) { path.push(["L", x, y]); continue; }
    const arc = ellipticalArcPath(x + sx * rx, y + sy * ry, rx, ry, angle, Math.PI / 2), start = arc[0];
    if (start[0] === "M") path.push(["L", start[1], start[2]]);
    path.push(...arc.slice(1));
  }
  path.push(["Z"]); return path;
}
export function roundedSideStrokes(w: number, h: number, radii: Radii, smoothing: number, sides: StrokeSides, align: StrokeAlign): SideStrokeGeometry {
  const [t, r, b, l] = sides.map(nonNegative), f = fraction(align), k = 1 - f;
  if (t + r + b + l <= 0) return { outer: [], hole: [], clip: false };
  const maxRadius = nonNegative(Math.min(w, h)) / 2, rs = radii.map(v => Math.min(nonNegative(v), maxRadius));
  const corners = [[rs[0], l, t], [rs[1], r, t], [rs[2], r, b], [rs[3], l, b]] as const;
  const outer = align === "inside" ? roundedRect(w, h, { radii: rs as unknown as Radii, smoothing })
    : cornerRect([-l * f, -t * f, w + r * f, h + b * f], corners.map(([radius, x, y]) => radius > 0 ? [radius + x * f, radius + y * f] : [0, 0]), smoothing);
  const box: Box = [l * k, t * k, w - r * k, h - b * k], iw = box[2] - box[0], ih = box[3] - box[1];
  if (iw <= 0 || ih <= 0) return { outer, hole: [], clip: false };
  const inset: Corner[] = corners.map(([radius, x, y]) => {
    const rx = Math.max(0, radius - x * k), ry = Math.max(0, radius - y * k);
    return rx > 0 && ry > 0 ? [rx, ry] : [0, 0];
  });
  const [tl, tr, br, bl] = inset;
  const edges = [[iw, tl[0] + tr[0]], [iw, bl[0] + br[0]], [ih, tl[1] + bl[1]], [ih, tr[1] + br[1]]];
  const fit = edges.reduce((scale, [length, sum]) => sum > 0 ? Math.min(scale, length / sum) : scale, 1);
  return { outer, hole: cornerRect(box, inset.map(([rx, ry]) => [rx * fit, ry * fit]), smoothing), clip: fit < 1 || smoothing > 0 };
}
export function sideStrokeGeometry(node: LayerNode): SideStrokeGeometry | undefined {
  const sides = node.stroke?.sides;
  if (!sides || node.kind !== "rectangle" && (!isFrameLike(node) || node.kind === "componentSet")) return undefined;
  const corners = node.corners ?? zeroCorners, align = node.stroke!.align;
  return corners.radii.every(r => r === 0) ? { outer: rectSideStrokes(node.width, node.height, sides, align), hole: [], clip: false }
    : roundedSideStrokes(node.width, node.height, corners.radii, corners.smoothing, sides, align);
}

/** Bounded convex intersection for this slice's rounded boxes, not general vector booleans.
 * Flatten both boundaries together so coincident edges cancel before Canvas antialiasing.
 * Clipping an already-antialiased even-odd ring instead leaves visible seams on absent sides.
 */
export function clippedSideStrokePath(geometry: SideStrokeGeometry): readonly PathCommand[] {
  if (!geometry.clip || !geometry.hole.length) return [...geometry.outer, ...geometry.hole];
  const contour = (path: readonly PathCommand[]): Point[] => {
    const points = [...(flattenContours(path)[0] ?? [])];
    if (points.length > 1 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop();
    // Native astronomical coordinates already use bounded arc subdivision. Keep this extra
    // browser-only intersection bounded too; ordinary UI dimensions retain the .001 flattening.
    if (points.length > 2048) return Array.from({ length: 2048 }, (_, i) => points[Math.floor(i * points.length / 2048)]);
    return points;
  };
  const outer = contour(geometry.outer); let hole = contour(geometry.hole);
  for (let i = 0; i < outer.length && hole.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length], dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;
    const distance = (p: Point) => dx * (p.y - a.y) - dy * (p.x - a.x);
    const clipped: Point[] = []; let previous = hole.at(-1)!, d0 = distance(previous);
    for (const current of hole) {
      const d1 = distance(current);
      if ((d0 >= 0) !== (d1 >= 0)) {
        const t = d0 / (d0 - d1);
        clipped.push({ x: previous.x + t * (current.x - previous.x), y: previous.y + t * (current.y - previous.y) });
      }
      if (d1 >= 0) clipped.push(current);
      previous = current; d0 = d1;
    }
    hole = clipped;
  }
  const path = (points: readonly Point[]): PathCommand[] => points.length ? [...points.map((p, i): PathCommand => [i === 0 ? "M" : "L", p.x, p.y]), ["Z"]] : [];
  return [...path(outer), ...path(hole)];
}
