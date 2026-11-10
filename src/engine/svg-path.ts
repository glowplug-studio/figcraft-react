import type { CurveElement } from "./curve-flatten";
import type { PathCommand } from "./corners";
import { ellipticalArcPath, TAU } from "./ellipse";
import type { Point } from "./geometry";
import { networkFromPath, networkFromPoints, type VectorNetwork } from "./vector-network";
import { pathBounds } from "./vector-path";

const invalid = (): never => { throw new Error("path is not valid SVG path data"); };
const tooLarge = (): never => { throw new Error("path has coordinates too large to draw"); };
function svgArc(from: Point, to: Point, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean): readonly PathCommand[] {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx <= 1e-5 || ry <= 1e-5 || from.x === to.x && from.y === to.y) return [["L", to.x, to.y]];
  const phi = rotation % TAU, cos = Math.cos(phi), sin = Math.sin(phi), dx = (from.x - to.x) / 2, dy = (from.y - to.y) / 2;
  const x = cos * dx + sin * dy, y = -sin * dx + cos * dy, ratio = x * x / (rx * rx) + y * y / (ry * ry);
  if (ratio > 1) { const scale = Math.sqrt(ratio); rx *= scale; ry *= scale; }
  const rxy = rx * ry, rxy0 = rx * y, ryx0 = ry * x, squares = rxy0 * rxy0 + ryx0 * ryx0;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.abs((rxy * rxy - squares) / squares)), cx0 = factor * rxy0 / ry, cy0 = -factor * ryx0 / rx;
  const cx = cos * cx0 - sin * cy0 + (from.x + to.x) / 2, cy = sin * cx0 + cos * cy0 + (from.y + to.y) / 2;
  const start = Math.atan2((y - cy0) / ry, (x - cx0) / rx), end = Math.atan2((-y - cy0) / ry, (-x - cx0) / rx);
  let span = (end - start) % TAU; if (sweep && span < 0) span += TAU; else if (!sweep && span > 0) span -= TAU;
  if (![cx, cy, rx, ry, start, span].every(Number.isFinite)) return tooLarge();
  return ellipticalArcPath(cx, cy, rx, ry, start, span, rotation, .1).slice(1);
}
/** Independent reader of the native Kurbo0.13.1 command/lexer behaviour, including its best-effort trailing-byte termination. */
export function parseSvgPath(data: string): readonly PathCommand[];
export function parseSvgPath(data: string, preserveQuadratics: true, syntax?:"svg"): readonly CurveElement[];
export function parseSvgPath(data: string, preserveQuadratics: false, syntax:"svg"): readonly PathCommand[];
export function parseSvgPath(data: string, preserveQuadratics = false, syntax:"kurbo"|"svg"="kurbo"): readonly CurveElement[] {
  for (const token of data.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g)) {
    if (Math.abs(Number(token[0]))>1e9) return tooLarge();
  }
  let at = 0, last = "", pen: Point = { x: 0, y: 0 }, first = pen, control: Point | undefined, implicitMove: Point | undefined;
  const path: CurveElement[] = [];
  const whitespace = () => { while (at < data.length && /[ \t\n\f\r]/.test(data[at])) at++; };
  const comma = () => { whitespace(); if (data[at] === ",") at++; };
  const number = (): number => {
    whitespace(); const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(data.slice(at));
    if (!match) return invalid(); at += match[0].length;
    if (data[at] === "e" || data[at] === "E") return invalid();
    const value = Number(match[0]); if (!Number.isFinite(value)) return tooLarge(); return value;
  };
  const pair = (): Point => { const x = number(); comma(); const y = number(); comma(); return { x, y }; };
  const point = (relative: boolean): Point => { const p = pair(); return relative ? { x: p.x + pen.x, y: p.y + pen.y } : p; };
  const flag = (): boolean => { whitespace(); const c = data[at++]; if (c !== "0" && c !== "1") return invalid(); comma(); return c === "1"; };
  const reflect = (): Point => control ? { x: 2 * pen.x - control.x, y: 2 * pen.y - control.y } : pen;
  const quad = (c: Point, end: Point) => { path.push(["C", pen.x + (c.x - pen.x) * 2 / 3, pen.y + (c.y - pen.y) * 2 / 3, end.x + (c.x - end.x) * 2 / 3, end.y + (c.y - end.y) * 2 / 3, end.x, end.y]); };
  while (true) {
    whitespace(); if (at >= data.length) break;
    let cmd: string;
    if (/[a-zA-Z]/.test(data[at])) cmd = data[at++];
    else if (last && /[-.0-9]/.test(data[at])) cmd = last;
    else break;
    const upper = cmd.toUpperCase(), relative = cmd !== upper;
    if (upper !== "M") { if (!path.length) return invalid(); if (implicitMove) { path.push(["M", implicitMove.x, implicitMove.y]); implicitMove = undefined; } }
    if (upper === "M") { implicitMove = undefined; pen = first = point(relative); path.push(["M", pen.x, pen.y]); control = pen; last = relative ? "l" : "L"; }
    else if (upper === "L") { pen = point(relative); path.push(["L", pen.x, pen.y]); control = pen; last = cmd; }
    else if (upper === "H" || upper === "V") { const n = number(); comma(); pen = upper === "H" ? { x: n + (relative ? pen.x : 0), y: pen.y } : { x: pen.x, y: n + (relative ? pen.y : 0) }; path.push(["L", pen.x, pen.y]); control = pen; last = cmd; }
    else if (upper === "C" || upper === "S") { const a = upper === "S" ? (syntax==="svg" && !/^[cs]$/i.test(last) ? pen : reflect()) : point(relative), b = point(relative), end = point(relative); path.push(["C", a.x, a.y, b.x, b.y, end.x, end.y]); control = b; pen = end; last = cmd; }
    else if (upper === "Q" || upper === "T") { const c = upper === "T" ? (syntax==="svg" && !/^[qt]$/i.test(last) ? pen : reflect()) : point(relative), end = point(relative); if (preserveQuadratics) path.push(["Q",c.x,c.y,end.x,end.y]); else quad(c, end); control = c; pen = end; last = cmd; }
    else if (upper === "A") { const radii = pair(), rotation = number() * (Math.PI / 180); comma(); const large = flag(), sweep = flag(), end = point(relative); for (const c of svgArc(pen, end, radii.x, radii.y, rotation, large, sweep)) path.push(c); pen = end; control = pen; last = cmd; }
    else if (upper === "Z") { path.push(["Z"]); pen = first; implicitMove = first; if (syntax==="svg") {last="";control=undefined;} }
    else return invalid();
  }
  if (path.some(c => c.slice(1).some(value => typeof value !== "number" || !Number.isFinite(value)))) return tooLarge();
  return Object.freeze(path.map(c => Object.freeze(c)));
}
export function vectorScale(width: number | undefined, height: number | undefined, bw: number, bh: number): readonly [number, number] {
  const fit = (asked: number | undefined, have: number, axis: string): number => {
    if (asked === undefined) return 1;
    if (have <= 1e-9) { if (asked === 0) return 1; throw new Error(`${axis} cannot size a path with no ${axis === "width" ? "horizontal" : "vertical"} extent`); }
    if (asked > 0 && Number.isFinite(asked / have)) return asked / have;
    throw new Error(`${axis} must be a positive, finite size`);
  };
  if (width !== undefined && height !== undefined) return [fit(width, bw, "width"), fit(height, bh, "height")];
  const scale = width !== undefined ? fit(width, bw, "width") : height !== undefined ? fit(height, bh, "height") : 1; return [scale, scale];
}
export interface VectorShape { readonly network: VectorNetwork; readonly width: number; readonly height: number; readonly offset: Point }
export function pathNetwork(data: string, width?: number, height?: number): VectorShape {
  const path = parseSvgPath(data), box = pathBounds(path);
  if (!box || box.width <= 1e-9 && box.height <= 1e-9) throw new Error("path draws nothing: a vector needs a visible line or area");
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return tooLarge();
  const [sx, sy] = vectorScale(width, height, box.width, box.height);
  // Translation precedes scaling so the original box offset remains unscaled in placement.
  const local: PathCommand[] = path.map(c => c[0] === "Z" ? c : c[0] === "C"
    ? ["C", (c[1] - box.x) * sx, (c[2] - box.y) * sy, (c[3] - box.x) * sx, (c[4] - box.y) * sy, (c[5] - box.x) * sx, (c[6] - box.y) * sy]
    : [c[0], (c[1] - box.x) * sx, (c[2] - box.y) * sy]);
  if (local.some(c => c.slice(1).some(n => typeof n !== "number" || !Number.isFinite(n)))) return tooLarge();
  const network = networkFromPath(local);
  if (network.segments.some(s => ![...s.ta, ...s.tb].every(Number.isFinite))) return tooLarge();
  if (!network.segments.length) throw new Error("path draws nothing: a vector needs a visible line or area");
  const w = box.width * sx, h = box.height * sy; if (![w, h].every(Number.isFinite)) return tooLarge();
  return { network, width: w, height: h, offset: { x: box.x, y: box.y } };
}
export function pointsNetwork(points: readonly Point[], closed: boolean, width?: number, height?: number): VectorShape {
  if (points.length < 2) throw new Error("points needs at least two [x, y] pairs");
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const bw = x1 - x0, bh = y1 - y0;
  if (![x0, y0, bw, bh].every(Number.isFinite)) return tooLarge();
  if (bw <= 1e-9 && bh <= 1e-9) throw new Error("points draws nothing: a vector needs a visible line or area");
  const [sx, sy] = vectorScale(width, height, bw, bh), local = points.map(p => ({ x: (p.x - x0) * sx, y: (p.y - y0) * sy }));
  if (local.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !Number.isFinite(bw * sx) || !Number.isFinite(bh * sy)) return tooLarge();
  return { network: networkFromPoints(local, closed), width: bw * sx, height: bh * sy, offset: { x: x0, y: y0 } };
}
