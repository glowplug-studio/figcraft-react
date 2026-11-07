import { emptyNetwork, freezeNetwork } from "./vector-network";
import { pathNetwork, pointsNetwork } from "./svg-path";
import { isLeaf, withLayerTransform, type Document, type LayerNode, type NodeId } from "./document";
import { inverse, multiply, transformBounds, type Affine } from "./affine";
import { HierarchyDraft, frameRelative, pageForNode, worldTransform } from "./hierarchy";
import { nextLayerName } from "./structure";
import { presetParameters } from "./frame-presets";
import { parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { setRectangleProperties } from "./properties";
import type { Viewport } from "./viewport";
import { defaultStroke } from "./stroke";
import { solidPaint } from "./solid-paint";
import { fromRgba8 } from "./colour";
const number = (p: Record<string, unknown>, key: string, fallback: number): number => {
  // JSON cannot carry non-finite numbers; reject those at the browser command boundary.
  if (typeof p[key] === "number" && !Number.isFinite(p[key])) throw new Error(`${key} must be finite`);
  try { return parseNumber(p[key], key); } catch { return fallback; }
};
/** Shared native creation reducer for commands and captured drawing previews. */
export function createLayer(before: { document: Document; selection: readonly NodeId[] }, nextId: bigint, command: string, p: Record<string, unknown>, view: Viewport, placement?: Affine) {
    if (command === "frame.create") p = presetParameters(before.document, view, p);
    const allowed = ["x", "y", "width", "height", "parent", "index", "name", "select", "props", "path", "points", "closed", ...(command === "node.create" ? ["type"] : [])];
    for (const key of Object.keys(p)) if (!allowed.includes(key)) throw new Error(`Unsupported creation parameter: ${key}`);
    if (command === "node.create" && (typeof p.type !== "string" || !["rectangle", "rect", "group", "frame", "ellipse", "circle", "oval", "polygon", "triangle", "star", "line", "arrow", "vector", "path"].includes(p.type.toLowerCase()))) throw new Error("Only rectangle, ellipse, polygon, star, line, arrow, vector, group and frame nodes are supported");
    const requested = command === "node.create" ? String(p.type).toLowerCase() : command === "frame.create" ? "frame" : command === "vector.create" ? "vector" : command.slice("shape.".length);
    const kind = requested === "rect" ? "rectangle" : requested === "path" ? "vector" : ["circle", "oval"].includes(requested) ? "ellipse" : requested === "triangle" ? "polygon" : requested === "arrow" ? "line" : requested;
    if (nextId > 18446744073709551615n || before.document.nodes[String(nextId)]) throw new Error("Document identifiers are exhausted");
    const parentId = p.parent == null ? before.document.currentPage : parseNodeId(p.parent);
    const parent = parentId === undefined ? undefined : before.document.nodes[parentId];
    if (!parent || isLeaf(parent)) throw new Error("The parent must be a container");
    const index = p.index == null ? parent.children.length : parseNumber(p.index, "index");
    if (!Number.isInteger(index) || index < 0 || index >= 1e9) throw new Error("index must be a whole number from 0 to less than 1e9");
    const base = { id: String(nextId), name: parseString(p.name) ?? (kind === "line" ? requested === "arrow" ? "Arrow" : "Line" : kind === "ellipse" ? "Ellipse" : kind === "polygon" ? "Polygon" : kind === "star" ? "Star" : kind === "vector" ? "Vector" : kind !== "rectangle" ? nextLayerName(before.document, kind === "frame" ? "Frame" : "Group") : "Rectangle"), parent: parent.id,
      x: number(p, "x", 0), y: number(p, "y", 0), width: Math.max(0, number(p, "width", 100)), height: kind === "line" ? 0 : Math.max(0, number(p, "height", 100)) };
    let node: LayerNode = kind === "frame" ? Object.freeze({ ...base, kind, children: Object.freeze([]), fill: "#ffffff", blend: "passThrough", clip: true }) : kind === "group" ? Object.freeze({ ...base, kind, children: Object.freeze([]), fill: "transparent", blend: "passThrough" }) : kind === "ellipse" ? Object.freeze({ ...base, kind, start: 0, sweep: 2 * Math.PI, inner: 0, fill: "#d9d9d9" }) : kind === "polygon" ? Object.freeze({ ...base, kind, count: 3, fill: "#d9d9d9" }) : kind === "star" ? Object.freeze({ ...base, kind, count: 5, innerRatio: .38, fill: "#d9d9d9" }) : Object.freeze({ ...base, kind: "rectangle", fill: "#d9d9d9" });
    if (kind === "line") node = Object.freeze({ ...base, kind, fill: "transparent", strokes: Object.freeze([solidPaint(fromRgba8(0, 0, 0, 255))]), stroke: Object.freeze({ ...defaultStroke, align: "center", capEnd: requested === "arrow" ? "lineArrow" : "none" }) });
    if (kind === "vector") {
      const optional = (key: string) => { try { return parseNumber(p[key]); } catch { return undefined; } };
      const data = parseString(p.path), width = optional("width"), height = optional("height");
      const points = data === undefined && Array.isArray(p.points) ? Array.from(p.points, value => {
        if (Array.isArray(value) && value.length === 2) {
          try { return { x: parseNumber(value[0]), y: parseNumber(value[1]) }; } catch { /* Report the pair error below. */ }
        }
        throw new Error("`points` entries must be numeric [x, y] pairs");
      }) : undefined;
      const shape = data !== undefined ? pathNetwork(data, width, height) : points ? pointsNetwork(points, parseBoolean(p.closed) ?? false, width, height) : undefined;
      const network = shape ? data !== undefined && parseBoolean(p.closed) === false ? freezeNetwork({ ...shape.network, regions: [] }) : shape.network : emptyNetwork();
      node = Object.freeze({ ...base, kind: "vector", network, fill: "#d9d9d9", stroke: Object.freeze({ ...defaultStroke, align: "center" }),
        ...(shape ? { width: shape.width, height: shape.height, x: base.x + shape.offset.x, y: base.y + shape.offset.y } : {}) });
    }
    transformBounds([1, 0, 0, 1, node.x, node.y], node.width, node.height);
    if (placement) node = withLayerTransform(node, multiply(inverse(worldTransform(before.document, parent.id)), placement));
    else if (parent.kind === "group") node = withLayerTransform(node, multiply(inverse(frameRelative(before.document, parent.id)), [1, 0, 0, 1, node.x, node.y]));
    const draft = new HierarchyDraft(before.document);
    draft.insert(node, parent.id, index);
    let document: Document;
    if (p.props !== null && typeof p.props === "object" && !Array.isArray(p.props) && Object.keys(p.props).length > 0) {
      document = setRectangleProperties(draft.finish(), [node.id], { props: p.props });
      const derived = new HierarchyDraft(document);
      if (document.nodes[node.id]) derived.changedIds.add(node.id);
      derived.normaliseGroups(); document = derived.finish();
    }
    else { draft.normaliseGroups(); document = draft.finish(); }

    return { document, selection: Object.freeze((parseBoolean(p.select) === false ? before.selection : [node.id]).filter(id => document.nodes[id] && pageForNode(document, id) === document.currentPage)), nextId: nextId < 18446744073709551615n ? nextId + 1n : nextId, id: node.id };
}
