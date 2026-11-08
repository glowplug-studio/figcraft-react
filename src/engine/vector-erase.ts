import { cubicPart, cubicPoint, type Cubic } from "./cubic";
import { nearestCubic } from "./cubic-nearest";
import type { Point } from "./geometry";
import { removeSegments, splitSegment } from "./vector-edit-ops";
import { networkCubic, type VectorNetwork } from "./vector-network";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The first interval strictly inside the brush. A nearest-point check catches short crossings between samples. */
function firstInside(curve: Cubic, centre: Point, radius: number): readonly [number, number] | undefined {
  const cutoff = radius * (1 - 1e-9) - 1e-9;
  if (cutoff <= 0 || curve.every(p => p.x < centre.x - cutoff) || curve.every(p => p.x > centre.x + cutoff)
    || curve.every(p => p.y < centre.y - cutoff) || curve.every(p => p.y > centre.y + cutoff)) return;
  const at = (t: number) => distance(cubicPoint(curve, t), centre);
  // Return the outside endpoint. Previously split endpoints must stay outside the next pass.
  function boundary(a: number, b: number, insideA: boolean) {
    for (let j = 0; j < 30; j++) {
      const mid = (a + b) / 2;
      if ((at(mid) < cutoff) === insideA) a = mid; else b = mid;
    }
    return insideA ? b : a;
  }
  const count = 64;
  const reach = 3 * Math.max(distance(curve[1], curve[0]), distance(curve[2], curve[1]), distance(curve[3], curve[2])) / count;
  let previous = at(0), start = previous < cutoff ? 0 : undefined;
  for (let i = 1; i <= count; i++) {
    const a = (i - 1) / count, b = i / count, current = at(b);
    if (start !== undefined) {
      if (current >= cutoff) return [start, boundary(a, b, true)];
    } else if (current < cutoff) {
      start = boundary(a, b, false);
    } else if (Math.min(previous, current) <= radius + reach) {
      const near = nearestCubic(cubicPart(curve, a, b), centre);
      if (near && near.t > 0 && near.t < 1) {
        const m = a + (b - a) * near.t;
        if (at(m) < cutoff) return [boundary(a, m, false), boundary(m, b, true)];
      }
    }
    previous = current;
  }
  return start === undefined ? undefined : [start, 1];
}

/** Split and remove in native segment order; each split changes the next pass's indices. */
export function eraseVector(net: VectorNetwork, centre: Point, radius: number): VectorNetwork {
  if (![centre.x, centre.y, radius].every(Number.isFinite) || radius <= 0) return net;
  let current = net;
  for (let pass = 0; pass < 10_000; pass++) {
    let range: readonly [number, number] | undefined, segment = 0;
    for (; segment < current.segments.length; segment++) {
      const curve = networkCubic(current, segment);
      if (curve && (range = firstInside(curve, centre, radius))) break;
    }
    if (!range) break;
    const [a, b] = range;
    if (a <= .01 && b >= .99) current = removeSegments(current, [segment]);
    else {
      const split = splitSegment(current, segment, a <= .01 ? b : a);
      if (!split) break;
      current = split.network;
      if (a <= .01) current = removeSegments(current, [segment]);
      else if (b >= .99) current = removeSegments(current, [current.segments.length - 1]);
    }
  }
  return current;
}
