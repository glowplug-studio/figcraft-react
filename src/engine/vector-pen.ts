import type { Point } from "./geometry";
import { pixelRound } from "./geometry";
import type { VectorHit } from "./vector-edit-hit";
import { splitSegment } from "./vector-edit-ops";
import { freezeNetwork, networkIncident, vectorVertex, type VectorNetwork } from "./vector-network";

export type PenHandle = readonly [number, number];
export type PenPlan = { kind: "new"; at: Point; from?: number }
  | { kind: "connect"; from: number; to: number }
  | { kind: "split"; seg: number; t: number; from?: number };
export type PenDecision = { kind: "start"; vertex: number } | { kind: "end" } | { kind: "edit"; plan: PenPlan };
const zero: PenHandle = [0, 0];
const finiteHandle = (h: PenHandle): PenHandle => h.every(Number.isFinite) ? h : zero;

/** Native 45-degree constraint retains length and rounds negative ties away from zero. */
export function penAt45(last: Point, point: Point): Point {
  const dx = point.x - last.x, dy = point.y - last.y, step = Math.PI / 4;
  const angle = pixelRound(Math.atan2(dy, dx) / step) * step, length = Math.hypot(dx, dy);
  return { x: last.x + Math.cos(angle) * length, y: last.y + Math.sin(angle) * length };
}

/** The incident order is segment order, matching native breadth-first tie resolution. */
function pathBetween(net: VectorNetwork, from: number, to: number): number[] | undefined {
  const adjacent: [number, number][][] = Array.from({ length: net.vertices.length }, () => []);
  net.segments.forEach((s, i) => {
    adjacent[s.a]?.push([s.b, i]);
    if (s.b !== s.a) adjacent[s.b]?.push([s.a, i]);
  });
  const previous: ([number, number] | undefined)[] = new Array(net.vertices.length), seen = new Set([from]), queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    if (v === to) {
      const segments: number[] = []; let current = to;
      while (current !== from) { const p = previous[current]; if (!p) return; segments.push(p[1]); current = p[0]; }
      return segments.reverse();
    }
    for (const [next, segment] of adjacent[v] ?? []) if (adjacent[next] && !seen.has(next)) {
      seen.add(next); previous[next] = [v, segment]; queue.push(next);
    }
  }
}

/** Connecting two previously open ends fills their shortest unfilled loop only. */
export function connectVectorPoints(net: VectorNetwork, a: number, b: number, ta: PenHandle = zero, tb: PenHandle = zero): { network: VectorNetwork; segment: number } | undefined {
  if (a === b || !Number.isInteger(a) || !Number.isInteger(b) || !net.vertices[a] || !net.vertices[b]) return;
  const ends = networkIncident(net, a).length === 1 && networkIncident(net, b).length === 1;
  const segment = net.segments.length, segments = [...net.segments, { a, b, ta: finiteHandle(ta), tb: finiteHandle(tb) }];
  let regions = net.regions;
  const path = ends ? pathBetween(net, b, a) : undefined;
  if (path) {
    const chain = new Set(path);
    if (!regions.some(r => r.loops.some(loop => loop.some(s => chain.has(s))))) {
      regions = [...regions, { loops: [[segment, ...path]], winding: "nonZero" }];
    }
  }
  return { network: freezeNetwork({ ...net, segments, regions }), segment };
}

/** Pure edit-mode plan; hit testing and page/local conversion belong to the caller. */
export function planPen(net: VectorNetwork, anchor: number | undefined, hit: VectorHit | undefined, local: Point, shift: boolean): PenDecision {
  if (hit?.kind === "vertex") {
    if (anchor === undefined) return { kind: "start", vertex: hit.index };
    return anchor === hit.index ? { kind: "end" } : { kind: "edit", plan: { kind: "connect", from: anchor, to: hit.index } };
  }
  if (hit?.kind === "segment") return { kind: "edit", plan: { kind: "split", seg: hit.seg, t: hit.t, from: anchor } };
  const start = anchor === undefined ? undefined : net.vertices[anchor];
  return { kind: "edit", plan: { kind: "new", at: shift && start ? penAt45(start, local) : local, from: anchor } };
}

/** Replay against the captured network, retaining native relative-handle and closure semantics. */
export function applyPen(net: VectorNetwork, plan: PenPlan, outgoing?: PenHandle, drag?: Point): { network: VectorNetwork; vertex?: number } {
  if (drag && ![drag.x, drag.y].every(Number.isFinite)) throw new Error("Pen handles must remain finite");
  const out = outgoing ?? zero, back: PenHandle = drag ? [-drag.x, -drag.y] : zero;
  if (plan.kind === "new") {
    if (![plan.at.x, plan.at.y].every(Number.isFinite)) throw new Error("Pen points must remain finite");
    const vertex = net.vertices.length;
    let network = freezeNetwork({ ...net, vertices: [...net.vertices, { ...vectorVertex(plan.at.x, plan.at.y), ...(drag ? { mirror: "angleAndLength" as const } : {}) }] });
    if (plan.from !== undefined) network = connectVectorPoints(network, plan.from, vertex, out, back)?.network ?? network;
    return { network, vertex };
  }
  if (plan.kind === "split") {
    const split = splitSegment(net, plan.seg, plan.t); if (!split) return { network: net };
    const network = plan.from === undefined ? split.network : connectVectorPoints(split.network, plan.from, split.vertex, out, zero)?.network ?? split.network;
    return { network, vertex: split.vertex };
  }
  const others = networkIncident(net, plan.to), connected = connectVectorPoints(net, plan.from, plan.to, out, back);
  if (!connected) return { network: net };
  let network = connected.network;
  if (drag && others.length === 1) {
    const [index, start] = others[0], segments = [...network.segments], vertices = [...network.vertices];
    segments[index] = { ...segments[index], [start ? "ta" : "tb"]: [drag.x, drag.y] };
    vertices[plan.to] = { ...vertices[plan.to], mirror: "angleAndLength" };
    network = freezeNetwork({ ...network, segments, vertices });
  }
  return { network, vertex: plan.to };
}
