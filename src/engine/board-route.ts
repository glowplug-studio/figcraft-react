import type { ConnectorPath, Routing, Side } from "./board-data";

/** Source: upstream doc/src/board_route.rs: where a connector runs between its ends, straight, in right angles or along one curve. */
export interface Pt { readonly x: number; readonly y: number }
export interface Box { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/** Native `RouteEnd`: a free point, an object's box and the side the route leaves by, or a point on it placed by hand. */
export type RouteEnd = { readonly point: Pt } | { readonly box: Box; readonly side: Side } | { readonly box: Box; readonly side: Side; readonly on: Pt };

/** How far an elbow connector going round the objects it joins keeps from them (native `ROOM`). */
const room = 24;
/** Native `END_GAP`: how far outside the border a connector attached to a side starts and ends. */
export const endGap = 4;
/** Native `MAX_RUNS`. */
export const maxRuns = 64;

const centre = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const endCentre = (e: RouteEnd): Pt => "point" in e ? e.point : "on" in e ? e.on : centre(e.box);
const width = (b: Box) => b.x1 - b.x0, height = (b: Box) => b.y1 - b.y0;
/** Native `Side::point`: the side's middle on `b`. */
export function sidePoint(side: Side, b: Box): Pt {
  const c = centre(b);
  return side === "top" ? { x: c.x, y: b.y0 } : side === "right" ? { x: b.x1, y: c.y } : side === "bottom" ? { x: c.x, y: b.y1 } : side === "left" ? { x: b.x0, y: c.y } : c;
}
/** Native `Side::normal`: the way out of the side (y down; none for auto). */
export function sideNormal(side: Side): Pt {
  return side === "top" ? { x: 0, y: -1 } : side === "right" ? { x: 1, y: 0 } : side === "bottom" ? { x: 0, y: 1 } : side === "left" ? { x: -1, y: 0 } : { x: 0, y: 0 };
}
const horizontal = (s: Side) => s === "left" || s === "right";
const add = (p: Pt, d: Pt, k = 1): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const hypot = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

/** Native `named_or_facing`: `side`, or for auto the side of `b` facing `other` (a wide box takes the sides more). */
function namedOrFacing(b: Box, side: Side, other: Pt): Side {
  if (side !== "auto") return side;
  const c = centre(b), dx = other.x - c.x, dy = other.y - c.y;
  if (Math.abs(dx) * Math.max(height(b), 1e-9) >= Math.abs(dy) * Math.max(width(b), 1e-9)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}
/** Native `attach`: where end `e` attaches and the side it leaves by (undefined: a free point). */
function attach(e: RouteEnd, other: Pt): [Pt, Side | undefined] {
  if ("point" in e) return [e.point, undefined];
  const side = namedOrFacing(e.box, e.side, other);
  if ("on" in e) return [e.on, side];
  return [add(sidePoint(side, e.box), sideNormal(side), endGap), side];
}
/** Native `tidy`: without repeats or turns that don't turn. */
function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (last && same(last, p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}
/** Native `curve`: a curve leaving and arriving along the sides' normals (a free end pulls no way). */
function curve(p0: Pt, s0: Side | undefined, p1: Pt, s1: Side | undefined): Pt[] {
  const reach = hypot(p0, p1) / 2;
  const pull = (p: Pt, s: Side | undefined) => s ? add(p, sideNormal(s), reach) : p;
  return [p0, pull(p0, s0), pull(p1, s1), p1];
}
/** Native `crosses`: whether the right-angled route runs through the inside of any box. */
function crosses(pts: readonly Pt[], boxes: readonly Box[]): boolean {
  const edge = 0.5;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (boxes.some(r => Math.min(a.x, b.x) < r.x1 - edge && Math.max(a.x, b.x) > r.x0 + edge && Math.min(a.y, b.y) < r.y1 - edge && Math.max(a.y, b.y) > r.y0 + edge)) return true;
  }
  return false;
}
/** Native `short_elbow`: halfway across between two sides facing the same way, one turn otherwise. */
function shortElbow(p0: Pt, h0in: boolean | undefined, p1: Pt, h1in: boolean | undefined): Pt[] {
  const h0 = h0in ?? h1in ?? Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y), h1 = h1in ?? h0;
  if (h0 && h1) { const mx = (p0.x + p1.x) / 2; return [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]; }
  if (!h0 && !h1) { const my = (p0.y + p1.y) / 2; return [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1]; }
  return h0 ? [p0, { x: p1.x, y: p0.y }, p1] : [p0, { x: p0.x, y: p1.y }, p1];
}
/** Native `elbow`: the short way when it keeps out of the joined objects, else the cheapest of a few ways round them. */
function elbow(p0: Pt, s0: Side | undefined, p1: Pt, s1: Side | undefined, boxes: readonly Box[]): Pt[] {
  const direct = tidy(shortElbow(p0, s0 && horizontal(s0), p1, s1 && horizontal(s1)));
  if (!boxes.length || !crosses(direct, boxes)) return direct;
  const all = boxes.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }));
  const out = (p: Pt, s: Side | undefined) => s ? add(p, sideNormal(s), room) : p;
  const a = out(p0, s0), b = out(p1, s1);
  const ways: Pt[][] = [[p0, a, { x: b.x, y: a.y }, b, p1], [p0, a, { x: a.x, y: b.y }, b, p1]];
  for (const x of [(a.x + b.x) / 2, all.x0 - room, all.x1 + room]) ways.push([p0, a, { x, y: a.y }, { x, y: b.y }, b, p1]);
  for (const y of [(a.y + b.y) / 2, all.y0 - room, all.y1 + room]) ways.push([p0, a, { x: a.x, y }, { x: b.x, y }, b, p1]);
  const cost = (r: readonly Pt[]) => r.slice(1).reduce((s, q, i) => s + hypot(r[i], q), 0) + room * r.length;
  let best: Pt[] | undefined, bestCost = Infinity;
  for (const w of ways.map(tidy)) {
    if (crosses(w, boxes)) continue;
    const c = cost(w);
    if (c < bestCost) { best = w; bestCost = c; }
  }
  return best ?? direct;
}
const finitePts = (pts: Pt[]) => pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : undefined;

/** Native `route_points`: the points a connector runs through (curved: its two ends with the curve's control points between them). */
export function routePoints(from: RouteEnd, to: RouteEnd, routing: Routing): Pt[] | undefined {
  const [p0, s0] = attach(from, endCentre(to)), [p1, s1] = attach(to, endCentre(from));
  const boxes = [from, to].flatMap(e => "box" in e && !("on" in e) ? [e.box] : []);
  return finitePts(routing === "straight" ? tidy([p0, p1]) : routing === "elbow" ? elbow(p0, s0, p1, s1, boxes) : curve(p0, s0, p1, s1));
}
/** Native `along_runs`: the right-angled route through runs at the places `at`, from the middle of the ends. */
function alongRuns(p0: Pt, p1: Pt, across: boolean, at: readonly number[]): Pt[] {
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const out = [p0];
  let cur = p0, sideways = across;
  for (const v of at) { cur = sideways ? { x: mid.x + v, y: cur.y } : { x: cur.x, y: mid.y + v }; out.push(cur); sideways = !sideways; }
  out.push(sideways ? { x: p1.x, y: cur.y } : { x: cur.x, y: p1.y }, p1);
  return tidy(out);
}
/** Native `route_along`: `route_points` for a connector whose path may have been reshaped by hand (a path for another routing is ignored). */
export function routeAlong(from: RouteEnd, to: RouteEnd, routing: Routing, path?: ConnectorPath): Pt[] | undefined {
  const [p0, s0] = attach(from, endCentre(to)), [p1, s1] = attach(to, endCentre(from));
  if (routing === "elbow" && path && "runs" in path) return finitePts(alongRuns(p0, p1, path.runs.across, path.runs.at));
  if (routing === "curved" && path && "bow" in path) {
    // Both control points moved by d move the curve's middle by 3/4 of d.
    const d = { x: path.bow.x * 4 / 3, y: path.bow.y * 4 / 3 };
    return finitePts(curve(p0, s0, p1, s1).map((p, i) => i === 1 || i === 2 ? add(p, d) : p));
  }
  return routePoints(from, to, routing);
}
/** Native `attached_sides`: the sides the ends leave by, as routed now (undefined: a free end). */
export const attachedSides = (from: RouteEnd, to: RouteEnd): [Side | undefined, Side | undefined] => [attach(from, endCentre(to))[1], attach(to, endCentre(from))[1]];
/** Native `attach_points`. */
export const attachPoints = (from: RouteEnd, to: RouteEnd): [Pt, Pt] => [attach(from, endCentre(to))[0], attach(to, endCentre(from))[0]];
/** Native `curve_middle`. */
export function curveMiddle(pts: readonly Pt[]): Pt | undefined {
  if (pts.length !== 4) return undefined;
  const [a, b, c, d] = pts;
  return { x: (a.x + (b.x + c.x) * 3 + d.x) / 8, y: (a.y + (b.y + c.y) * 3 + d.y) / 8 };
}
/** Native `path_handles`: one per run of an elbow, one for a curve's middle. */
export function pathHandles(pts: readonly Pt[], routing: Routing): [number, Pt][] {
  if (routing === "straight") return [];
  if (routing === "curved") { const m = curveMiddle(pts); return m ? [[0, m]] : []; }
  return pts.slice(1).map((q, i) => [i, { x: (pts[i].x + q.x) / 2, y: (pts[i].y + q.y) / 2 }]);
}
/** Native `reshaped_runs`: the right-angled route's runs with run `portion` moved to `p`. */
function reshapedRuns(pts: readonly Pt[], portion: number, p: Pt): ConnectorPath | undefined {
  const last = pts.length - 2;
  if (last < 0 || portion > last || last + 3 > maxRuns) return undefined;
  const first = pts[0], end = pts[pts.length - 1], mid = { x: (first.x + end.x) / 2, y: (first.y + end.y) / 2 };
  const across = (i: number) => pts[i].y === pts[i + 1].y;
  const lies = (i: number, q: Pt) => across(i) ? q.y - mid.y : q.x - mid.x;
  const along = (i: number, q: Pt) => across(i) ? q.x - mid.x : q.y - mid.y;
  const stub = (i: number, q: Pt, to: Pt) => { const d = { x: to.x - q.x, y: to.y - q.y }, len = Math.hypot(d.x, d.y); return along(i, add(q, d, Math.min(room, len / 2) / Math.max(len, 1e-9))); };
  let at = Array.from({ length: Math.max(last - 1, 0) }, (_, k) => lies(k + 1, pts[k + 1]));
  const moved = lies(portion, p);
  if (last === 0) at = [stub(0, first, end), moved, stub(0, end, first)];
  else if (portion === 0) at.splice(0, 0, stub(0, first, pts[1]), moved);
  else if (portion === last) at.push(moved, stub(last, end, pts[last]));
  else at[portion - 1] = moved;
  return { runs: { across: across(0), at } };
}
/** Native `reshaped`: the path after dragging `portion`'s handle to `p` (undefined: straight, or no such portion). */
export function reshaped(from: RouteEnd, to: RouteEnd, routing: Routing, path: ConnectorPath | undefined, portion: number, p: Pt): ConnectorPath | undefined {
  if (routing === "straight") return undefined;
  if (routing === "curved") { const pts = routePoints(from, to, routing), m = pts && curveMiddle(pts); return m ? { bow: { x: p.x - m.x, y: p.y - m.y } } : undefined; }
  const pts = routeAlong(from, to, routing, path);
  return pts && reshapedRuns(pts, portion, p);
}
