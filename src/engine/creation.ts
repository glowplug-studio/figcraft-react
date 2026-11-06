import { isLeaf, withLayerTransform, type Document, type LayerNode, type NodeId } from "./document";
import { inverse, multiply, transformBounds, type Affine } from "./affine";
import { HierarchyDraft, frameRelative, pageForNode, worldTransform } from "./hierarchy";
import { nextLayerName } from "./structure";
import { presetParameters } from "./frame-presets";
import { parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { setRectangleProperties } from "./properties";
import type { Viewport } from "./viewport";
const number = (p: Record<string, unknown>, key: string, fallback: number): number => {
  // JSON cannot carry non-finite numbers; reject those at the browser command boundary.
  if (typeof p[key] === "number" && !Number.isFinite(p[key])) throw new Error(`${key} must be finite`);
  try { return parseNumber(p[key], key); } catch { return fallback; }
};
/** Shared native creation reducer for commands and captured drawing previews. */
export function createLayer(before: { document: Document; selection: readonly NodeId[] }, nextId: bigint, command: string, p: Record<string, unknown>, view: Viewport, placement?: Affine) {
    if (command === "frame.create") p = presetParameters(before.document, view, p);
    const allowed = ["x", "y", "width", "height", "parent", "index", "name", "select", "props", ...(command === "node.create" ? ["type"] : [])];
    for (const key of Object.keys(p)) if (!allowed.includes(key)) throw new Error(`Unsupported creation parameter: ${key}`);
    if (command === "node.create" && (typeof p.type !== "string" || !["rectangle", "rect", "group", "frame", "ellipse", "circle", "oval", "polygon", "triangle", "star"].includes(p.type.toLowerCase()))) throw new Error("Only rectangle, ellipse, polygon, star, group and frame nodes are supported");
    const requested = command === "node.create" ? String(p.type).toLowerCase() : command === "frame.create" ? "frame" : command.slice("shape.".length);
    const kind = requested === "rect" ? "rectangle" : ["circle", "oval"].includes(requested) ? "ellipse" : requested === "triangle" ? "polygon" : requested;
    if (nextId > 18446744073709551615n || before.document.nodes[String(nextId)]) throw new Error("Document identifiers are exhausted");
    const parentId = p.parent == null ? before.document.currentPage : parseNodeId(p.parent);
    const parent = parentId === undefined ? undefined : before.document.nodes[parentId];
    if (!parent || isLeaf(parent)) throw new Error("The parent must be a container");
    const index = p.index == null ? parent.children.length : parseNumber(p.index, "index");
    if (!Number.isInteger(index) || index < 0 || index >= 1e9) throw new Error("index must be a whole number from 0 to less than 1e9");
    const base = { id: String(nextId), name: parseString(p.name) ?? ( kind === "ellipse" ? "Ellipse" : kind === "polygon" ? "Polygon" : kind === "star" ? "Star" : kind !== "rectangle" ? nextLayerName(before.document, kind === "frame" ? "Frame" : "Group") : "Rectangle"), parent: parent.id,
      x: number(p, "x", 0), y: number(p, "y", 0), width: Math.max(0, number(p, "width", 100)), height: Math.max(0, number(p, "height", 100)) };
    let node: LayerNode = kind === "frame" ? Object.freeze({ ...base, kind, children: Object.freeze([]), fill: "#ffffff", blend: "passThrough", clip: true }) : kind === "group" ? Object.freeze({ ...base, kind, children: Object.freeze([]), fill: "transparent", blend: "passThrough" }) : kind === "ellipse" ? Object.freeze({ ...base, kind, start: 0, sweep: 2 * Math.PI, inner: 0, fill: "#d9d9d9" }) : kind === "polygon" ? Object.freeze({ ...base, kind, count: 3, fill: "#d9d9d9" }) : kind === "star" ? Object.freeze({ ...base, kind, count: 5, innerRatio: .38, fill: "#d9d9d9" }) : Object.freeze({ ...base, kind: "rectangle", fill: "#d9d9d9" });
    transformBounds([1, 0, 0, 1, node.x, node.y], node.width, node.height);
    if (placement) node = withLayerTransform(node, multiply(inverse(worldTransform(before.document, parent.id)), placement));
    else if (parent.kind === "group") node = withLayerTransform(node, multiply(inverse(frameRelative(before.document, parent.id)), [1, 0, 0, 1, node.x, node.y]));
    const draft = new HierarchyDraft(before.document);
    draft.insert(node, parent.id, index);
    let document: Document;
    if (p.props !== null && typeof p.props === "object" && !Array.isArray(p.props)) {
      document = setRectangleProperties(draft.finish(), [node.id], { props: p.props });
      const derived = new HierarchyDraft(document);
      if (document.nodes[node.id]) derived.changedIds.add(node.id);
      derived.normaliseGroups(); document = derived.finish();
    }
    else { draft.normaliseGroups(); document = draft.finish(); }

    return { document, selection: Object.freeze((parseBoolean(p.select) === false ? before.selection : [node.id]).filter(id => document.nodes[id] && pageForNode(document, id) === document.currentPage)), nextId: nextId < 18446744073709551615n ? nextId + 1n : nextId, id: node.id };
}
