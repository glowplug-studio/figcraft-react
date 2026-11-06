import type { PathCommand } from "./corners";
import { cubicBounds, cubicExtrema, cubicPoint, type Cubic } from "./cubic";
import type { Point, Rectangle } from "./geometry";
import { networkCubic, type VectorNetwork, type VectorSegment } from "./vector-network";
import { roundedNetwork } from "./vector-rounded";

export interface VectorStrokeRun { readonly path: readonly PathCommand[]; readonly start: number; readonly end: number; readonly closed: boolean }
const runCache = new WeakMap<VectorNetwork, Map<boolean, readonly VectorStrokeRun[]>>();
const fillCache = new WeakMap<VectorNetwork, readonly PathCommand[]>(), strokeCache = new WeakMap<VectorNetwork, readonly PathCommand[]>();
const frozenPath = (path: readonly PathCommand[]): readonly PathCommand[] => Object.freeze(path.map(c => Object.freeze(c)));
const straight = (s: VectorSegment) => s.ta[0] === 0 && s.ta[1] === 0 && s.tb[0] === 0 && s.tb[1] === 0;
function pushSegment(path: PathCommand[], net: VectorNetwork, index: number, reverse: boolean): void {
  const c = networkCubic(net, index); if (!c) return;
  const end = reverse ? c[0] : c[3], a = reverse ? c[2] : c[1], b = reverse ? c[1] : c[2];
  path.push(straight(net.segments[index]) ? ["L", end.x, end.y] : ["C", a.x, a.y, b.x, b.y, end.x, end.y]);
}
/** Maximal runs in stable segment order; every adjacency is scanned at most once. */
export function vectorStrokeRuns(source: VectorNetwork, pointJoins = false): readonly VectorStrokeRun[] {
  const cached = runCache.get(source)?.get(pointJoins); if (cached) return cached;
  const net = roundedNetwork(source) ?? source, used = new Uint8Array(net.segments.length), degrees = new Uint32Array(net.vertices.length), adjacent: [number, boolean][][] = net.vertices.map(() => []);
  net.segments.forEach((s, i) => { if (s.a < degrees.length) degrees[s.a]++; if (s.b < degrees.length) degrees[s.b]++; adjacent[s.a]?.push([i, false]); if (s.b !== s.a) adjacent[s.b]?.push([i, true]); });
  const cursor = new Uint32Array(net.vertices.length), breaks = (v: number) => pointJoins && net.vertices[v]?.join !== undefined, stop = (v: number) => degrees[v] !== 2 || breaks(v);
  const next = (v: number): [number, boolean] | undefined => { const list = adjacent[v]; if (!list) return undefined; while (cursor[v] < list.length) { const entry = list[cursor[v]]; if (!used[entry[0]]) return entry; cursor[v]++; } return undefined; };
  const starts: number[] = []; for (let i = 0; i < net.vertices.length; i++) if (stop(i)) starts.push(i); for (let i = 0; i < net.vertices.length; i++) if (!stop(i)) starts.push(i);
  const out: VectorStrokeRun[] = []; let remaining = net.segments.length;
  for (const start of starts) {
    if (!remaining) break;
    let entry: [number, boolean] | undefined;
    while ((entry = next(start))) {
      const p = net.vertices[start], path: PathCommand[] = [["M", p.x, p.y]]; let current = start, closed = false;
      while (entry) {
        const [i, reverse] = entry; if (!used[i]) { used[i] = 1; remaining--; }
        const s = net.segments[i]; pushSegment(path, net, i, reverse); current = reverse ? s.a : s.b;
        if (current === start && !breaks(start)) { path.push(["Z"]); closed = true; break; }
        entry = stop(current) ? undefined : next(current);
      }
      out.push({ path, start, end: current, closed });
    }
  }
  const result = Object.freeze(out.map(run => Object.freeze({ ...run, path: frozenPath(run.path) })));
  if (Object.isFrozen(source)) { let entry = runCache.get(source); if (!entry) { entry = new Map(); runCache.set(source, entry); } entry.set(pointJoins, result); }
  return result;
}
export function vectorStrokePath(net: VectorNetwork): readonly PathCommand[] {
  const cached = strokeCache.get(net); if (cached) return cached;
  const out: PathCommand[] = []; for (const run of vectorStrokeRuns(net)) for (const c of run.path) out.push(c);
  const path = frozenPath(out); if (Object.isFrozen(net)) strokeCache.set(net, path); return path;
}
/** Legacy fill path preserves the native first-segment orientation and malformed-loop behaviour. */
export function vectorFillPath(source: VectorNetwork): readonly PathCommand[] {
  const cached = fillCache.get(source); if (cached) return cached;
  const net = roundedNetwork(source) ?? source, path: PathCommand[] = [];
  for (const region of net.regions) for (const loop of region.loops) {
    const indices = loop.filter(i => net.segments[i]), first = net.segments[indices[0]], second = net.segments[indices[1]]; if (!first) continue;
    let current = second && (first.a === second.a || first.a === second.b) ? first.b : first.a;
    const start = net.vertices[current]; if (!start) continue; path.push(["M", start.x, start.y]);
    for (const i of indices) { const s = net.segments[i], reverse = s.a !== current; pushSegment(path, net, i, reverse); current = reverse ? s.a : s.b; } path.push(["Z"]);
  }
  const result = frozenPath(path); if (Object.isFrozen(source)) fillCache.set(source, result); return result;
}
export function vectorLoopWalk(net: VectorNetwork, loop: readonly number[]): readonly (readonly [number, boolean])[] {
  const indices = loop.filter(i => net.segments[i]), first = net.segments[indices[0]], second = net.segments[indices[1]]; if (!first) return [];
  let current = !second || first.b === second.a || first.b === second.b ? first.a : first.b; const out: [number, boolean][] = [];
  for (const i of indices) { const s = net.segments[i], reverse = s.a !== current && s.b === current; out.push([i, reverse]); current = reverse ? s.a : s.b; }
  return out;
}
/** Styled regions bridge gaps in malformed loops; their own rule is evaluated independently. */
export function vectorRegionPath(net: VectorNetwork, index: number): readonly PathCommand[] | undefined {
  const region = net.regions[index]; if (!region) return undefined; const path: PathCommand[] = [];
  for (const loop of region.loops) {
    let at: Point | undefined;
    for (const [i, reverse] of vectorLoopWalk(net, loop)) {
      const s = net.segments[i], a = net.vertices[reverse ? s.b : s.a], b = net.vertices[reverse ? s.a : s.b]; if (!a || !b) continue;
      if (!at) path.push(["M", a.x, a.y]); else if (at.x !== a.x || at.y !== a.y) path.push(["L", a.x, a.y]);
      pushSegment(path, net, i, reverse); at = b;
    }
    if (at) path.push(["Z"]);
  }
  return path.length ? path : undefined;
}
export function pathWinding(path: readonly PathCommand[], p: Point): number {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  let winding = 0, pen: Point | undefined, start: Point | undefined;
  const line = (a: Point, b: Point) => {
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y && b.y > p.y && side > 0) winding++; else if (a.y > p.y && b.y <= p.y && side < 0) winding--;
  };
  const close = () => { if (pen && start) line(pen, start); };
  for (const command of path) {
    if (command[0] === "M") { close(); pen = start = { x: command[1], y: command[2] }; }
    else if (command[0] === "Z") { close(); pen = start; }
    else if (command[0] === "L") { const end = { x: command[1], y: command[2] }; if (pen) line(pen, end); pen = end; }
    else if (command[0] === "C") {
      const end = { x: command[5], y: command[6] };
      if (pen) {
        const c: Cubic = [pen, { x: command[1], y: command[2] }, { x: command[3], y: command[4] }, end];
        const cuts = [0, ...cubicExtrema(c, "y"), 1];
        // Solve crossings on monotone intervals: no polygon approximation or sample budget.
        for (let i = 1; i < cuts.length; i++) {
          let low = cuts[i - 1], high = cuts[i]; const a = cubicPoint(c, low).y, b = cubicPoint(c, high).y, up = a < b;
          if (!(up ? a <= p.y && p.y < b : b <= p.y && p.y < a)) continue;
          for (let step = 0; step < 52; step++) { const mid = (low + high) / 2, y = cubicPoint(c, mid).y; if (up ? y < p.y : y > p.y) low = mid; else high = mid; }
          if (cubicPoint(c, (low + high) / 2).x > p.x) winding += up ? 1 : -1;
        }
      }
      pen = end;
    }
  }
  close();
  return winding;
}
export function vectorRegionContains(net: VectorNetwork, index: number, p: Point): boolean {
  const region = net.regions[index], path = vectorRegionPath(net, index); if (!region || !path) return false;
  const w = pathWinding(path, p); return region.winding === "evenOdd" ? w % 2 !== 0 : w !== 0;
}
export function vectorFillContains(net: VectorNetwork, p: Point): boolean { const w = pathWinding(vectorFillPath(net), p); return net.regions.some(r => r.winding === "evenOdd") ? w % 2 !== 0 : w !== 0; }
export function pathBounds(path: readonly PathCommand[]): Rectangle | undefined {
  let pen: Point | undefined, start: Point | undefined, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const include = (p: Point) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const c of path) {
    if (c[0] === "M") { pen = start = { x: c[1], y: c[2] }; }
    else if (c[0] === "Z") { if (start && pen && (start.x !== pen.x || start.y !== pen.y)) { include(start); include(pen); } pen = start; }
    else if (c[0] === "L") { const end = { x: c[1], y: c[2] }; if (pen) { include(pen); include(end); } pen = end; }
    else if (c[0] === "C") {
      const end = { x: c[5], y: c[6] }; if (pen) { const b = cubicBounds([pen, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, end]); include({ x: b.x, y: b.y }); include({ x: b.x + b.width, y: b.y + b.height }); } pen = end;
    }
  }
  return x0 === Infinity ? undefined : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
export function networkBounds(net: VectorNetwork): Rectangle | undefined {
  const path = vectorStrokePath(net);
  // Native network bounds distinguish an empty path from move-only damaged runs.
  return path.length ? pathBounds(path) ?? { x: 0, y: 0, width: 0, height: 0 } : undefined;
}
