import { inverse, multiply, type Affine } from "./affine";
import { fromRgba8 } from "./colour";
import { isLeaf, rectanglePaints, withRectanglePaints, type Document, type LayerNode, type NodeId, type VectorNode } from "./document";
import { HierarchyDraft, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseNodeId } from "./parameters";
import { shapePath } from "./shape-path";
import { solidPaint, type SolidPaint } from "./solid-paint";
import { defaultStroke } from "./stroke";
import { freezeNetwork, networkFromPath, regionPaintFrame, transformNetwork, type VectorNetwork, type VectorRegion, type VectorSegment, type VectorVertex } from "./vector-network";
import { networkBounds } from "./vector-path";

export const vectorSpecs = Object.freeze({
  "vector.flatten": { label: "Flatten", undo: true },
  "vector.reverse": { label: "Reverse path direction", undo: true },
});
function samePaints(a: readonly SolidPaint[], b: readonly SolidPaint[]): boolean {
  return a.length === b.length && a.every((p, i) => { const q = b[i]; return p.type === q.type && p.visible === q.visible && p.blend === q.blend && p.opacity === q.opacity && p.colorAlpha === q.colorAlpha && p.color.r === q.color.r && p.color.g === q.color.g && p.color.b === q.color.b && p.color.a === q.color.a; });
}
/** Flatten keeps source networks (including open runs), attaching each region's original paint frame. */
function flattenedNetwork(document: Document, ids: readonly NodeId[], parent: NodeId, fallback: readonly SolidPaint[] | undefined, output: readonly SolidPaint[]): VectorNetwork {
  const vertices: VectorVertex[] = [], segments: VectorSegment[] = [], regions: VectorRegion[] = [], toParent = inverse(worldTransform(document, parent));
  const append = (node: LayerNode, source: VectorNetwork, intoParent: Affine) => {
    const paints = rectanglePaints(node), effective = paints.length ? paints : fallback ?? paints;
    const framed = freezeNetwork({ ...source, regions: source.regions.map(region => ({ ...region, ...(region.fills === undefined && !samePaints(effective, output) ? { fills: effective } : {}), paintSpace: regionPaintFrame(region, node.width, node.height) })) });
    const part = transformNetwork(framed, intoParent), nv = vertices.length, ns = segments.length;
    for (const v of part.vertices) vertices.push(v);
    for (const s of part.segments) segments.push({ ...s, a: s.a + nv, b: s.b + nv });
    for (const r of part.regions) regions.push({ ...r, loops: r.loops.map(loop => loop.map(i => i + ns)) });
  };
  const collect = (id: NodeId, depth: number): void => {
    if (depth > 64) throw new Error("vector.flatten: group nesting exceeds 64");
    const node = document.nodes[id]; if (!node) return;
    if (node.kind === "page") throw new Error("Cannot flatten a page");
    const intoParent = multiply(toParent, worldTransform(document, id));
    if (!isLeaf(node) && node.children.length) {
      if (node.kind === "frame" && rectanglePaints(node).some(p => p.visible)) append(node, networkFromPath(shapePath(node)), intoParent);
      for (const child of node.children) { const item = document.nodes[child]; if (item && item.kind !== "page" && item.visible !== false) collect(child, depth + 1); }
      return;
    }
    if (node.kind === "group") return;
    let part = node.kind === "vector" ? node.network : networkFromPath(shapePath(node));
    if (node.kind === "vector" && part.regions.length && part.regions.every(r => r.fills === undefined && r.paintSpace === undefined)) {
      part = freezeNetwork({ ...part, regions: [{ loops: part.regions.flatMap(r => r.loops), winding: part.regions.some(r => r.winding === "evenOdd") ? "evenOdd" : "nonZero" }] });
    }
    append(node, part, intoParent);
  };
  for (const id of ids) collect(id, 0);
  return freezeNetwork({ vertices, segments, regions });
}
export function executeVector(command: string, document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string, unknown>) {
  if (!Object.hasOwn(vectorSpecs, command)) throw new Error(`Unsupported vector command: ${command}`);
  if (Object.keys(params).some(k => k !== "ids" && k !== "id")) throw new Error(`Unsupported ${command} parameter`);
  if (params.ids !== undefined && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const raw = params.ids ?? params.id, targets = raw === undefined ? selection : (Array.isArray(raw) ? raw : [raw]).map(parseNodeId).filter((id): id is NodeId => id !== undefined);
  if (!targets.length) throw new Error("Nothing selected");
  for (const id of targets) if (!document.nodes[id]) throw new Error(`No node ${id}`);
  const draft = new HierarchyDraft(document);
  if (command === "vector.reverse") {
    for (const id of targets) {
      const node = draft.nodes[id];
      if (node.kind === "vector" && node.network.segments.length) draft.set({ ...node, network: freezeNetwork({ ...node.network, segments: node.network.segments.map(s => ({ a: s.b, b: s.a, ta: s.tb, tb: s.ta })) }) });
    }
    return { document: draft.finish(), selection, nextId, result: { ok: true } };
  }
  const ids = zSorted(document, rootIds(document, targets)), first = document.nodes[ids[0]], top = document.nodes[ids.at(-1)!];
  if (!top.parent || first.kind === "page") throw new Error("Cannot flatten a page");
  const parent = document.nodes[top.parent]; if (isLeaf(parent)) throw new Error("Invalid parent");
  const inherited = rectanglePaints(first), fallback = (first.kind === "line" || first.kind === "group") && !inherited.length ? Object.freeze([solidPaint(fromRgba8(217, 217, 217))]) : undefined;
  const fills = fallback ?? inherited, network = flattenedNetwork(document, ids, parent.id, fallback, fills), bounds = networkBounds(network);
  if (!bounds) throw new Error("Nothing to flatten");
  if (nextId > 18446744073709551615n || document.nodes[String(nextId)]) throw new Error("Document identifiers are exhausted");
  const id = String(nextId);
  const node: VectorNode = withRectanglePaints({ id, kind: "vector", name: first.name, parent: parent.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    fill: "transparent", network: transformNetwork(network, [1, 0, 0, 1, -bounds.x, -bounds.y]),
    ...(first.strokes ? { strokes: first.strokes } : {}), stroke: Object.freeze({ ...(first.stroke ?? defaultStroke), align: "center" }),
    ...(first.opacity === undefined ? {} : { opacity: first.opacity }), ...(first.blend === "passThrough" ? { blend: "normal" as const } : first.blend ? { blend: first.blend } : {}) }, fills);
  draft.insert(node, parent.id, parent.children.indexOf(top.id) + 1);
  for (const id of ids) draft.remove(id);
  draft.normaliseGroups();
  return { document: draft.finish(), selection: Object.freeze([id]), nextId: nextId < 18446744073709551615n ? nextId + 1n : nextId, result: { id } };
}
