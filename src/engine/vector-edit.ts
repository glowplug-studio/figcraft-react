import { multiply, transformPoint } from "./affine";
import { commonProperties, isLeaf, layerTransform, withLayerTransform, type Document, type LeafNode, type NodeId, type VectorNode } from "./document";
import { HierarchyDraft, worldTransform } from "./hierarchy";
import { shapePath } from "./shape-path";
import { defaultStroke } from "./stroke";
import type { VectorHandle } from "./vector-edit-ops";
import { freezeNetwork, networkCubic, networkFromPath, transformNetwork, type VectorNetwork } from "./vector-network";
import { networkBounds } from "./vector-path";

export interface VectorEditPart { readonly id: NodeId; readonly vertices: readonly number[]; readonly segments: readonly number[] }
/** Ephemeral selection only; never written into the native document or backend identity. */
export interface VectorEditState extends VectorEditPart {
  readonly tool: "move" | "bend" | "pen" | "paint" | "width" | "cut" | "eraser" | "lasso";
  readonly widthPoint?: number;
  readonly anchor?: number;
  readonly penOut?: readonly [number, number];
  readonly handles: readonly VectorHandle[];
  readonly others: readonly VectorEditPart[];
  readonly regions: readonly number[];
  readonly regionHover?: number;
  readonly regionVertices: readonly number[];
  /** Immutable reference used for exact topology comparison; geometry changes keep selection. */
  readonly regionTopology?: VectorNetwork;
}
export function freezeVectorEdit(state: VectorEditState): VectorEditState {
  return Object.freeze({ ...state, ...(state.penOut ? { penOut: Object.freeze([...state.penOut]) as readonly [number, number] } : {}), vertices: Object.freeze([...state.vertices]), segments: Object.freeze([...state.segments]),
    handles: Object.freeze(state.handles.map(h => Object.freeze([...h]) as VectorHandle)),
    others: Object.freeze(state.others.map(p => Object.freeze({ ...p, vertices: Object.freeze([...p.vertices]), segments: Object.freeze([...p.segments]) }))),
    regions: Object.freeze([...state.regions]), regionVertices: Object.freeze([...state.regionVertices]) });
}
export function newVectorEdit(id: NodeId, others: readonly NodeId[] = []): VectorEditState {
  return freezeVectorEdit({ id, tool: "move", vertices: [], segments: [], handles: [], regions: [], regionVertices: [], others: others.map(id => ({ id, vertices: [], segments: [] })) });
}
export const vectorParts = (state: VectorEditState): readonly VectorEditPart[] => [{ id: state.id, vertices: state.vertices, segments: state.segments }, ...state.others];
export function vectorNetwork(document: Document, id: NodeId): VectorNetwork | undefined { const n = document.nodes[id]; return n?.kind === "vector" ? n.network : undefined; }
export function clearVectorSelection(state: VectorEditState): VectorEditState {
  return freezeVectorEdit({ ...state, vertices: [], segments: [], handles: [], regions: [], regionHover: undefined, regionVertices: [], regionTopology: undefined, others: state.others.map(p => ({ ...p, vertices: [], segments: [] })) });
}
export function activateVector(state: VectorEditState, id: NodeId): VectorEditState | undefined {
  if (id === state.id) return state;
  const index = state.others.findIndex(p => p.id === id); if (index < 0) return undefined;
  const others = [...state.others], next = others[index]; others[index] = { id: state.id, vertices: state.vertices, segments: state.segments };
  return freezeVectorEdit({ ...next, tool: state.tool, others, handles: [], regions: [], regionVertices: [] });
}
function sameTopology(a: VectorNetwork | undefined, b: VectorNetwork): boolean {
  return a === b || Boolean(a && a.segments.length === b.segments.length && a.segments.every((s, i) => s.a === b.segments[i].a && s.b === b.segments[i].b)
    && a.regions.length === b.regions.length && a.regions.every((r, i) => r.loops.length === b.regions[i].loops.length && r.loops.every((l, j) => l.length === b.regions[i].loops[j].length && l.every((v, k) => v === b.regions[i].loops[j][k]))));
}
const validIndex = (i: number, length: number): boolean => Number.isInteger(i) && i >= 0 && i < length;
export function clampVectorEdit(document: Document, state: VectorEditState): VectorEditState | undefined {
  const net = vectorNetwork(document, state.id); if (!net) return undefined;
  const topologyChanged = (state.regions.length > 0 || state.regionHover !== undefined) && !sameTopology(state.regionTopology, net);
  const vertices = state.vertices.filter(i => validIndex(i, net.vertices.length)), regions = topologyChanged ? [] : state.regions;
  const regionHover = topologyChanged ? undefined : state.regionHover;
  const invalidAnchor = state.anchor !== undefined && !validIndex(state.anchor, net.vertices.length);
  return freezeVectorEdit({ ...state, ...(invalidAnchor ? { anchor: undefined, penOut: undefined } : {}), vertices, segments: state.segments.filter(i => validIndex(i, net.segments.length)), handles: state.handles.filter(([i]) => validIndex(i, net.segments.length)), regions,
    regionVertices: regions.length ? state.regionVertices.filter(i => vertices.includes(i)) : [], regionHover, regionTopology: regions.length || regionHover !== undefined ? net : undefined,
    others: state.others.flatMap(p => { const n = vectorNetwork(document, p.id); return n ? [{ ...p, vertices: p.vertices.filter(i => validIndex(i, n.vertices.length)), segments: p.segments.filter(i => validIndex(i, n.segments.length)) }] : []; }) });
}
export function selectedVectorPoints(net: VectorNetwork, selection: Pick<VectorEditPart, "vertices" | "segments">): readonly number[] {
  const points = [...selection.vertices];
  for (const i of selection.segments) { const s = net.segments[i]; if (s) points.push(s.a, s.b); }
  return [...new Set(points)].sort((a, b) => a - b);
}
export function regionPoints(net: VectorNetwork, index: number): readonly number[] {
  const region = net.regions[index]; if (!region) return [];
  return selectedVectorPoints(net, { vertices: [], segments: region.loops.flat() }).filter(i => validIndex(i, net.vertices.length));
}
export function selectVectorParts(document: Document, state: VectorEditState, selection: {
  id?: NodeId; vertices?: readonly number[]; segments?: readonly number[]; handles?: readonly VectorHandle[]; regions?: readonly number[]; add?: boolean;
}): VectorEditState {
  const id = selection.id ?? state.id, activated = activateVector(selection.add ? state : clearVectorSelection(state), id);
  if (!activated) throw new Error("That layer isn't being edited");
  const net = vectorNetwork(document, id); if (!net) throw new Error("Not a vector");
  const vertices = [...activated.vertices, ...(selection.vertices ?? [])], segments = [...activated.segments, ...(selection.segments ?? [])], handles = [...activated.handles];
  const regions = [...activated.regions], regionVertices = activated.regionVertices.filter(i => !selection.vertices?.includes(i));
  for (const h of selection.handles ?? []) if (!handles.some(([i, start]) => i === h[0] && start === h[1])) handles.push(h);
  for (const r of (selection.regions ?? []).filter(i => validIndex(i, net.regions.length)).slice(0, 100_000)) if (!regions.includes(r)) {
    regions.push(r); for (const v of regionPoints(net, r)) if (!vertices.includes(v)) { vertices.push(v); regionVertices.push(v); }
  }
  return clampVectorEdit(document, { ...activated, vertices: [...new Set(vertices)].sort((a, b) => a - b), segments: [...new Set(segments)].sort((a, b) => a - b), handles, regions, regionVertices, regionTopology: net })!;
}
export function deselectVectorRegion(state: VectorEditState, net: VectorNetwork, region: number): VectorEditState {
  const regions = state.regions.filter(index => index !== region);
  const shared = new Set(regions.flatMap(index => regionPoints(net, index)));
  const removed = new Set(regionPoints(net, region).filter(v => state.regionVertices.includes(v) && !shared.has(v)));
  return { ...state, regions, vertices: state.vertices.filter(v => !removed.has(v)), regionVertices: state.regionVertices.filter(v => !removed.has(v)) };
}
export function vectorSelectionPosition(document: Document, state: VectorEditState): { x: number; y: number } | undefined {
  const node = document.nodes[state.id]; if (node?.kind !== "vector") return undefined;
  const points = selectedVectorPoints(node.network, state).flatMap(i => node.network.vertices[i] ? [transformPoint(layerTransform(node), node.network.vertices[i])] : []);
  if (!points.length) return undefined;
  return points.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }));
}
export function visibleVectorHandles(net: VectorNetwork, state: VectorEditState): readonly VectorHandle[] {
  const shown = new Set(state.vertices.filter(i => !state.regionVertices.includes(i))), segments = new Set(state.segments), result: VectorHandle[] = [];
  net.segments.forEach((s, i) => {
    for (const start of [true, false]) { const h = start ? s.ta : s.tb; if ((h[0] !== 0 || h[1] !== 0) && (segments.has(i) || shown.has(start ? s.a : s.b))) result.push([i, start]); }
  });
  return result;
}
export function vectorEditOverlay(document: Document, state: VectorEditState) {
  const net = vectorNetwork(document, state.id); if (!net) return undefined;
  const m = worldTransform(document, state.id), point = (p: { x: number; y: number }): readonly [number, number] => { const out = transformPoint(m, p); return [out.x, out.y]; };
  return {
    segments: net.segments.flatMap((_, i) => { const c = networkCubic(net, i); return c ? [c.map(point)] : []; }),
    vertices: net.vertices.map(point),
    handles: visibleVectorHandles(net, state).flatMap(([seg, start]) => {
      const s = net.segments[seg], v = net.vertices[start ? s.a : s.b], h = start ? s.ta : s.tb;
      return v ? [{ seg, start, vertex: point(v), handle: point({ x: v.x + h[0], y: v.y + h[1] }) }] : [];
    }), selectedVertices: state.vertices.filter(i => !state.regionVertices.includes(i)), selectedSegments: state.segments, selectedHandles: state.handles,
  };
}
/** Refit translates coordinates, never resizes them; all page-space points remain fixed. */
export function refitVector(node: VectorNode): VectorNode {
  const bounds = networkBounds(node.network);
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) return node;
  const translate = Math.abs(bounds.x) > 1e-9 || Math.abs(bounds.y) > 1e-9;
  if (!translate && bounds.width === node.width && bounds.height === node.height) return node;
  const next = { ...node, width: bounds.width, height: bounds.height };
  return translate ? withLayerTransform({ ...next, network: transformNetwork(node.network, [1, 0, 0, 1, -bounds.x, -bounds.y]) }, multiply(layerTransform(node), [1, 0, 0, 1, bounds.x, bounds.y])) : Object.freeze(next);
}
export function convertToVector(node: LeafNode): VectorNode {
  if (node.kind === "vector") return node;
  let network = networkFromPath(shapePath(node));
  if (node.kind === "line") network = freezeNetwork({ ...network, regions: [] });
  const { corners: _corners, ...common } = commonProperties(node);
  return refitVector(Object.freeze({ ...common, kind: "vector", network,
    ...(node.kind === "line" ? { stroke: Object.freeze({ ...(node.stroke ?? defaultStroke), align: "center" as const }) } : {}) }));
}
export function beginVectorEdit(document: Document, ids: readonly NodeId[]): { document: Document; state: VectorEditState; selection: readonly NodeId[] } {
  const draft = new HierarchyDraft(document), edited: NodeId[] = []; let firstError: string | undefined;
  for (const id of ids.slice(0, 500)) {
    if (edited.includes(id)) continue;
    const node = draft.nodes[id];
    if (!node || !isLeaf(node)) { firstError ??= node ? `${node.kind} layers can't be edited as vectors` : `No node ${id}`; continue; }
    draft.set(convertToVector(node)); edited.push(id);
  }
  if (!edited.length) throw new Error(firstError ?? "Select a shape");
  return { document: draft.finish(), state: newVectorEdit(edited[0], edited.slice(1)), selection: Object.freeze(edited) };
}
