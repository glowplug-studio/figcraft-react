import type { EllipseNode, LayerNode } from "./document";
import type { PathCommand } from "./corners";
import { parseNumber } from "./parameters";

export interface Arc { readonly start: number; readonly sweep: number; readonly inner: number }
export const TAU = 2 * Math.PI;
export const finiteArc = (n: number): number => Number.isFinite(n) ? n : 0;
export const fullSweep = (sweep: number): boolean => Math.abs(finiteArc(sweep)) >= TAU - 1e-9;
export const modulo = (n: number, modulus: number): number => ((n % modulus) + modulus) % modulus;
export const isArcKey = (key: string): boolean => ["arcStart", "arcSweep", "arcInner"].includes(key);
export function setArc(node: LayerNode, props: Record<string, unknown>): LayerNode {
  const keys = Object.keys(props).filter(isArcKey).sort(); if (!keys.length) return node;
  if (node.kind !== "ellipse") throw new Error("Arc properties apply to ellipses");
  let { start, sweep, inner } = node;
  for (const key of keys) {
    let value = parseNumber(props[key], key);
    if (key === "arcStart") start = value * (Math.PI / 180);
    else if (key === "arcSweep") sweep = Math.max(-360, Math.min(360, value)) * (Math.PI / 180);
    else { if (value > 1 || typeof props[key] === "string" && (props[key] as string).trim().endsWith("%")) value /= 100; inner = Math.max(0, Math.min(.99, value)); }
  }
  return start === node.start && sweep === node.sweep && inner === node.inner ? node : Object.freeze({ ...node, start, sweep, inner });
}
/** Independent Kurbo0.13.1 Arc approximation, using the native0.01 tolerance. */
export function ellipticalArcPath(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number, rotation = 0, tolerance = .01): PathCommand[] {
  const sample = (angle: number): [number, number] => {
    const x = rx * Math.cos(angle), y = ry * Math.sin(angle);
    return [x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation)];
  };
  const p = sample(start), path: PathCommand[] = [["M", cx + p[0], cy + p[1]]];
  // Bound browser work for astronomical finite wire dimensions; ordinary sizes keep native tolerance.
  const count = Math.min(4096, Math.ceil(Math.max((1.1163 * Math.max(rx, ry) / tolerance) ** (1 / 6), 3.999999) * Math.abs(sweep) / TAU));
  const step = sweep / count, arm = 4 / 3 * Math.tan(Math.abs(step / 4)) * Math.sign(sweep);
  let angle = start, previous = p;
  for (let i = 0; i < count; i++) {
    const nextAngle = angle + step, next = sample(nextAngle), d0 = sample(angle + Math.PI / 2), d1 = sample(nextAngle + Math.PI / 2);
    path.push(["C", cx + previous[0] + arm * d0[0], cy + previous[1] + arm * d0[1], cx + next[0] - arm * d1[0], cy + next[1] - arm * d1[1], cx + next[0], cy + next[1]]);
    angle = nextAngle; previous = next;
  }
  return path;
}
/** Handle length of a quarter-circle cubic as a fraction of its radius (native `K`). */
const circleHandle = 0.5522847498307934;
function reverseCubics(path: readonly PathCommand[]): PathCommand[] {
  const ends: [number, number][] = [], curves: Extract<PathCommand, readonly ["C", ...number[]]>[] = [];
  for (const c of path) { if (c[0] === "M") ends.push([c[1], c[2]]); else if (c[0] === "C") { curves.push(c); ends.push([c[5], c[6]]); } }
  if (!ends.length) return [];
  const result: PathCommand[] = [["M", ...ends.at(-1)!]];
  for (let i = curves.length - 1; i >= 0; i--) { const c = curves[i]; result.push(["C", c[3], c[4], c[1], c[2], ...ends[i]]); }
  return result;
}
export function ellipsePath(width: number, height: number, data: Arc): readonly PathCommand[] {
  const rx = Math.max(0, finiteArc(width)) / 2, ry = Math.max(0, finiteArc(height)) / 2;
  const start = finiteArc(data.start), sweep = Math.max(-TAU, Math.min(TAU, finiteArc(data.sweep))), inner = Math.max(0, Math.min(1, finiteArc(data.inner)));
  if (fullSweep(sweep)) {
    // Native `whole`: four cubics through the right, bottom, left and top extremes (clockwise from 3 o'clock),
    // the four anchors an ellipse has when edited as a vector, independently of arc.start/sign. The contour is closed.
    const whole = (a: number, b: number): PathCommand[] => {
      const kx = a * circleHandle, ky = b * circleHandle;
      return [["M", rx + a, ry], ["C", rx + a, ry + ky, rx + kx, ry + b, rx, ry + b], ["C", rx - kx, ry + b, rx - a, ry + ky, rx - a, ry],
        ["C", rx - a, ry - ky, rx - kx, ry - b, rx, ry - b], ["C", rx + kx, ry - b, rx + a, ry - ky, rx + a, ry], ["Z"]];
    };
    const outer = whole(rx, ry);
    // A ring: outer clockwise, inner counter-clockwise.
    return inner <= 0 ? outer : [...outer, ...reverseCubics(whole(rx * inner, ry * inner)), ["Z"]];
  }
  const path = ellipticalArcPath(rx, ry, rx, ry, start, sweep);
  if (inner > 0) {
    const back = ellipticalArcPath(rx, ry, rx * inner, ry * inner, start + sweep, -sweep), first = back[0];
    if (first[0] === "M") path.push(["L", first[1], first[2]]);
    path.push(...back.slice(1));
  } else path.push(["L", rx, ry]);
  path.push(["Z"]); return path;
}
export function arcOf(node: EllipseNode): Arc { return { start: finiteArc(node.start), sweep: Math.max(-TAU, Math.min(TAU, finiteArc(node.sweep))), inner: Math.max(0, Math.min(1, finiteArc(node.inner))) }; }
