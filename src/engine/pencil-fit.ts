// Fitting decisions follow Kurbo 0.13.1 fit.rs/simplify.rs; independent TypeScript geometry.
// Copyright 2022 the Kurbo Authors. SPDX-License-Identifier: Apache-2.0 OR MIT
import { cubicLength, cubicPoint, type Cubic } from "./cubic";
import type { PathCommand } from "./corners";
import { pixelRound, type Point } from "./geometry";
import { cubicFitCandidates } from "./fit-candidates";
import { FittingPolyline } from "./fit-polyline";
import { fitCubicRoots } from "./fit-polynomial";

const distance2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const lineCubic = (a: Point, b: Point): Cubic => [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: b.x + (a.x - b.x) / 3, y: b.y + (a.y - b.y) / 3 }, b];

function tryLine(source: FittingPolyline, from: number, to: number, a: Point, b: Point, accuracy: number): Cubic | undefined {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  for (let i = 1; i <= 7; i++) {
    const p = source.sample(from + i * ((to - from) / 8)).point;
    const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
    if (distance2(p, { x: a.x + t * dx, y: a.y + t * dy }) > accuracy * accuracy) return;
  }
  return lineCubic(a, b);
}

/** Equal-source-parameter tangent rays, plus arc correspondence when curvature changes sharply. */
class FittingDistance {
  #samples: ReturnType<FittingPolyline["sample"]>[] = [];
  #spicy = false;
  #arc?: number[];
  constructor(private source: FittingPolyline, private from: number, private to: number) {
    let last: Point | undefined;
    for (let i = 0; i < 22; i++) {
      const sample = source.sample(from + i * ((to - from) / 21)), tangent = sample.tangent;
      if (last && Math.abs(tangent.x * last.y - tangent.y * last.x) > .2 * Math.abs(tangent.x * last.x + tangent.y * last.y)) this.#spicy = true;
      last = tangent; if (i > 0 && i < 21) this.#samples.push(sample);
    }
  }
  measure(curve: Cubic, accuracy2: number): number | undefined {
    const [a, b, c, d] = curve;
    const q1 = { x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) };
    const q2 = { x: 3 * c.x - 6 * b.x + 3 * a.x, y: 3 * c.y - 6 * b.y + 3 * a.y };
    const q3 = { x: d.x - a.x - 3 * (c.x - b.x), y: d.y - a.y - 3 * (c.y - b.y) };
    let maximum = 0;
    for (const { point, tangent } of this.#samples) {
      const dot = (p: Point) => p.x * tangent.x + p.y * tangent.y;
      const roots = fitCubicRoots(dot({ x: a.x - point.x, y: a.y - point.y }), dot(q1), dot(q2), dot(q3));
      let best = accuracy2 + 1;
      for (const t of roots) if (t >= 0 && t <= 1) best = Math.min(best, distance2(point, cubicPoint(curve, t)));
      maximum = Math.max(maximum, best); if (maximum > accuracy2) return;
    }
    if (!this.#spicy) return maximum;
    if (!this.#arc) {
      let length = 0; this.#arc = [];
      for (let i = 0; i < 21; i++) {
        for (let j = 0; j < 10; j++) {
          const tangent = this.source.sample(this.from + (this.to - this.from) / 210 * (i * 10 + j + .5)).derivative;
          length += Math.hypot(tangent.x, tangent.y);
        }
        if (i < 20) this.#arc.push(length);
      }
      this.#arc = this.#arc.map(value => value / length);
    }
    const length = cubicLength(curve, 1, 1e-9); maximum = 0;
    for (let i = 0; i < this.#samples.length; i++) {
      const desired = length * this.#arc[i]; let low = 0, high = 1, t = .5;
      for (let step = 0; step < 55; step++) {
        t = (low + high) / 2; const measured = cubicLength(curve, t, 1e-9);
        if (Math.abs(measured - desired) <= 1e-9 || t === low || t === high) break;
        if (measured < desired) low = t; else high = t;
      }
      maximum = Math.max(maximum, distance2(this.#samples[i].point, cubicPoint(curve, t)));
      if (!Number.isFinite(maximum) || maximum > accuracy2) return;
    }
    return maximum;
  }
}

function fitRange(source: FittingPolyline, from: number, to: number, accuracy: number): Cubic | undefined {
  const start = source.sample(from), end = source.sample(to), a = start.point, b = end.point;
  const dx = b.x - a.x, dy = b.y - a.y, chord2 = dx * dx + dy * dy, accuracy2 = accuracy * accuracy;
  if (chord2 <= accuracy2) return tryLine(source, from, to, a, b, accuracy);
  if (!Number.isFinite(chord2)) throw new Error("Pencil fitting geometry overflowed");
  const chordAngle = Math.atan2(dy, dx), wrap = (angle: number) => { const scaled = angle * (1 / Math.PI) * .5; return 2 * Math.PI * (scaled - pixelRound(scaled)); };
  const th0 = wrap(Math.atan2(start.tangent.y, start.tangent.x) - chordAngle), th1 = wrap(chordAngle - Math.atan2(end.tangent.y, end.tangent.x));
  let [area, x, y] = source.moments(from, to);
  area -= dx * (a.y + .5 * dy);
  x -= dx * (a.x * a.y + .5 * (a.x * dy + a.y * dx) + dy / 3 * dx);
  y -= dx * (a.y * a.y + a.y * dy + dy / 3 * dy);
  x -= a.x * area; y = .5 * y - a.y * area;
  const moment = dx * x + dy * y, inverse = 1 / chord2, metric = new FittingDistance(source, from, to);
  if (![area, x, y, moment].every(Number.isFinite)) throw new Error("Pencil fitting moments overflowed");
  let best: Cubic | undefined, bestError = Infinity;
  for (const { curve, startArm, endArm } of cubicFitCandidates(th0, th1, area * inverse, moment * inverse * inverse)) {
    const world = curve.map(p => ({ x: a.x + dx * p.x - dy * p.y, y: a.y + dy * p.x + dx * p.y })) as unknown as Cubic;
    if (!world.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
    const error = metric.measure(world, accuracy2); if (error === undefined) continue;
    const penalty = (arm: number) => 1 + Math.max(0, arm - .65) * 2;
    const penalised = error * Math.max(penalty(startArm), penalty(endArm)) ** 2;
    if (penalised < accuracy2 && penalised < bestError) { best = world; bestError = penalised; }
  }
  return best;
}

/** Midpoint subdivision in native order, with an explicit stack instead of recursive JS calls. */
export function fitPencilRun(points: readonly Point[], accuracy = .75): readonly Cubic[] {
  if (!Number.isFinite(accuracy) || accuracy <= 0) throw new Error("Fitting accuracy must be positive and finite");
  const source = new FittingPolyline(points), stack: [number, number][] = [[0, 1]], curves: Cubic[] = [];
  while (stack.length) {
    const [from, to] = stack.pop()!, curve = fitRange(source, from, to, accuracy);
    if (curve) { curves.push(curve); continue; }
    const middle = .5 * (from + to);
    if (middle === from || middle === to) curves.push(lineCubic(source.sample(from).point, source.sample(to).point));
    else stack.push([middle, to], [from, middle]);
  }
  return curves;
}

/** Native Pencil's simplify_bezpath(line samples,0.75,default): preserve corners, fit smooth runs. */
export function simplifyPencil(points: readonly Point[]): readonly PathCommand[] {
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Pencil points must remain finite");
  if (!points.length) return [];
  let run: Point[] = [points[0]], lastDirection: Point | undefined;
  const path: PathCommand[] = [];
  const flush = () => {
    if (run.length < 2) return;
    if (!path.length) path.push(["M", run[0].x, run[0].y]);
    if (run.length === 2) path.push(["L", run[1].x, run[1].y]);
    else for (const [, a, b, c] of fitPencilRun(run)) path.push(["C", a.x, a.y, b.x, b.y, c.x, c.y]);
  };
  for (let i = 1; i < points.length; i++) {
    const previous = run.at(-1)!, point = points[i];
    if (previous.x === point.x && previous.y === point.y) continue;
    const direction = { x: point.x - previous.x, y: point.y - previous.y };
    if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) throw new Error("Pencil segment overflowed");
    if (lastDirection && Math.abs(lastDirection.x * direction.y - lastDirection.y * direction.x) > Math.abs(lastDirection.x * direction.x + lastDirection.y * direction.y) * 1e-3) { flush(); run = [previous]; }
    run.push(point); lastDirection = direction;
  }
  flush();
  if (path.some(command => command.slice(1).some(value => typeof value === "number" && !Number.isFinite(value)))) throw new Error("Pencil fitting geometry overflowed");
  return path;
}
