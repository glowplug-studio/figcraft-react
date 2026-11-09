import { scaleLayoutProperties } from "./auto-layout";
import { fixTextSize, refitResizedText, scaleTextData } from "./text-sizing";
import { scaleEffect } from "./effects";
import { freezeNetwork, transformNetwork } from "./vector-network";
import { withLayerSize } from "./document";
import type { Radii } from "./corners";
import { defaultStroke, type StrokeSides } from "./stroke";
import { multiply, transformBounds, transformPoint, type Affine } from "./affine";
import { arrangementTargets, moveWorld } from "./arrange";
import { resizeChildren } from "./constraints";
import { layerTransform, withLayerTransform, type Document, type NodeId } from "./document";
import { HierarchyDraft, rootIds, subtreeIds, worldTransform } from "./hierarchy";
import { parseBoolean, parseNumber, parseString } from "./parameters";
import { boundsOf } from "./viewport";

export const sizingSpecs = Object.freeze({
  "transform.resize": { label: "Resize", undo: true },
  "transform.scale": { label: "Scale", undo: true },
  "transform.nudgeSize": { label: "Resize by nudge", undo: true },
});
export const anchors = Object.freeze(["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"] as const);
function optionalNumber(value: unknown): number | undefined { try { return parseNumber(value); } catch { return undefined; } }

function resize(draft: HierarchyDraft, id: NodeId, requestedWidth?: number, requestedHeight?: number, ax = 0, ay = 0): void {
  const node = draft.nodes[id];
  if (node.kind === "page") throw new Error("Cannot resize a page");
  const width=Math.max(0,requestedWidth ?? node.width), height=Math.max(0,requestedHeight ?? node.height);
  if (width === node.width && height === node.height) {
    if (node.kind==="text") draft.set(fixTextSize(node,requestedWidth!==undefined,requestedHeight!==undefined,true));
    return;
  }
  const before = transformPoint(layerTransform(node), { x: node.width * ax, y: node.height * ay });
  transformBounds(layerTransform(node), width, height);
  const sized=withLayerSize(node,width,height);
  draft.set(sized.kind==="text" ? fixTextSize(sized,requestedWidth!==undefined,requestedHeight!==undefined,true) : sized);
  resizeChildren(draft, id, node.width, node.height);
  const updated = draft.nodes[id];
  if (updated.kind === "page") throw new Error("Cannot resize a page");
  const after = transformPoint(layerTransform(updated), { x: width * ax, y: height * ay });
  draft.set(withLayerTransform(updated, multiply([1, 0, 0, 1, before.x - after.x, before.y - after.y], layerTransform(updated))));
}

/** Uniformly scale supported subtree dimensions and child translations, ignoring constraints. */
export function scaleSubtree(draft: HierarchyDraft, root: NodeId, factor: number): void {
  for (const id of subtreeIds(draft.document, root)) {
    const node = draft.nodes[id];
    if (node.kind === "page") throw new Error("Cannot scale a page");
    const original = layerTransform(node);
    const matrix: Affine = id === root ? original : [original[0], original[1], original[2], original[3], original[4] * factor, original[5] * factor];
    const width = node.width * factor, height = node.height * factor;
    transformBounds(matrix, width, height);
    const radii = node.corners?.radii.map(r => r * factor);
    if (radii?.some(r => !Number.isFinite(r))) throw new Error("Scaled corner radii must be finite");
    const stroke = node.stroke ?? defaultStroke, weight = stroke.weight * factor, dashes = stroke.dashes.map(d => d * factor);
    const sides = stroke.sides?.map(side => side * factor);
    if (![weight, ...dashes, ...(sides ?? [])].every(Number.isFinite)) throw new Error("Scaled stroke values must be finite");
    const network = node.kind === "vector" ? freezeNetwork({ ...transformNetwork(node.network, [factor, 0, 0, factor, 0, 0]), vertices: node.network.vertices.map(v => ({ ...v, x: v.x * factor, y: v.y * factor, radius: v.radius * factor })) }) : undefined;
    if (network?.vertices.some(v => ![v.x, v.y, v.radius].every(Number.isFinite))) throw new Error("Scaled vector values must be finite");
    const effects = node.effects?.map(effect => scaleEffect(effect, factor));
    draft.set({ ...withLayerTransform(node, matrix), ...scaleLayoutProperties(node, factor), width, height, ...(node.kind==="text" && {text:scaleTextData(node.text,factor)}), ...(effects && { effects: Object.freeze(effects) }), ...(network ? { network } : {}), stroke: Object.freeze({ ...stroke, weight, dashes: Object.freeze(dashes), ...(sides ? { sides: Object.freeze(sides) as unknown as StrokeSides } : {}) }), ...(node.corners && radii ? { corners: Object.freeze({ ...node.corners, radii: Object.freeze(radii) as unknown as Radii }) } : {}) });
  }
}

export function executeSizing(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>): Document {
  if (!Object.hasOwn(sizingSpecs, command)) throw new Error(`Unsupported sizing command: ${command}`);
  const allowed = ["id", "ids", ...(command === "transform.resize" ? ["width", "height", "anchor"] : command === "transform.scale" ? ["factor", "cx", "cy"] : ["dw", "dh", "big"])];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const ids = arrangementTargets(document, selection, params, command !== "transform.resize"), draft = new HierarchyDraft(document);
  if (command === "transform.resize") {
    const name = parseString(params.anchor)?.trim().toLowerCase(), index = anchors.findIndex(anchor => anchor === name), anchor = Math.max(0, index);
    for (const id of ids) {
      const node = draft.nodes[id];
      if (node.kind === "page") throw new Error("Cannot resize a page");
      const w=optionalNumber(params.width), h=optionalNumber(params.height);
      resize(draft,id,w,h,(anchor%3)/2,Math.floor(anchor/3)/2);
    }
  } else if (command === "transform.nudgeSize") {
    const k = parseBoolean(params.big) === true ? 10 : 1, dw = (optionalNumber(params.dw) ?? 0) * k, dh = (optionalNumber(params.dh) ?? 0) * k;
    for (const id of ids) {
      const node = draft.nodes[id];
      if (node.kind === "page") throw new Error("Cannot resize a page");
      resize(draft, id, dw ? node.width + dw : undefined, dh ? node.height + dh : undefined);
    }
  } else {
    const factor = parseNumber(params.factor, "factor");
    if (factor <= 0) throw new Error("factor must be positive");
    if (factor === 1) return document;
    const combined = boundsOf(document, ids)!;
    const cx = optionalNumber(params.cx) ?? combined.x, cy = optionalNumber(params.cy) ?? combined.y;
    for (const root of ids) {
      const before = boundsOf(draft.document, [root])!;
      scaleSubtree(draft, root, factor);
      const after = boundsOf(draft.document, [root])!;
      moveWorld(draft, root, cx + (before.x - cx) * factor - after.x, cy + (before.y - cy) * factor - after.y);
    }
  }
  refitResizedText(draft,document);
  draft.normaliseGroups();
  const result = draft.finish();
  // A changed parent's transform also changes the world range of its descendants.
  for (const id of rootIds(result, [...draft.changedIds].filter(id => result.nodes[id]))) for (const child of subtreeIds(result, id)) {
    const node = result.nodes[child];
    if (node.kind !== "page") transformBounds(worldTransform(result, child), node.width, node.height);
  }
  return result;
}
