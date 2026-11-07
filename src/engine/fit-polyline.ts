import type { Point } from "./geometry";

export type Moments = readonly [number, number, number];
/** Analytical ∫y dx, ∫xy dx, ∫y² dx for a directed line. */
export function lineMoments(a: Point, b: Point): Moments {
  const dx = b.x - a.x, dy = b.y - a.y;
  return [dx * (a.y + dy / 2), dx * (a.x * a.y + (a.x * dy + a.y * dx) / 2 + dx * dy / 3), dx * (a.y * a.y + a.y * dy + dy * dy / 3)];
}

/** Equal parameter span per non-degenerate line, as SimplifyBezPath; prefix moments are O(1). */
export class FittingPolyline {
  readonly points: readonly Point[];
  #prefix: Moments[] = [[0, 0, 0]];
  constructor(points: readonly Point[]) {
    if (points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Fitting needs finite line segments");
    this.points = Object.freeze(points.map(p => Object.freeze({ ...p })));
    for (let i = 1; i < points.length; i++) {
      const next = lineMoments(points[i - 1], points[i]), before = this.#prefix.at(-1)!;
      const sum: Moments = [before[0] + next[0], before[1] + next[1], before[2] + next[2]];
      if (!sum.every(Number.isFinite)) throw new Error("Pencil fitting moments overflowed");
      this.#prefix.push(sum);
    }
  }
  sample(t: number): { point: Point; tangent: Point; derivative: Point } {
    const count = this.points.length - 1, position = t * count, rawIndex = Math.floor(position), index = Math.min(count - 1, rawIndex), part = rawIndex === count ? 1 : position - index;
    const a = this.points[index], b = this.points[index + 1], tangent = { x: b.x - a.x, y: b.y - a.y };
    return { point: part === 0 ? { ...a } : part === 1 ? { ...b } : { x: a.x + part * tangent.x, y: a.y + part * tangent.y }, tangent, derivative: { x: tangent.x * count, y: tangent.y * count } };
  }
  moments(from: number, to: number): Moments {
    const prefixAt = (t: number): Moments => {
      const count = this.points.length - 1, position = t * count, index = Math.min(count, Math.floor(position)), prefix = this.#prefix[index];
      if (index === count || position === index) return prefix;
      const partial = lineMoments(this.points[index], this.sample(t).point);
      return [prefix[0] + partial[0], prefix[1] + partial[1], prefix[2] + partial[2]];
    };
    const a = prefixAt(from), b = prefixAt(to); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  }
}
