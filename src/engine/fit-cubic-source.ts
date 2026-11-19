// Kurbo 0.13.1 SimplifyBezPath as a fit source: equal parameter span per segment, analytic moments and Kurbo's
// own evaluation order, in independent TypeScript (see NOTICE). The operation order is deliberate: on nearly
// straight input the fit's coefficients are rounding noise, and the last bit decides which candidate wins.
import type { Cubic } from "./cubic";
import type { Point } from "./geometry";
import type { Moments } from "./fit-polyline";
import type { FitSource } from "./pencil-fit";

/** Kurbo `CubicBez::eval`. */
export function evalCubic(c: Cubic, t: number): Point {
  const mt = 1 - t, a = mt * mt * mt, b = mt * mt * 3, d = mt * 3;
  return { x: c[0].x * a + (c[1].x * b + (c[2].x * d + c[3].x * t) * t) * t, y: c[0].y * a + (c[1].y * b + (c[2].y * d + c[3].y * t) * t) * t };
}
/** Kurbo `CubicBez::deriv().eval(t)`: the derivative as a quadratic, evaluated in its order. */
export function derivCubic(c: Cubic, t: number): Point {
  const mt = 1 - t, a = mt * mt, b = mt * 2;
  const x0 = 3 * (c[1].x - c[0].x), x1 = 3 * (c[2].x - c[1].x), x2 = 3 * (c[3].x - c[2].x);
  const y0 = 3 * (c[1].y - c[0].y), y1 = 3 * (c[2].y - c[1].y), y2 = 3 * (c[3].y - c[2].y);
  return { x: x0 * a + (x1 * b + x2 * t) * t, y: y0 * a + (y1 * b + y2 * t) * t };
}
/** Kurbo `CubicBez::subsegment`. */
export function subsegment(c: Cubic, t0: number, t1: number): Cubic {
  const p0 = evalCubic(c, t0), p3 = evalCubic(c, t1), scale = (t1 - t0) * (1 / 3), d0 = derivCubic(c, t0), d1 = derivCubic(c, t1);
  return [p0, { x: p0.x + scale * d0.x, y: p0.y + scale * d0.y }, { x: p3.x - scale * d1.x, y: p3.y - scale * d1.y }, p3];
}
/** Kurbo `simplify::moment_integrals`: ∫y dx, ∫xy dx and ∫y² dx along a cubic, in closed form. */
export function momentIntegrals(c: Cubic): Moments {
  const x0 = c[0].x, y0 = c[0].y;
  const x1 = c[1].x - x0, y1 = c[1].y - y0, x2 = c[2].x - x0, y2 = c[2].y - y0, x3 = c[3].x - x0, y3 = c[3].y - y0;
  const r0 = 3 * x1, r1 = 3 * y1, r2 = x2 * y3, r3 = x3 * y2, r4 = x3 * y3, r5 = 27 * y1, r6 = x1 * x2, r7 = 27 * y2, r8 = 45 * r2, r9 = 18 * x3;
  const r10 = x1 * y1, r11 = 30 * x1, r12 = 45 * x3, r13 = x2 * y1, r14 = 45 * r3, r15 = x1 * x1, r16 = 18 * y3, r17 = x2 * x2, r18 = 45 * y3;
  const r19 = x3 * x3, r20 = 30 * y1, r21 = y2 * y2, r22 = y3 * y3, r23 = y1 * y1;
  const a = -r0 * y2 - r0 * y3 + r1 * x2 + r1 * x3 - 6 * r2 + 6 * r3 + 10 * r4;
  const lift = x3 * y0, area = a * .05 + lift;
  const x = r10 * r9 - r11 * r4 + r12 * r13 + r14 * x2 - r15 * r16 - r15 * r7 - r17 * r18
    + r17 * r5 + r19 * r20 + 105 * r19 * y2 + 280 * r19 * y3 - 105 * r2 * x3 + r5 * r6 - r6 * r7 - r8 * x1;
  const y = -r10 * r16 - r10 * r7 - r11 * r22 + r12 * r21 + r13 * r7 + r14 * y1 - r18 * x1 * y2
    + r20 * r4 - 27 * r21 * x1 - 105 * r22 * x2 + 140 * r22 * x3 + r23 * r9 + 27 * r23 * x2 + 105 * r3 * y3 - r8 * y2;
  return [area, x * (1 / 840) + x0 * area + .5 * x3 * lift, y * (1 / 420) + y0 * a * .1 + y0 * lift];
}

export class CubicFitSource implements FitSource {
  /** Running totals through each segment, as Kurbo stores them. */
  readonly #through: Moments[] = [];
  constructor(private readonly curves: readonly Cubic[]) {
    if (!curves.length) throw new Error("Curve fitting requires at least one segment");
    let a = 0, x = 0, y = 0;
    for (const curve of curves) {
      const m = momentIntegrals(curve); a += m[0]; x += m[1]; y += m[2];
      if (![a, x, y].every(Number.isFinite)) throw new Error("Curve fitting moments overflowed");
      this.#through.push([a, x, y]);
    }
  }
  /** Kurbo `scale`: the segment a parameter falls in and where within it. */
  #scale(t: number): readonly [number, number] { const at = t * this.curves.length, floor = Math.floor(at); return [floor, at - floor]; }
  sample(t: number) {
    let [index, local] = this.#scale(t);
    if (index === this.curves.length) { index--; local = 1; }
    const curve = this.curves[index], tangent = derivCubic(curve, local), count = this.curves.length;
    return { point: evalCubic(curve, local), tangent, derivative: { x: tangent.x * count, y: tangent.y * count } };
  }
  #within(index: number, from: number, to: number): Moments {
    return to === from ? [0, 0, 0] : momentIntegrals(subsegment(this.curves[index], from, to));
  }
  moments(from: number, to: number): Moments {
    const [i0, t0] = this.#scale(from), [i1, t1] = this.#scale(to);
    if (i0 === i1) return this.#within(i0, t0, t1);
    const left = this.#within(i0, t0, 1), right = this.#within(i1, 0, t1);
    let a = left[0] + right[0], x = left[1] + right[1], y = left[2] + right[2];
    if (i1 > i0 + 1) {
      const before = this.#through[i0], after = this.#through[i1 - 1];
      a += after[0] - before[0]; x += after[1] - before[1]; y += after[2] - before[2];
    }
    return [a, x, y];
  }
}
