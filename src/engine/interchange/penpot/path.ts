import { inverse, multiply, type Affine } from "../../affine";
import type { CurveElement } from "../../curve-flatten";
import type { PathCommand } from "../../corners";
import { parseSvgPath } from "../../svg-path";
import { bake, cubics } from "../../vector-drawable/geometry";
import { pathBounds } from "../../vector-path";
import { networkFromPath } from "../../vector-network";
import { object, type JsonObject } from "../rest/values";
import { numberField as num } from "./values";

type Point = readonly [number, number];
type Warn = (s: string) => void;

function arc(from: Point, to: Point, args: JsonObject, result: CurveElement[]) {
  let rx = Math.abs(num(args, "rx", 0)), ry = Math.abs(num(args, "ry", 0));
  if (rx < 1e-9 || ry < 1e-9) { result.push(["L", ...to]); return true; }
  if (Math.abs(from[0] - to[0]) < 1e-9 && Math.abs(from[1] - to[1]) < 1e-9) return true;
  const degrees = num(args, "xAxisRotation", 0) % 360;
  const phi = (degrees < 0 ? degrees + 360 : degrees) * Math.PI / 180, sin = Math.sin(phi), cos = Math.cos(phi);
  const dx = (from[0] - to[0]) * 0.5, dy = (from[1] - to[1]) * 0.5;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = (xp/rx)**2 + (yp/ry)**2;
  if (lambda > 1) {rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda);}
  const a = rx * rx * ry * ry, b = rx * rx * yp * yp + ry * ry * xp * xp;
  if (b <= 1e-24 || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  const large = args.largeArcFlag === true || args.largeArcFlag === 1, sweep = args.sweepFlag === true || args.sweepFlag === 1;
  const scale = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, a-b)/b);
  const cxp = scale * rx * yp / ry, cyp = -scale * ry * xp / rx;
  const cx = (from[0] + to[0])/2 + cos * cxp - sin * cyp, cy = (from[1] + to[1])/2 + sin * cxp + cos * cyp;
  const sx = (xp-cxp)/rx, sy = (yp-cyp)/ry, ex = (-xp-cxp)/rx, ey = (-yp-cyp)/ry;
  const start = Math.atan2(sy, sx);
  let delta = Math.atan2(sx*ey-sy*ex, sx*ex+sy*ey);
  if (sweep && delta < 0) delta += 2*Math.PI;
  if (!sweep && delta > 0) delta -= 2*Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(delta)/(Math.PI/2))), step = delta/count, k = 4/3 * Math.tan(step/4);
  let last = from;
  for (let i = 0; i < count; i++) {
    const t = start+step*i, u = t+step;
    const c = Math.cos(u), s = Math.sin(u);
    const end: Point = i+1 === count ? to : [cx + rx*cos*c - ry*sin*s, cy + rx*sin*c + ry*cos*s];
    result.push(["C", last[0]+k*(-rx*cos*Math.sin(t)-ry*sin*Math.cos(t)), last[1]+k*(-rx*sin*Math.sin(t)+ry*cos*Math.cos(t)),
      end[0]-k*(-rx*cos*s-ry*sin*c), end[1]-k*(-rx*sin*s+ry*cos*c), ...end]);
    last = end;
  }
  return true;
}

const aliases: Record<string,string> = {"move-to":"M", "line-to":"L", "line-to-horizontal":"H", "line-to-vertical":"V", "curve-to":"C",
  "smooth-curve-to":"S", "quadratic-bezier-curve-to":"Q", "smooth-quadratic-bezier-curve-to":"T", "elliptical-arc":"A", "close-path":"Z"};
const translate = (x: number,y: number): Affine => [1,0,0,1,x,y];

function pathData(source: unknown, x: number, y: number, warn: Warn) {
  if (typeof source === "string") {
    try { const parsed = parseSvgPath(source, true); return parsed.length ? bake(parsed, translate(-x,-y)) : undefined; } catch { return; }
  }
  if (!Array.isArray(source) || !source.length || source.length > 100_000) return;
  let pen: Point = [0,0], first = pen, cubic: Point | undefined, quad: Point | undefined;
  const path: CurveElement[] = [];
  for (const raw of source) {
    const item = object(raw), args = Object.hasOwn(item, "params") ? object(item.params) : item;
    if (typeof item.command !== "string") return;
    const op = aliases[item.command] ?? item.command;
    let end: Point = [num(args, "x", pen[0]+x)-x, num(args, "y", pen[1]+y)-y];
    const ctrl = (n: number): Point => [num(args,"c"+n+"x",x)-x, num(args,"c"+n+"y",y)-y];
    const reflect = (p?: Point): Point => p ? [2*pen[0]-p[0], 2*pen[1]-p[1]] : pen;
    if (op === "M") { path.push(["M", ...end]); first = end; }
    else if (path.length && ["L","H","V"].includes(op)) {
      end = [op === "V" ? pen[0] : end[0], op === "H" ? pen[1] : end[1]]; path.push(["L", ...end]);
    } else if (path.length && (op === "C" || op === "S")) {
      const c1 = op === "S" ? reflect(cubic) : ctrl(1); cubic = ctrl(2);
      path.push(["C", ...c1, ...cubic, ...end]);
    } else if (path.length && (op === "Q" || op === "T")) {
      quad = op === "T" ? reflect(quad) : ctrl(1); path.push(["Q", ...quad, ...end]);
    } else if (path.length && op === "Z") { path.push(["Z"]); end = first; }
    else if (path.length && op === "A") {
      if (!arc(pen, end, args, path)) {warn("Penpot ellipse arc has invalid parameters; retained as unconverted frame");return;}
    } else {warn("Unsupported Penpot path command '" + item.command + "'; path left unconverted");return;}
    if (op !== "C" && op !== "S") cubic = undefined;
    if (op !== "Q" && op !== "T") quad = undefined;
    pen = end;
  }
  return path;
}

function filled(path: readonly PathCommand[]) {
  const closed: PathCommand[] = [], synthetic = new Set<number>();
  let start: Point | undefined, end: Point = [0,0], segments = 0;
  const close = (inferred: boolean) => {
    if (!start) return;
    closed.push(["Z"]);
    if (Math.hypot(end[0]-start[0], end[1]-start[1]) > 1e-6) {
      if (inferred) synthetic.add(segments);
      segments++;
    }
    start = undefined;
  };
  for (const op of path) {
    if (op[0] === "Z") {close(false); continue;}
    if (op[0] === "M") {close(true); start = [op[1],op[2]];}
    else segments++;
    end = [Number(op.at(-2)), Number(op.at(-1))]; closed.push(op);
  }
  close(true);
  const net = networkFromPath(closed);
  if (!synthetic.size) return net;
  const kept = new Map<number,number>();
  net.segments.forEach((_, i) => { if (!synthetic.has(i)) kept.set(i,kept.size); });
  return {...net, segments: net.segments.filter((_,i)=>kept.has(i)), regions: net.regions.map(r=>({...r,
    loops:r.loops.map(loop=>loop.filter(i=>kept.has(i)).map(i=>kept.get(i)!))}))};
}

export function vector(layer: JsonObject, absolute: Affine, x: number, y: number, warn: Warn) {
  if (Array.isArray(layer.content) && !layer.content.length) return {network: () => networkFromPath([])};
  const path = pathData(layer.content, x, y, warn);
  if (!path) {warn("A Penpot path could not be decoded; kept as a frame");return;}
  const local = bake(path, multiply(inverse(absolute), translate(x,y)));
  const bounds = pathBounds(cubics(local)) ?? {x:0,y:0,width:0,height:0};
  const commands = cubics(bake(local, translate(-bounds.x,-bounds.y)));
  const network = (fill: boolean) => {
    const net = fill ? filled(commands) : networkFromPath(commands);
    const attrs = object(layer.svgAttrs);
    return (object(attrs.style).fillRule ?? attrs.fillRule) === "evenodd"
      ? {...net, regions: net.regions.map(r=>({...r,winding:"evenOdd" as const}))} : net;
  };
  return {network, bounds, transform: multiply(absolute, translate(bounds.x,bounds.y))};
}
