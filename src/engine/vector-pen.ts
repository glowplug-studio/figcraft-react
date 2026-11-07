import type { Point } from "./geometry";
import { pixelRound } from "./geometry";
import type { VectorHit } from "./vector-edit-hit";
import { splitSegment } from "./vector-edit-ops";
import { freezeNetwork, networkIncident, vectorVertex, type VectorNetwork } from "./vector-network";

import { connectVectorPoints } from "./vector-connect";
export { connectVectorPoints } from "./vector-connect";

export type PenHandle = readonly [number, number];
export type PenPlan = { kind: "new"; at: Point; from?: number }
  | { kind: "connect"; from: number; to: number }
  | { kind: "split"; seg: number; t: number; from?: number };
export type PenDecision = { kind: "start"; vertex: number } | { kind: "end" } | { kind: "edit"; plan: PenPlan };
const zero: PenHandle = [0, 0];

/** Native 45-degree constraint retains length and rounds negative ties away from zero. */
export function penAt45(last: Point, point: Point): Point {
  const dx = point.x - last.x, dy = point.y - last.y, step = Math.PI / 4;
  const angle = pixelRound(Math.atan2(dy, dx) / step) * step, length = Math.hypot(dx, dy);
  return { x: last.x + Math.cos(angle) * length, y: last.y + Math.sin(angle) * length };
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
