import { inverse, transformPoint, type Affine } from "./affine";
import type { PathCommand } from "./corners";
import type { Document, NodeId } from "./document";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import { vectorNetwork } from "./vector-edit";
import { freezeNetwork, networkFromPath, type VectorNetwork } from "./vector-network";
import { pathBounds } from "./vector-path";
import { connectVectorPoints, penAt45 } from "./vector-pen";

export interface PenAnchor { readonly at: Point; readonly incoming: Point; readonly outgoing: Point }
export type PenPathAction = { kind: "close" } | { kind: "join"; index: number } | { kind: "ignore" } | { kind: "add"; point: Point };
export function penPathAction(points: readonly PenAnchor[], point: Point, zoom: number, shift: boolean): PenPathAction {
  const near = (p: PenAnchor) => Math.hypot(p.at.x - point.x, p.at.y - point.y) * zoom < 8;
  if (points.length > 2 && near(points[0])) return { kind: "close" };
  for (let index = 1; index < points.length - 1; index++) if (near(points[index])) return { kind: "join", index };
  const last = points.at(-1);
  if (last && near(last)) return { kind: "ignore" };
  return { kind: "add", point: shift && last ? penAt45(last.at, point) : point };
}

/** Previous outgoing handle, then the current incoming/outgoing, in native overlay order. */
export function penPathHandles(points: readonly PenAnchor[]): readonly (readonly [Point, Point])[] {
  const last = points.at(-1), before = points.at(-2);
  const handles = [...(before ? [[before.at, before.outgoing] as const] : []), ...(last ? [[last.at, last.incoming] as const, [last.at, last.outgoing] as const] : [])];
  return handles.filter(([, h]) => Math.hypot(h.x, h.y) > 0).map(([p, h]) => [p, { x: p.x + h.x, y: p.y + h.y }] as const);
}

/** Exact cubic bounds precede network creation and optional interior-anchor joining, as upstream. */
export function buildPenPath(points: readonly PenAnchor[], parentWorld: Affine, closed: boolean, join?: number): { network: VectorNetwork; transform: Affine; width: number; height: number } | undefined {
  if (points.length < 2) return;
  const inv = inverse(parentWorld), local = points.map(p => ({
    at: transformPoint(inv, p.at),
    incoming: transformPoint(inv, { x: p.at.x + p.incoming.x, y: p.at.y + p.incoming.y }),
    outgoing: transformPoint(inv, { x: p.at.x + p.outgoing.x, y: p.at.y + p.outgoing.y }),
  }));
  const path: PathCommand[] = [["M", local[0].at.x, local[0].at.y]];
  const segment = (a: typeof local[number], b: typeof local[number]) => path.push(["C", a.outgoing.x, a.outgoing.y, b.incoming.x, b.incoming.y, b.at.x, b.at.y]);
  for (let i = 1; i < local.length; i++) segment(local[i - 1], local[i]);
  if (closed) { segment(local.at(-1)!, local[0]); path.push(["Z"]); }
  const bounds = pathBounds(path); if (!bounds || !Object.values(bounds).every(Number.isFinite)) throw new Error("Pen path bounds must remain finite");
  const shifted = path.map((c): PathCommand => c[0] === "M" ? ["M", c[1] - bounds.x, c[2] - bounds.y]
    : c[0] === "C" ? ["C", c[1] - bounds.x, c[2] - bounds.y, c[3] - bounds.x, c[4] - bounds.y, c[5] - bounds.x, c[6] - bounds.y] : c);
  let network = networkFromPath(shifted);
  network = freezeNetwork({ ...network, regions: closed ? network.regions : [], segments: network.segments.map(s =>
    Math.abs(s.ta[0]) + Math.abs(s.ta[1]) < 1e-9 && Math.abs(s.tb[0]) + Math.abs(s.tb[1]) < 1e-9 ? { ...s, ta: [0, 0], tb: [0, 0] } : s) });
  if (join !== undefined) {
    const last = local.at(-1)!;
    network = connectVectorPoints(network, local.length - 1, join, [last.outgoing.x - last.at.x, last.outgoing.y - last.at.y])?.network ?? network;
  }
  return { network, width: bounds.width, height: bounds.height, transform: [1, 0, 0, 1, bounds.x, bounds.y] };
}

/** First selected vector's first nearby degree-one endpoint, including transformed parents. */
export function selectedVectorEnd(document: Document, selection: readonly NodeId[], point: Point, tolerance: number): { id: NodeId; vertex: number } | undefined {
  for (const id of selection) {
    const net = vectorNetwork(document, id); if (!net) continue;
    const world = worldTransform(document, id), degrees = new Uint32Array(net.vertices.length);
    for (const s of net.segments) { degrees[s.a]++; if (s.a !== s.b) degrees[s.b]++; }
    for (let vertex = 0; vertex < net.vertices.length; vertex++) if (degrees[vertex] === 1) {
      const p = transformPoint(world, net.vertices[vertex]);
      if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) return { id, vertex };
    }
  }
}
