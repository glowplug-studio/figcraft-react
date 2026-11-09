import { booleanResult, paintedStrokePath } from "./boolean-result";
import { inverse, multiply, type Affine } from "./affine";
import { fromRgba8 } from "./colour";
import { layerTransform, withLayerTransform, isLeaf, rectanglePaints, withRectanglePaints, type Document, type LayerNode, type NodeId, type VectorNode } from "./document";
import { HierarchyDraft, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseNodeId, parseNumber } from "./parameters";
import { isClosedShape, shapePath } from "./shape-path";
import { samePaints, solidPaint, type Paint } from "./solid-paint";
import { defaultStroke } from "./stroke";
import { appendNetwork, freezeNetwork, vectorLine, networkFromPath, regionPaintFrame, transformNetwork, type VectorNetwork, type VectorRegion, type VectorSegment, type VectorVertex } from "./vector-network";
import { networkBounds } from "./vector-path";
import { simplifyVector } from "./vector-simplify";
import { offsetLayer } from "./vector-offset";
import { reverseLoop, setFillRule } from "./vector-winding";

export type VectorJoinCommand = "vector.join" | "vector.smoothJoin";
export function isVectorJoin(command: string): command is VectorJoinCommand {
  return command === "vector.join" || command === "vector.smoothJoin";
}

export const vectorSpecs = Object.freeze({
  "vector.join": { label: "Join selection", undo: true },
  "vector.smoothJoin": { label: "Smooth join selection", undo: true },
  "vector.fillRule": { label: "Set fill rule", undo: true },
  "vector.reverseLoop": { label: "Reverse loop", undo: true },
  "bool.flatten": { label: "Flatten boolean", undo: true },
  "vector.simplify": { label: "Simplify vector", undo: true },
  "vector.offset": { label: "Offset path", undo: true },
  "vector.outlineStroke": { label: "Outline stroke", undo: true },
  "vector.flatten": { label: "Flatten", undo: true },
  "vector.reverse": { label: "Reverse path direction", undo: true },
});
/** Flatten keeps source networks (including open runs), attaching each region's original paint frame. */
function flattenedNetwork(document: Document, ids: readonly NodeId[], parent: NodeId, fallback: readonly Paint[] | undefined, output: readonly Paint[]): VectorNetwork {
  const vertices: VectorVertex[] = [], segments: VectorSegment[] = [], regions: VectorRegion[] = [], toParent = inverse(worldTransform(document, parent));
  const append = (node: LayerNode, source: VectorNetwork, intoParent: Affine) => {
    const paints = rectanglePaints(node), effective = paints.length ? paints : fallback ?? paints;
    const framed = freezeNetwork({ ...source, regions: source.regions.map(region => ({ ...region, ...(region.fills === undefined && !samePaints(effective, output) ? { fills: effective } : {}), paintSpace: regionPaintFrame(region, node.width, node.height) })) });
    appendNetwork({ vertices, segments, regions }, transformNetwork(framed, intoParent));
  };
  const collect = (id: NodeId, depth: number): void => {
    if (depth > 64) throw new Error("vector.flatten: group nesting exceeds 64");
    const node = document.nodes[id]; if (!node) return;
    if (node.kind === "page") throw new Error("Cannot flatten a page");
    const intoParent = multiply(toParent, worldTransform(document, id));
    if (node.kind === "booleanOp") {
      const result = booleanResult(document, node, 0, true);
      if (result) append(node, result.network, intoParent);
      return;
    }
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
export function executeVector(command: string, document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string, unknown>): {
  document: Document; selection: readonly NodeId[]; nextId: bigint; result: Record<string, unknown>;
} {
  if (!Object.hasOwn(vectorSpecs, command)) throw new Error(`Unsupported vector command: ${command}`);
  const allowed = ["ids", "id"];
  if (command === "vector.simplify") allowed.push("tolerance");
  if (command === "vector.offset") allowed.push("offset");
  if (command === "vector.fillRule") allowed.push("region", "rule");
  if (command === "vector.reverseLoop") allowed.push("region", "loop");
  if (Object.keys(params).some(k => !allowed.includes(k))) throw new Error(`Unsupported ${command} parameter`);
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const raw = Array.isArray(params.ids) ? params.ids : params.id != null ? [params.id] : selection;
  const targets = raw.map(value => {
    const id = parseNodeId(value);
    if (id === undefined) throw new Error("Every target must be a node id");
    return id;
  });
  if (!targets.length) throw new Error("Nothing selected");
  for (const id of targets) if (!document.nodes[id]) throw new Error(`No node ${id}`);
  const draft = new HierarchyDraft(document);
  if (command === "vector.fillRule" || command === "vector.reverseLoop") {
    const result = command === "vector.fillRule" ? setFillRule(draft, targets, params) : reverseLoop(draft, targets, params);
    return { document: draft.finish(), selection, nextId, result };
  }
  if (isVectorJoin(command) && targets.length === 1) {
    const node = document.nodes[targets[0]];
    if (node.kind === "vector" && !node.network.regions.length && node.network.vertices.length > 2) {
      const net = node.network;
      const segments = [...net.segments, vectorLine(net.vertices.length - 1, 0)];
      const region: VectorRegion = { loops: [segments.map((_, i) => i)], winding: "nonZero" };
      draft.set({ ...node, network: freezeNetwork({ ...net, segments, regions: [region] }) });
    }
    return { document: draft.finish(), selection, nextId, result: { ok: true } };
  }
  if (command === "vector.simplify") {
    let tolerance = 0.5;
    try { tolerance = Math.max(0.01, parseNumber(params.tolerance, "tolerance")); }
    catch { /* The native optional numeric parameter falls back to 0.5. */ }
    for (const id of targets) {
      const node = draft.nodes[id];
      if (node.kind === "vector") draft.set(simplifyVector(node, tolerance));
    }
    return { document: draft.finish(), selection, nextId, result: { ok: true } };
  }
  if (command === "vector.offset") {
    const distance = parseNumber(params.offset, "offset");
    for (const id of targets) {
      const node = draft.nodes[id];
      if (distance && node.kind !== "page" && (isLeaf(node) || !node.children.length)) {
        const next = offsetLayer(node, distance);
        if (next) draft.set(next);
      }
    }
    draft.normaliseGroups();
    return { document: draft.finish(), selection, nextId, result: { ok: true } };
  }
  if (command === "vector.outlineStroke") {
    const outlined: NodeId[] = [];
    const allocate = () => {
      if (nextId > 18446744073709551615n || draft.nodes[String(nextId)]) throw new Error("Document identifiers are exhausted");
      const id = String(nextId);
      if (nextId < 18446744073709551615n) nextId++;
      return id;
    };
    for (const id of targets) {
      const source = draft.nodes[id];
      if (!source) throw new Error(`No node ${id}`);
      if (source.kind === "page") continue;
      const path = paintedStrokePath(draft.document, source);
      if (!path) continue;
      const network = networkFromPath(path), box = networkBounds(network) ?? { x: 0, y: 0, width: 0, height: 0 };
      const local = transformNetwork(network, [1, 0, 0, 1, -box.x, -box.y]);
      const filled = freezeNetwork({ ...local, regions: local.regions.map(r => ({ ...r, winding: "evenOdd" })) });
      const vid = allocate(), parent = draft.nodes[source.parent];
      if (isLeaf(parent)) throw new Error("Invalid parent");
      const index = parent.children.indexOf(id);
      const paintedRegion = source.kind === "vector" && source.network.regions.some(r => r.fills?.some(p => p.visible));
      const keepFill = isClosedShape(source) && (rectanglePaints(source).some(p => p.visible) || paintedRegion);
      const vector = withRectanglePaints(withLayerTransform<VectorNode>({
        kind: "vector", id: vid, name: source.name, parent: parent.id, network: filled,
        x: 0, y: 0, width: box.width, height: box.height, fill: "transparent",
        ...(!keepFill && { opacity: source.opacity, blend: source.blend, constraints: source.constraints, ...(source.childLayout && {childLayout: source.childLayout}),
          ...((source.kind === "text" ? source.textSizing : source.sizing) && {sizing: source.kind === "text" ? source.textSizing : source.sizing}), visible: source.visible, locked: source.locked }),
      }, multiply(layerTransform(source), [1, 0, 0, 1, box.x, box.y])), source.strokes ?? []);
      draft.insert(vector, parent.id, index + 1);
      if (keepFill) {
        draft.set({ ...source, strokes: Object.freeze([]) });
        const gid = allocate();
        draft.insert({ kind: "group", id: gid, name: source.name, parent: parent.id, children: [],
          x: 0, y: 0, width: 0, height: 0, fill: "transparent", blend: "passThrough" }, parent.id, index + 2);
        draft.reparent(id, gid);
        draft.reparent(vid, gid);
        draft.fitToChildren(gid);
        outlined.push(gid);
      } else {
        draft.remove(id);
        outlined.push(vid);
      }
    }
    draft.normaliseGroups();
    return { document: draft.finish(), selection: Object.freeze(outlined), nextId, result: { ids: outlined } };
  }
  // Native Join on several layers uses Flatten, including its region paint and placement rules.
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
