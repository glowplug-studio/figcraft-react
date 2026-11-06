import { setRotationAboutCenter, transformBounds, withTranslation } from "./affine";
import { rectanglePaints, rectangleTransform, withRectanglePaints, withRectangleTransform, type Document, type NodeId, type RectangleNode } from "./document";
import { parseNodeId, parseNumber } from "./parameters";
import { parseColour } from "./colour-css";
import { readSolidPaints, solidPaint, type SolidPaint } from "./solid-paint";

const geometryKeys = new Set(["x", "y", "width", "height", "w", "h", "rotation"]);
const appearanceKeys = new Set(["name", "visible", "locked", "opacity", "fill", "fills"]);

function samePaints(left: readonly SolidPaint[], right: readonly SolidPaint[]): boolean {
  return left.length === right.length && left.every((paint, index) => {
    const other = right[index];
    return paint.type === other.type && paint.opacity === other.opacity && paint.visible === other.visible
      && paint.blend === other.blend && paint.colorAlpha === other.colorAlpha
      && paint.color.r === other.color.r && paint.color.g === other.color.g
      && paint.color.b === other.color.b && paint.color.a === other.color.a;
  });
}

/** The rectangle geometry and appearance subset of upstream `node.set`. No history is recorded here. */
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
  const unsupported = keys.filter(key => !geometryKeys.has(key) && !appearanceKeys.has(key));
  if (unsupported.length) throw new Error(`node.set unsupported properties: ${unsupported.join(", ")}`);

  // Parse before changing any node, so one invalid value refuses the entire selection.
  const values = Object.fromEntries(keys.filter(key => geometryKeys.has(key)).map(key => [key, parseNumber(props[key], key)])) as Record<string, number>;
  const name = "name" in props
    ? typeof props.name === "string" || typeof props.name === "number" && Number.isFinite(props.name)
      ? String(props.name) : (() => { throw new Error("name must be a string"); })()
    : undefined;
  for (const key of ["visible", "locked"] as const) {
    if (key in props && typeof props[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  }
  const opacity = "opacity" in props ? (() => {
    const fraction = parseNumber(props.opacity, "opacity");
    const percent = typeof props.opacity === "string" && props.opacity.trim().endsWith("%");
    const result = Math.fround(Math.max(0, Math.min(1, percent || fraction > 1 ? fraction / 100 : fraction)));
    if (!Number.isFinite(result)) throw new Error("opacity exceeds the finite native range");
    return result;
  })() : undefined;
  let paints: readonly SolidPaint[] | undefined;
  // Rust sorts equal-priority keys by name: `fills` replaces `fill` when both are present.
  if ("fill" in props) {
    if (props.fill === null || typeof props.fill === "string" && props.fill.toLowerCase() === "none") paints = Object.freeze([]);
    else {
      const colour = parseColour(props.fill);
      if (!colour) throw new Error("fill must be a colour, none or null");
      paints = Object.freeze([solidPaint(colour)]);
    }
  }
  if ("fills" in props) paints = readSolidPaints(props.fills, true);
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
    let updated: RectangleNode = Object.freeze({ ...withRectangleTransform(node, transform), width, height });
    if (name !== undefined && name !== node.name) updated = Object.freeze({ ...updated, name });
    if ("visible" in props && props.visible !== (node.visible ?? true)) updated = Object.freeze({ ...updated, visible: props.visible as boolean });
    if ("locked" in props && props.locked !== (node.locked ?? false)) updated = Object.freeze({ ...updated, locked: props.locked as boolean });
    if (opacity !== undefined && opacity !== (node.opacity ?? 1)) updated = Object.freeze({ ...updated, opacity });
    if (paints && !samePaints(rectanglePaints(node), paints)) updated = withRectanglePaints(updated, paints);
    nextNodes[id] = updated;
    if (width !== node.width || height !== node.height || transform.some((value, index) => value !== rectangleTransform(node)[index])
      || name !== undefined && name !== node.name || "visible" in props && props.visible !== (node.visible ?? true)
      || "locked" in props && props.locked !== (node.locked ?? false) || opacity !== undefined && opacity !== (node.opacity ?? 1)
      || paints && !samePaints(rectanglePaints(node), paints)) changed = true;
  }
  return changed ? Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, ...nextNodes }) }) : document;
}
