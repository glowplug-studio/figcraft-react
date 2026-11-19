import type { Point } from "./geometry";

export type Moments = readonly [number, number, number];
/** Analytical ∫y dx, ∫xy dx, ∫y² dx for a directed line. */
export function lineMoments(a: Point, b: Point): Moments {
  const dx = b.x - a.x, dy = b.y - a.y;
  return [dx * (a.y + dy / 2), dx * (a.x * a.y + (a.x * dy + a.y * dx) / 2 + dx * dy / 3), dx * (a.y * a.y + a.y * dy + dy * dy / 3)];
}
