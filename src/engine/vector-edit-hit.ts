import { inverse, transformPoint } from "./affine";
import { nearestCubic } from "./cubic-nearest";
import type { Document, NodeId } from "./document";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import { vectorNetwork, visibleVectorHandles, type VectorEditState } from "./vector-edit";
import { networkCubic } from "./vector-network";

export type VectorHit = { kind: "vertex"; index: number } | { kind: "handle"; seg: number; start: boolean } | { kind: "segment"; seg: number; t: number };

/** Native candidate tolerance is local; vertex/handle ranking is in page coordinates. */
export function hitVector(document: Document, state: VectorEditState, point: Point, tolerance: number): VectorHit | undefined {
  const net = vectorNetwork(document, state.id); if (!net || !Number.isFinite(tolerance) || tolerance < 0) return undefined;
  const world = worldTransform(document, state.id); let local: Point;
  try { local = transformPoint(inverse(world), point); } catch { return undefined; }
  const tol = tolerance / Math.max(Math.sqrt(Math.abs(world[0] * world[3] - world[1] * world[2])), 1e-9);
  const pageDistance = (p: Point) => { const q = transformPoint(world, p); return Math.hypot(q.x - point.x, q.y - point.y); };
  let handle: VectorHit | undefined, vertex: VectorHit | undefined, dh = Infinity, dv = Infinity;
  for (const [seg, start] of visibleVectorHandles(net, state)) {
    const s = net.segments[seg], v = net.vertices[start ? s.a : s.b], h = start ? s.ta : s.tb;
    if (!v) continue; const end = { x: v.x + h[0], y: v.y + h[1] };
    if (Math.hypot(end.x - local.x, end.y - local.y) <= tol) { const d = pageDistance(end); if (d < dh) { dh = d; handle = { kind: "handle", seg, start }; } }
  }
  net.vertices.forEach((v, index) => {
    if (Math.hypot(v.x - local.x, v.y - local.y) <= tol) { const d = pageDistance(v); if (d < dv) { dv = d; vertex = { kind: "vertex", index }; } }
  });
  if (handle && (!vertex || dh <= dv)) return handle;
  if (vertex) return vertex;
  let segment: VectorHit | undefined, distance = Infinity;
  net.segments.forEach((_, seg) => {
    const c = networkCubic(net, seg), near = c && nearestCubic(c, local);
    if (near && near.distance <= tol && near.distance < distance) { distance = near.distance; segment = { kind: "segment", seg, t: near.t }; }
  });
  return segment;
}

/** Active layer first; subsequent layers retain their own point and segment selections. */
export function hitEditedVectors(document: Document, state: VectorEditState, point: Point, tolerance: number): { id: NodeId; hit: VectorHit } | undefined {
  const first = hitVector(document, state, point, tolerance); if (first) return { id: state.id, hit: first };
  for (const part of state.others) {
    const hit = hitVector(document, { ...state, ...part, handles: [], regions: [], regionVertices: [] }, point, tolerance);
    if (hit) return { id: part.id, hit };
  }
  return undefined;
}
