import { setRotationAboutCenter, transformBounds, withTranslation } from "./affine";
import { rectangleTransform, withRectangleTransform, type Document, type NodeId, type RectangleNode } from "./document";
import { parseNodeId, parseNumber } from "./parameters";

const geometryKeys = new Set(["x", "y", "width", "height", "w", "h", "rotation"]);

/** The rectangle geometry subset of upstream `node.set`. No history is recorded here. */
export function setRectangleProperties(document: Document, selection: readonly NodeId[], params: Record<string, unknown>): Document {
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("node.set ids must be an array");
  const rawTargets = params.ids ?? params.id;
  const suppliedTargets = rawTargets == null ? selection : Array.isArray(rawTargets) ? rawTargets : [rawTargets];
  if (suppliedTargets.length === 0) throw new Error("node.set requires at least one target");
  const ids = [...new Set(suppliedTargets.map(value => {
    const id = parseNodeId(value);
    if (id === undefined) throw new Error("node.set requires valid node IDs");
    return id;
  }))];
  const rawProps = params.props;
  if (rawProps !== undefined && (rawProps === null || typeof rawProps !== "object" || Array.isArray(rawProps))) {
    throw new Error("node.set props must be an object");
  }
  const props = rawProps === undefined
    ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== "id" && key !== "ids"))
    : rawProps as Record<string, unknown>;
  const keys = Object.keys(props);
  if (keys.length === 0) throw new Error("node.set requires properties");
  const unsupported = keys.filter(key => !geometryKeys.has(key));
  if (unsupported.length) throw new Error(`node.set unsupported properties: ${unsupported.join(", ")}`);

  // Parse before changing any node, so one invalid value refuses the entire selection.
  const values = Object.fromEntries(keys.map(key => [key, parseNumber(props[key], key)])) as Record<string, number>;
  const nextNodes: Record<NodeId, RectangleNode> = {};
  let changed = false;
  for (const id of ids) {
    const node = document.nodes[id];
    if (!node || node.kind !== "rectangle") throw new Error(`node.set target ${id} is not a rectangle`);
    let width = node.width;
    let height = node.height;
    // Upstream sorts equal-priority geometry keys by name; aliases may coexist.
    for (const key of keys.filter(key => key === "width" || key === "height" || key === "w" || key === "h").sort()) {
      if (key === "width" || key === "w") width = Math.max(0, values[key]);
      else height = Math.max(0, values[key]);
    }
    let transform = rectangleTransform(node);
    if ("rotation" in values) transform = setRotationAboutCenter(transform, width, height, values.rotation);
    if ("x" in values || "y" in values) {
      transform = withTranslation(transform, {
        x: "x" in values ? values.x : transform[4],
        y: "y" in values ? values.y : transform[5],
      });
    }
    transformBounds(transform, width, height);
    const updated = Object.freeze({ ...withRectangleTransform(node, transform), width, height });
    nextNodes[id] = updated;
    if (width !== node.width || height !== node.height || transform.some((value, index) => value !== rectangleTransform(node)[index])) changed = true;
  }
  return changed ? Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, ...nextNodes }) }) : document;
}
