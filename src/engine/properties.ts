import { isBooleanOperation, isGroupLike } from "./document";
import { pathNetwork } from "./svg-path";
import { freezeNetwork } from "./vector-network";
import { isShapeKey, setShapeProperties } from "./shape-properties";
import { isStrokeKey, setStrokeProperties } from "./stroke";
import { isArcKey, setArc } from "./ellipse";
import { isLeaf, withLayerSize } from "./document";
import { isCornerKey, setCorners, zeroCorners } from "./corners";
import { identity, inverse, multiply, setRotationAboutCenter, transformBounds, transformPoint, withTranslation } from "./affine";
import { defaultConstraints, rectanglePaints, rectangleTransform, withRectanglePaints, withRectangleTransform, type Document, type NodeId, type LayerNode } from "./document";
import { HierarchyDraft, frameRelative, rootIds, worldTransform } from "./hierarchy";
import { parseNodeId, parseNumber } from "./parameters";
import { parseColour } from "./colour-css";
import { samePaints, readPaints, solidPaint, type Paint } from "./solid-paint";

import { readConstraints, resizeChildren } from "./constraints";
import { localOrigin, sameIds, validateChangedGeometry } from "./rotation";
import { moveWorld } from "./arrange";
import type { Point } from "./geometry";

const geometryKeys = new Set(["x", "y", "width", "height", "w", "h", "rotation"]);
const appearanceKeys = new Set(["booleanOperation", "operandOperation", "name", "visible", "locked", "opacity", "fill", "fills", "clip", "constraints", "constrainProportions"]);

/** The supported layer geometry and appearance subset of upstream `node.set`. No history is recorded here. */
export function setRectangleProperties(document: Document, selection: readonly NodeId[], params: Record<string, unknown>, origin?: Point, warnings: string[] = []): Document {
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("node.set ids must be an array");
  const rawTargets = params.ids ?? params.id;
  const suppliedTargets = rawTargets == null ? selection : Array.isArray(rawTargets) ? rawTargets : [rawTargets];
  if (suppliedTargets.length === 0) throw new Error("node.set requires at least one target");
  const requestedIds = suppliedTargets.map(value => {
    const id = parseNodeId(value);
    if (id === undefined) throw new Error("node.set requires valid node IDs");
    return id;
  });
  const ids = [...new Set(requestedIds)];
  const rawProps = params.props;
  if (rawProps !== undefined && (rawProps === null || typeof rawProps !== "object" || Array.isArray(rawProps))) {
    throw new Error("node.set props must be an object");
  }
  const props = rawProps === undefined
    ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== "id" && key !== "ids"))
    : rawProps as Record<string, unknown>;
  const keys = Object.keys(props);
  if (keys.length === 0) throw new Error("node.set requires properties");
  const unsupported = keys.filter(key => key !== "path" && !geometryKeys.has(key) && !appearanceKeys.has(key) && !isCornerKey(key) && !isArcKey(key) && !isShapeKey(key) && !isStrokeKey(key));
  if (unsupported.length) throw new Error(`node.set unsupported properties: ${unsupported.join(", ")}`);
  const hasPath = Object.hasOwn(props, "path"), vectors = ids.filter(id => document.nodes[id]?.kind === "vector");
  if (hasPath && !vectors.length) { const node = document.nodes[ids[0]]; throw new Error(`path applies to vector layers; ${node?.name ?? ids[0]} is not a vector`); }
  const skipped = hasPath ? ids.filter(id => document.nodes[id]?.kind !== "vector") : [];
  if (skipped.length) warnings.push(`\`path\` skipped on ${skipped.slice(0, 10).map(id => `${id} “${document.nodes[id]?.name ?? id}” (${document.nodes[id]?.kind ?? "missing"})`).join(", ")}${skipped.length > 10 ? ` and ${skipped.length - 10} more` : ""}: only vector layers have a path`);
  const shape = hasPath ? (() => {
    if (typeof props.path !== "string") throw new Error("path must be SVG path data (a string)");
    const size = (long: string, short: string) => Object.hasOwn(props, long) ? parseNumber(props[long], long) : Object.hasOwn(props, short) ? parseNumber(props[short], long) : undefined;
    return pathNetwork(props.path, size("width", "w"), size("height", "h"));
  })() : undefined;
  const pivot = origin && "rotation" in props && !("x" in props) && !("y" in props) && sameIds(requestedIds, selection) ? origin : undefined;
  const pinned = pivot ? rootIds(document, ids).map(id => ({ id, point: localOrigin(document, id, pivot) })) : [];

  // Parse before changing any node, so one invalid value refuses the entire selection.
  const values = Object.fromEntries(keys.filter(key => geometryKeys.has(key) && !(hasPath && !skipped.length && ["width", "height", "w", "h"].includes(key))).map(key => [key, parseNumber(props[key], key)])) as Record<string, number>;
  const name = "name" in props
    ? typeof props.name === "string" || typeof props.name === "number" && Number.isFinite(props.name)
      ? String(props.name) : (() => { throw new Error("name must be a string"); })()
    : undefined;
  for (const key of ["visible", "locked", "clip", "constrainProportions"] as const) {
    if (key in props && typeof props[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  }
  const opacity = "opacity" in props ? (() => {
    const fraction = parseNumber(props.opacity, "opacity");
    const percent = typeof props.opacity === "string" && props.opacity.trim().endsWith("%");
    const result = Math.fround(Math.max(0, Math.min(1, percent || fraction > 1 ? fraction / 100 : fraction)));
    if (!Number.isFinite(result)) throw new Error("opacity exceeds the finite native range");
    return result;
  })() : undefined;
  let paints: readonly Paint[] | undefined;
  // Rust sorts equal-priority keys by name: `fills` replaces `fill` when both are present.
  if ("fill" in props) {
    if (props.fill === null || typeof props.fill === "string" && props.fill.toLowerCase() === "none") paints = Object.freeze([]);
    else {
      const colour = parseColour(props.fill);
      if (!colour) throw new Error("fill must be a colour, none or null");
      paints = Object.freeze([solidPaint(colour)]);
    }
  }
  if ("fills" in props) paints = readPaints(props.fills, true);
  if ("constraints" in props) readConstraints(props.constraints);
  const draft = new HierarchyDraft(document);
  for (const id of ids) {
    const node = draft.nodes[id];
    if (!node || node.kind === "page") throw new Error(`node.set target ${id} is not an editable layer`);
    if ("clip" in props && node.kind !== "frame") throw new Error("Clip content requires a frame");
    let arcNode = setStrokeProperties(setShapeProperties(setArc(node, props), props), props);
    for (const key of ["booleanOperation", "operandOperation"] as const) {
      if (!(key in props)) continue;
      const op = props[key];
      if (key === "booleanOperation" && arcNode.kind === "booleanOp") {
        if (!isBooleanOperation(op)) throw new Error("Invalid boolean group operation");
        if (op !== arcNode.op) arcNode = { ...arcNode, op };
      } else {
        if (draft.nodes[node.parent]?.kind !== "booleanOp") throw new Error("Not a boolean group or a layer in one");
        if (op !== null && !isBooleanOperation(op)) throw new Error("Invalid operand operation");
        if ((op ?? undefined) !== arcNode.boolOp) {
          const { boolOp: _previous, ...rest } = arcNode;
          arcNode = op === null ? rest : { ...rest, boolOp: op };
        }
      }
    }
    const corners = setCorners(node.corners ?? zeroCorners, props);
    const cornersChanged = corners !== (node.corners ?? zeroCorners);
    const constraints = "constraints" in props ? readConstraints(props.constraints, node.constraints) : node.constraints;
    const constraintsChanged = constraints && (constraints.horizontal !== (node.constraints ?? defaultConstraints).horizontal || constraints.vertical !== (node.constraints ?? defaultConstraints).vertical);
    const replacement = node.kind === "vector" ? shape : undefined;
    if (replacement && arcNode.kind === "vector") arcNode = { ...arcNode, network: replacement.network, width: replacement.width, height: replacement.height };
    let width = replacement?.width ?? node.width;
    let height = replacement?.height ?? node.height;
    // Upstream sorts equal-priority geometry keys by name; aliases may coexist.
    for (const key of keys.filter(key => !replacement && (key === "width" || key === "height" || key === "w" || key === "h")).sort()) {
      const oldWidth = width, oldHeight = height;
      if (key === "width" || key === "w") width = Math.max(0, values[key]);
      else height = Math.max(0, values[key]);
      const isWidth = key === "width" || key === "w", linked = node.constrainProportions === true;
      if (linked && oldWidth > 1e-9 && oldHeight > 1e-9 && (isWidth ? !("height" in props) && !("h" in props) : !("width" in props) && !("w" in props))) {
        const derived = isWidth ? oldHeight * width / oldWidth : oldWidth * height / oldHeight;
        if (Number.isFinite(derived)) { if (isWidth) height = derived; else width = derived; }
      }
      if (!isLeaf(node) && (width !== oldWidth || height !== oldHeight)) {
        draft.set({ ...node, width, height });
        resizeChildren(draft, id, oldWidth, oldHeight);
      }
      if (arcNode.kind === "vector" && (width !== oldWidth || height !== oldHeight)) arcNode = withLayerSize(arcNode, width, height);
    }
    let transform = rectangleTransform(node);
    if ("rotation" in values) transform = setRotationAboutCenter(transform, width, height, values.rotation);
    if ("x" in values || "y" in values) {
      const space = isGroupLike(draft.nodes[node.parent]) ? frameRelative(draft.document, node.parent) : identity;
      const relative = multiply(space, transform);
      transform = multiply(inverse(space), withTranslation(relative, {
        x: "x" in values ? values.x + (replacement?.offset.x ?? 0) : relative[4],
        y: "y" in values ? values.y + (replacement?.offset.y ?? 0) : relative[5],
      }));
    }
    transformBounds(transform, width, height);
    let updated: LayerNode = withLayerSize(withRectangleTransform(arcNode, transform), width, height);
    if (cornersChanged) updated = Object.freeze({ ...updated, corners });
    if (updated.kind === "vector" && "cornerRadius" in props) updated = Object.freeze({ ...updated, network: freezeNetwork({ ...updated.network, vertices: updated.network.vertices.map(v => ({ ...v, radius: corners.radii[0] })) }) });
    if (constraintsChanged) updated = Object.freeze({ ...updated, constraints });
    if ("clip" in props && updated.kind === "frame") updated = Object.freeze({ ...updated, clip: props.clip as boolean });
    if (name !== undefined && name !== node.name) updated = Object.freeze({ ...updated, name });
    if ("visible" in props && props.visible !== (node.visible ?? true)) updated = Object.freeze({ ...updated, visible: props.visible as boolean });
    if ("locked" in props && props.locked !== (node.locked ?? false)) updated = Object.freeze({ ...updated, locked: props.locked as boolean });
    if ("constrainProportions" in props) updated = Object.freeze({ ...updated, constrainProportions: props.constrainProportions as boolean });
    if (opacity !== undefined && opacity !== (node.opacity ?? 1)) updated = Object.freeze({ ...updated, opacity });
    if (paints && !samePaints(rectanglePaints(node), paints)) updated = withRectanglePaints(updated, paints);
    if (arcNode !== node || updated.kind === "vector" && "cornerRadius" in props || cornersChanged || "constrainProportions" in props && props.constrainProportions !== (node.constrainProportions ?? false) || constraintsChanged || "clip" in props && node.kind === "frame" && props.clip !== node.clip || width !== node.width || height !== node.height || transform.some((value, index) => value !== rectangleTransform(node)[index])
      || name !== undefined && name !== node.name || "visible" in props && props.visible !== (node.visible ?? true)
      || "locked" in props && props.locked !== (node.locked ?? false) || opacity !== undefined && opacity !== (node.opacity ?? 1)
      || paints && !samePaints(rectanglePaints(node), paints)) {
      draft.set(updated);
    }
  }
  if (pivot) for (const { id, point } of pinned) if (point) {
    const after = transformPoint(worldTransform(draft.document, id), point);
    moveWorld(draft, id, pivot.x - after.x, pivot.y - after.y);
  }
  draft.normaliseGroups();
  return validateChangedGeometry(draft);
}
