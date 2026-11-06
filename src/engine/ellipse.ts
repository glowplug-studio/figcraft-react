import type { EllipseNode, LayerNode } from "./document";
import { cornerPath, hasRoundedCorners, type PathCommand } from "./corners";
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
function arc(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number, rotation = 0): PathCommand[] {
  const sample = (angle: number): [number, number] => {
    const x = rx * Math.cos(angle), y = ry * Math.sin(angle);
    return [x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation)];
  };
  const p = sample(start), path: PathCommand[] = [["M", cx + p[0], cy + p[1]]];
  // Bound browser work for astronomical finite wire dimensions; ordinary sizes keep native tolerance.
  const count = Math.min(4096, Math.ceil(Math.max((1.1163 * Math.max(rx, ry) / .01) ** (1 / 6), 3.999999) * Math.abs(sweep) / TAU));
  const step = sweep / count, arm = 4 / 3 * Math.tan(Math.abs(step / 4)) * Math.sign(sweep);
  let angle = start, previous = p;
  for (let i = 0; i < count; i++) {
    const nextAngle = angle + step, next = sample(nextAngle), d0 = sample(angle + Math.PI / 2), d1 = sample(nextAngle + Math.PI / 2);
    path.push(["C", cx + previous[0] + arm * d0[0], cy + previous[1] + arm * d0[1], cx + next[0] - arm * d1[0], cy + next[1] - arm * d1[1], cx + next[0], cy + next[1]]);
    angle = nextAngle; previous = next;
  }
  return path;
}
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
    // A full native Ellipse starts on the SVD major axis, independently of arc.start/sign.
    const major = Math.max(rx, ry), minor = Math.min(rx, ry), rotation = ry > rx ? Math.PI / 2 : 0;
    const outer = arc(rx, ry, major, minor, 0, TAU, rotation);
    return inner <= 0 ? outer : [...outer, ...reverseCubics(arc(rx, ry, major * inner, minor * inner, 0, TAU, rotation))];
  }
  const path = arc(rx, ry, rx, ry, start, sweep);
  if (inner > 0) {
    const back = arc(rx, ry, rx * inner, ry * inner, start + sweep, -sweep), first = back[0];
    if (first[0] === "M") path.push(["L", first[1], first[2]]);
    path.push(...back.slice(1));
  } else path.push(["L", rx, ry]);
  path.push(["Z"]); return path;
}
const ellipsePaths = new Map<string, readonly PathCommand[]>();
export function shapePath(node: LayerNode): readonly PathCommand[] {
  if (node.kind !== "ellipse") return cornerPath(node);
  const key = `${node.width}:${node.height}:${node.start}:${node.sweep}:${node.inner}`;
  let path = ellipsePaths.get(key);
  if (!path) { path = ellipsePath(node.width, node.height, node); if (ellipsePaths.size >= 256) ellipsePaths.clear(); ellipsePaths.set(key, path); }
  return path;
}
export const hasShapePath = (node: LayerNode): boolean => node.kind === "ellipse" || hasRoundedCorners(node);
export function arcOf(node: EllipseNode): Arc { return { start: finiteArc(node.start), sweep: Math.max(-TAU, Math.min(TAU, finiteArc(node.sweep))), inner: Math.max(0, Math.min(1, finiteArc(node.inner))) }; }
