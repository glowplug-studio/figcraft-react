import { inverse, multiply, type Affine } from "./affine";
import { booleanResult } from "./boolean-result";
import { layerTransform, withLayerTransform, type Document, type LayerNode, type NodeId, type VectorNode } from "./document";
import { HierarchyDraft, pageForNode, worldTransform } from "./hierarchy";
import { captureLayers, type CopiedLayers } from "./layer-clipboard";
import { inspectedId, parseNumber } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { shapePath } from "./shape-path";
import { clampVectorEdit, clearVectorSelection, freezeVectorEdit, refitVector, vectorNetwork, vectorParts, type VectorEditPart, type VectorEditState } from "./vector-edit";
import { deleteVectorPart } from "./vector-edit-commands";
import { appendNetwork, freezeNetwork, networkFromPath, transformNetwork, type VectorNetwork, type VectorRegion, type VectorSegment, type VectorVertex } from "./vector-network";
import { networkBounds } from "./vector-path";

/**
 * Copy, cut and paste in vector edit mode. Source: engine/cmd/edit/vector_clipboard.rs (upstream #1875).
 *
 * With points or segments selected, Copy and Cut take just those: a temporary vector holding the selected segments
 * and the segments touching a selected point goes on the layer clipboard at its place on the page, so a paste
 * outside edit mode is a plain layer paste in place. Cut then removes the selection as Delete does and stays in edit
 * mode. Paste while editing adds the clipboard's layers to the edited vector's network in place: a vector with its
 * segments, a shape or a boolean group with its outline.
 */

/** The most segments a vector network takes through a paste. */
const MAX_SEGMENTS = 500_000;

export interface VectorEditSelection {
  /** Whether any edited layer has a point or a segment selected. */
  readonly any: boolean;
  /** Each edited layer with something to copy, and the part of its network that is. */
  readonly parts: readonly { readonly id: NodeId; readonly network: VectorNetwork }[];
  /** What Cut removes, per edited layer: the points and segments the copy was built from. */
  readonly remove: readonly VectorEditPart[];
}

/** Native `edit_selection`: what the edited layers have selected. */
export function vectorEditSelection(document: Document, state: VectorEditState): VectorEditSelection {
  const parts: { id: NodeId; network: VectorNetwork }[] = [], remove: VectorEditPart[] = []; let any = false;
  for (const part of vectorParts(state)) {
    if (!part.vertices.length && !part.segments.length) continue;
    any = true;
    const net = vectorNetwork(document, part.id); if (!net) continue;
    const active = part.id === state.id;
    // Points selected only through a selected region don't pull in the segments touching them: the region's own
    // segments are the selection.
    const vertices = part.vertices.filter(v => !active || !state.regionVertices.includes(v)), segments = [...part.segments];
    if (active) for (const r of state.regions) segments.push(...(net.regions[r]?.loops.flat() ?? []));
    remove.push({ id: part.id, vertices, segments });
    const sub = subNetwork(net, vertices, segments);
    if (sub) parts.push({ id: part.id, network: sub });
  }
  return { any, parts, remove };
}

/** The part of `net` that is `segments` and the segments touching a point of `vertices`, with the points they join.
 * A lone point with no segment draws nothing. The regions whose every segment is kept stay regions. */
function subNetwork(net: VectorNetwork, vertices: readonly number[], segments: readonly number[]): VectorNetwork | undefined {
  const picked = new Set(vertices), keep = new Set(segments.filter(i => Number.isInteger(i) && i >= 0 && i < net.segments.length));
  net.segments.forEach((s, i) => { if (picked.has(s.a) || picked.has(s.b)) keep.add(i); });
  const kept = [...keep].sort((a, b) => a - b), used = [...new Set(kept.flatMap(i => [net.segments[i].a, net.segments[i].b]))].sort((a, b) => a - b);
  if (!kept.length || used.some(v => !net.vertices[v])) return undefined;
  const points = new Map(used.map((old, i) => [old, i])), lines = new Map(kept.map((old, i) => [old, i]));
  const regions = net.regions.flatMap((r): VectorRegion[] => {
    const loops = r.loops.map(loop => loop.map(i => lines.get(i)));
    return loops.length && loops.every(loop => loop.every(i => i !== undefined)) ? [{ ...r, loops: loops as number[][] }] : [];
  });
  return freezeNetwork({ vertices: used.map(v => net.vertices[v]), regions,
    segments: kept.map(i => ({ ...net.segments[i], a: points.get(net.segments[i].a)!, b: points.get(net.segments[i].b)! })) });
}

/** Native `clip_node`: the clipboard's layer for edited vector `id` holding `sub`. It keeps the layer's look and its
 * place on the page. A variable width profile runs along the whole path, so it stays only when every segment is copied. */
function clipNode(document: Document, id: NodeId, sub: VectorNetwork): VectorNode | undefined {
  const node = document.nodes[id]; if (node?.kind !== "vector") return undefined;
  const bounds = networkBounds(sub); if (!bounds || !Object.values(bounds).every(Number.isFinite)) return undefined;
  const whole = node.network.segments.length === sub.segments.length;
  let stroke = node.stroke;
  if (!whole && stroke?.widthProfile !== undefined) { const { widthProfile: _profile, ...rest } = stroke; stroke = Object.freeze(rest); }
  const fitted = refitVector({ ...node, name: "Vector", network: sub, ...(stroke ? { stroke } : {}) });
  return withLayerTransform(fitted, multiply(worldTransform(document, node.parent), layerTransform(fitted)));
}

/** Native `copy_parts`: the selection's parts as temporary layers on the layer clipboard. The layers live only in the
 * clipboard's own source document, on the edited layer's page. */
function copyParts(document: Document, selection: VectorEditSelection, identity: symbol, nextId: bigint, refusal: string): { clip: CopiedLayers; segments: number } {
  const draft = new HierarchyDraft(document), roots: NodeId[] = []; let segments = 0;
  for (const part of selection.parts) {
    segments += part.network.segments.length;
    const node = clipNode(document, part.id, part.network); if (!node) continue;
    const allocated = draft.allocateId(nextId); nextId = allocated.nextId;
    draft.insert({ ...node, id: allocated.id }, pageForNode(document, part.id) ?? document.currentPage);
    roots.push(allocated.id);
  }
  if (!roots.length) throw new Error(refusal);
  return { clip: captureLayers(draft.finish(), [], { ids: roots }, identity, false), segments };
}

/** Native `copy_selection`. */
export function copyVectorSelection(document: Document, selection: VectorEditSelection, identity: symbol, nextId: bigint) {
  const { clip, segments } = copyParts(document, selection, identity, nextId, "The selection has nothing to copy");
  return { clip, result: { copied: clip.roots.length, segments } };
}

/** Native `cut_selection`: copy the selected segments, then remove the selection as Delete does. The path splits in
 * the same layer and edit mode stays on. It is refused exactly where Copy is: only lone points selected changes
 * nothing, the clipboard included. Delete removes such points. */
export function cutVectorSelection(document: Document, state: VectorEditState, selection: VectorEditSelection, identity: symbol, nextId: bigint) {
  const { clip, segments } = copyParts(document, selection, identity, nextId, "The selection has nothing to copy (Delete removes lone points)");
  const draft = new HierarchyDraft(document);
  for (const part of selection.remove) {
    const node = draft.nodes[part.id]; if (node?.kind !== "vector") continue;
    const network = deleteVectorPart(node.network, part, false);
    draft.set(refitVector(network === node.network ? node : { ...node, network }));
  }
  draft.normaliseGroups();
  const next = validateChangedGeometry(draft);
  return { clip, document: next, state: clampVectorEdit(next, freezeVectorEdit({ ...clearVectorSelection(state), anchor: undefined, penOut: undefined })),
    result: { cut: selection.parts.length, segments } };
}

/** Native `outline_network`: the outline of copied layer `node` in its own coordinates: a vector's segments, a shape's
 * or a boolean group's outline. Text, frames, groups and instances have none. */
function outlineNetwork(source: Document, node: LayerNode): VectorNetwork | undefined {
  let net: VectorNetwork | undefined;
  if (node.kind === "vector") net = node.network;
  else if (node.kind === "booleanOp") net = booleanResult(source, node)?.network;
  else if (node.kind === "rectangle" || node.kind === "ellipse" || node.kind === "polygon" || node.kind === "star") net = networkFromPath(shapePath(node));
  else if (node.kind === "line") net = freezeNetwork({ ...networkFromPath(shapePath(node)), regions: [] });
  return net?.segments.length ? net : undefined;
}

/** Native `placed`: `net` moved by `m`, with its handles, the regions' paint frames and the points' radii. */
function placed(net: VectorNetwork, m: Affine): VectorNetwork | undefined {
  if (!m.every(Number.isFinite)) return undefined;
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  try {
    const moved = transformNetwork(net, m);
    if (!moved.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y))) return undefined;
    return scale === 1 ? moved : freezeNetwork({ ...moved, vertices: moved.vertices.map(v => ({ ...v, radius: v.radius * scale })) });
  } catch { return undefined; }
}

const optional = (value: unknown): number | undefined => { if (value == null) return undefined; try { return parseNumber(value); } catch { return undefined; } };

/** Native `paste_into_vector`: the clipboard's layers join the edited vector's network in place (with `x` and `y`:
 * the copied top-left moved there), their points selected. Layers with no outline are skipped and named; when none
 * has one, nothing is pasted. No layer is created, so `ids` stays empty. */
export function pasteIntoVector(document: Document, state: VectorEditState, clip: CopiedLayers | undefined, p: Record<string, unknown>) {
  if (!clip?.roots.length) throw new Error("The clipboard is empty");
  const x = optional(p.x), y = optional(p.y);
  if ((x === undefined) !== (y === undefined)) throw new Error("Give both x and y, or neither");
  const shift: Affine = x !== undefined && y !== undefined && clip.bounds ? [1, 0, 0, 1, x - clip.bounds.x, y - clip.bounds.y] : [1, 0, 0, 1, 0, 0];
  const target = document.nodes[state.id]; if (target?.kind !== "vector") throw new Error("Not a vector");
  const toLocal = multiply(inverse(worldTransform(document, state.id)), shift), pieces: VectorNetwork[] = [], skipped: string[] = [];
  for (const root of clip.roots) {
    const node = clip.source.nodes[root]; if (!node || node.kind === "page") continue;
    const outline = outlineNetwork(clip.source, node), piece = outline && placed(outline, multiply(toLocal, worldTransform(clip.source, root)));
    if (piece) pieces.push(piece); else skipped.push(node.name);
  }
  if (!pieces.length) throw new Error("None of the copied layers has an outline to add to the vector (text, frames and groups have none)");
  if (target.network.segments.length + pieces.reduce((sum, piece) => sum + piece.segments.length, 0) > MAX_SEGMENTS) throw new Error(`A vector takes at most ${MAX_SEGMENTS} segments`);
  const network = { vertices: [...target.network.vertices] as VectorVertex[], segments: [...target.network.segments] as VectorSegment[], regions: [...target.network.regions] as VectorRegion[] };
  const pasted: number[] = [];
  for (const piece of pieces) {
    for (let i = 0; i < piece.vertices.length; i++) pasted.push(network.vertices.length + i);
    appendNetwork(network, piece);
  }
  const draft = new HierarchyDraft(document);
  draft.set(refitVector({ ...target, network: freezeNetwork(network) }));
  draft.normaliseGroups();
  const next = validateChangedGeometry(draft);
  const selected = freezeVectorEdit({ ...clearVectorSelection(state), vertices: pasted, anchor: undefined, penOut: undefined, widthPoint: undefined });
  return { document: next, state: clampVectorEdit(next, selected),
    result: { ids: [] as number[], edited: inspectedId(state.id), vertices: pasted.length, ...(skipped.length ? { skipped } : {}) } };
}
