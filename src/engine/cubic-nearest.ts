import { cubicPoint, type Cubic } from "./cubic";
import type { Point } from "./geometry";

const evaluate = (coefficients: readonly number[], t: number): number => {
  let result = 0; for (let i = coefficients.length - 1; i >= 0; i--) result = result * t + coefficients[i]; return result;
};
/** Derivative roots partition [0,1] into monotone intervals, including repeated roots. */
function roots(coefficients: readonly number[]): number[] {
  const p = [...coefficients]; while (p.length > 1 && p[p.length - 1] === 0) p.pop();
  if (p.length < 2) return [];
  if (p.length === 2) { const t = -p[0] / p[1]; return t >= 0 && t <= 1 ? [t] : []; }
  const cuts = [0, ...roots(p.slice(1).map((c, i) => c * (i + 1))).filter(t => t > 0 && t < 1), 1];
  const out: number[] = [], epsilon = p.reduce((sum, c) => sum + Math.abs(c), 0) * Number.EPSILON * 16;
  const add = (t: number) => { if (!out.some(v => Math.abs(v - t) <= Number.EPSILON * 8)) out.push(t); };
  for (const t of cuts) if (Math.abs(evaluate(p, t)) <= epsilon) add(t);
  for (let i = 1; i < cuts.length; i++) {
    let low = cuts[i - 1], high = cuts[i], a = evaluate(p, low); const b = evaluate(p, high);
    if (a === 0 || b === 0 || (a < 0) === (b < 0)) continue;
    for (let step = 0; step < 56; step++) {
      const mid = (low + high) / 2, value = evaluate(p, mid);
      if (mid === low || mid === high || value === 0) { low = high = mid; break; }
      if ((a < 0) === (value < 0)) { low = mid; a = value; } else high = mid;
    }
    add((low + high) / 2);
  }
  return out.sort((a, b) => a - b);
}

/** Global nearest point on the cubic, without a flattening resolution or sampling budget. */
export function nearestCubic(c: Cubic, point: Point): { t: number; distance: number } | undefined {
  if (![...c, point].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return undefined;
  // Translate before normalising where subtraction is representable, retaining small local detail.
  let relative = c.map(p => ({ x: p.x - point.x, y: p.y - point.y }));
  let scale = Math.max(...relative.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
  if (!Number.isFinite(scale)) {
    scale = Math.max(...[...c, point].flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
    relative = c.map(p => ({ x: p.x / scale - point.x / scale, y: p.y / scale - point.y / scale }));
  } else if (scale) relative = relative.map(p => ({ x: p.x / scale, y: p.y / scale }));
  if (!scale) return { t: 0, distance: 0 };
  const [a, b, d, e] = relative;
  const q = [a, { x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) },
    { x: 3 * (a.x - 2 * b.x + d.x), y: 3 * (a.y - 2 * b.y + d.y) },
    { x: -a.x + 3 * b.x - 3 * d.x + e.x, y: -a.y + 3 * b.y - 3 * d.y + e.y }];
  const coefficients = Array<number>(6).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 1; j < 4; j++) coefficients[i + j - 1] += j * (q[i].x * q[j].x + q[i].y * q[j].y);
  const normalised: Cubic = [relative[0], relative[1], relative[2], relative[3]];
  let t = 0, distance = Infinity;
  for (const candidate of [...roots(coefficients), 0, 1]) {
    const p = cubicPoint(normalised, candidate), d = Math.hypot(p.x, p.y);
    if (d < distance) { t = candidate; distance = d; }
  }
  return { t, distance: distance * scale };
}
