import type { Point, Rectangle } from "./geometry";

export type Cubic = readonly [Point, Point, Point, Point];
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
export function splitCubic(c: Cubic, t: number): readonly [Cubic, Cubic] {
  const a = mix(c[0], c[1], t), b = mix(c[1], c[2], t), d = mix(c[2], c[3], t);
  const e = mix(a, b, t), f = mix(b, d, t), p = mix(e, f, t);
  return [[c[0], a, e, p], [p, f, d, c[3]]];
}
export function cubicPoint(c: Cubic, t: number): Point { return splitCubic(c, t)[0][3]; }
export function cubicDerivative(c: Cubic, t: number): Point {
  const s = 1 - t;
  return { x: 3 * (s * s * (c[1].x - c[0].x) + 2 * s * t * (c[2].x - c[1].x) + t * t * (c[3].x - c[2].x)),
    y: 3 * (s * s * (c[1].y - c[0].y) + 2 * s * t * (c[2].y - c[1].y) + t * t * (c[3].y - c[2].y)) };
}
export function cubicPart(c: Cubic, from: number, to: number): Cubic {
  if (from === 0 && to === 1) return c;
  if (to === 0) return [c[0], c[0], c[0], c[0]];
  return splitCubic(splitCubic(c, to)[0], from / to)[1];
}
export const reverseCubic = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]];
export const isStraightCubic = (c: Cubic): boolean => c[0].x === c[1].x && c[0].y === c[1].y && c[2].x === c[3].x && c[2].y === c[3].y;
export function cubicStartDirection(c: Cubic): Point | undefined {
  for (let i = 1; i < 4; i++) { const x = c[i].x - c[0].x, y = c[i].y - c[0].y, length = Math.hypot(x, y); if (length > 1e-9) return { x: x / length, y: y / length }; }
  return undefined;
}
/** Independent adaptive Simpson integration; depth is bounded even for singular derivatives. */
export function cubicLength(c: Cubic, end = 1, tolerance = 1e-6): number {
  if (isStraightCubic(c) && end === 1) return Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
  const speed = (t: number) => { const d = cubicDerivative(c, t); return Math.hypot(d.x, d.y); };
  const f0 = speed(0), fm = speed(end / 2), f1 = speed(end), estimate = end / 6 * (f0 + 4 * fm + f1);
  if (!Number.isFinite(estimate)) return Infinity;
  const stack: number[][] = [[0, end, f0, fm, f1, estimate, tolerance, 0]]; let sum = 0;
  while (stack.length) {
    const [a, b, fa, fc, fb, whole, epsilon, depth] = stack.pop()!, m = (a + b) / 2;
    const l = speed((a + m) / 2), r = speed((m + b) / 2), left = (m - a) / 6 * (fa + 4 * l + fc), right = (b - m) / 6 * (fc + 4 * r + fb);
    const delta = left + right - whole;
    if (depth >= 20 || Math.abs(delta) <= 15 * epsilon) sum += left + right + delta / 15;
    else { stack.push([m, b, fc, r, fb, right, epsilon / 2, depth + 1], [a, m, fa, l, fc, left, epsilon / 2, depth + 1]); }
  }
  return sum;
}
export function cubicLengthParameter(c: Cubic, distance: number, length = cubicLength(c)): number {
  if (distance <= 0) return 0; if (distance >= length) return 1;
  let low = 0, high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2, measured = cubicLength(c, mid, 1e-7);
    if (Math.abs(measured - distance) <= 1e-6) return mid;
    if (measured < distance) low = mid; else high = mid;
  }
  return (low + high) / 2;
}
export function cubicExtrema(c: Cubic, axis: "x" | "y"): readonly number[] {
    const scale = Math.max(...c.map(p => Math.abs(p[axis])));
    if (!scale) return [];
    const [p0, p1, p2, p3] = c.map(p => p[axis] / scale), a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), d = p1 - p0;
    const roots: number[] = [];
    if (a === 0) { if (b !== 0) roots.push(-d / b); }
    else {
      const discriminant = b * b - 4 * a * d;
      if (discriminant >= 0) { const q = -.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant)); if (q === 0) roots.push(-b / (2 * a)); else roots.push(q / a, d / q); }
    }
    return roots.filter(t => t > 0 && t < 1).sort((a, b) => a - b);
}
/** Exact derivative extrema, rather than a control polygon or flattened-path box. */
export function cubicBounds(c: Cubic): Rectangle {
  let minX = Math.min(c[0].x, c[3].x), maxX = Math.max(c[0].x, c[3].x), minY = Math.min(c[0].y, c[3].y), maxY = Math.max(c[0].y, c[3].y);
  for (const axis of ["x", "y"] as const) for (const t of cubicExtrema(c, axis)) { const p = cubicPoint(c, t); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
