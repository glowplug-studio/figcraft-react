import { identity, inverse, multiply, rotateAbout, transformBounds, transformPoint, type Affine } from "./affine";
import { arrangementTargets } from "./arrange";
import { layerTransform, withLayerTransform, type Document, type NodeId } from "./document";
import type { Point } from "./geometry";
import { HierarchyDraft, rootIds, subtreeIds, worldTransform } from "./hierarchy";
import { parseNumber } from "./parameters";
import { boundsOf } from "./viewport";
import type { VectorEditState } from "./vector-edit";
import { pointBoxCentre, pointBoxOnto, pointRotationMatrix, transformVectorPoints, vectorPointBox } from "./vector-point-transform";

export const rotationSpecs = Object.freeze({
  "transform.rotate": { label: "Rotate", undo: true },
  "object.rotateLeft": { label: "Rotate 90° left", undo: true },
  "object.rotateRight": { label: "Rotate 90° right", undo: true },
  "object.rotate180": { label: "Rotate 180°", undo: true },
  "object.flipH": { label: "Flip horizontal", undo: true },
  "object.flipV": { label: "Flip vertical", undo: true },
});
export const originSpecs = Object.freeze({
  "transform.rotationOrigin": { label: "Move rotation origin", undo: false },
  "transform.setRotationOrigin": { label: "Set rotation origin", undo: false },
});
export interface RotationOrigin { readonly ids: readonly NodeId[]; readonly at?: Point; readonly editing: boolean }
export interface OriginSnapshot { readonly editing: boolean; readonly moved: boolean; readonly point?: Point }
export const sameIds = (a: readonly NodeId[], b: readonly NodeId[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** Own box for one layer, shared rotated axes for several, otherwise page bounds. */
export function selectionFrame(document: Document, selection: readonly NodeId[]): { matrix: Affine; width: number; height: number } | undefined {
  const ids = rootIds(document, selection);
  if (!ids.length) return;
  if (ids.length === 1) {
    const node = document.nodes[ids[0]];
    if (node.kind === "page") return;
    return { matrix: worldTransform(document, node.id), width: node.width, height: node.height };
  }
  const angles = ids.map(id => { const m = worldTransform(document, id); return Math.atan2(m[1], m[0]); });
  const angle = angles[0], quarter = Math.PI / 2, eps = 1e-4;
  const common = Math.abs(angle - Math.round(angle / quarter) * quarter) >= eps && angles.every(other => {
    const difference = ((other - angle) % Math.PI + Math.PI) % Math.PI;
    return Math.min(difference, Math.PI - difference) < eps;
  });
  if (!common) {
    const box = boundsOf(document, ids)!;
    return { matrix: [1, 0, 0, 1, box.x, box.y], width: box.width, height: box.height };
  }
  const c = Math.cos(angle), s = Math.sin(angle), rotation: Affine = [c, s, -s, c, 0, 0], inv = inverse(rotation);
  const boxes = ids.map(id => {
    const node = document.nodes[id];
    if (node.kind === "page") throw new Error("Select layers, not pages");
    return transformBounds(multiply(inv, worldTransform(document, id)), node.width, node.height);
  });
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { matrix: multiply(rotation, [1, 0, 0, 1, x, y]), width: right - x, height: bottom - y };
}

export function originBoxPoints(document: Document, selection: readonly NodeId[]): Point[] | undefined {
  const frame = selectionFrame(document, selection);
  if (!frame) return;
  return [[0, 0], [1, 0], [1, 1], [0, 1], [.5, 0], [1, .5], [.5, 1], [0, .5], [.5, .5]]
    .map(([x, y]) => transformPoint(frame.matrix, { x: x * frame.width, y: y * frame.height }));
}

export function movedOrigin(document: Document, selection: readonly NodeId[], origin?: RotationOrigin): Point | undefined {
  if (!origin?.at || !selection.length || !sameIds(selection, origin.ids)) return;
  try { return transformPoint(worldTransform(document, selection[0]), origin.at); } catch { return; }
}
export function localOrigin(document: Document, first: NodeId, point?: Point): Point | undefined {
  if (!point) return;
  const world = worldTransform(document, first);
  if (Math.abs(world[0] * world[3] - world[1] * world[2]) <= 1e-12) return;
  try { return Object.freeze(transformPoint(inverse(world), point)); } catch { return; }
}
export function snappedOrigin(document: Document, selection: readonly NodeId[], point: Point, zoom: number): Point | undefined {
  const points = originBoxPoints(document, selection) ?? [];
  let closest = -1, distance = Infinity;
  points.forEach((candidate, index) => {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d * Math.max(1e-6, zoom) <= 5 && d < distance) { closest = index; distance = d; }
  });
  return closest === 8 ? undefined : closest >= 0 ? points[closest] : point;
}

export function validateChangedGeometry(draft: HierarchyDraft): Document {
  const result = draft.finish();
  const parents = new Map<NodeId, Affine>();
  for (const id of rootIds(result, [...draft.changedIds].filter(id => result.nodes[id]))) for (const child of subtreeIds(result, id)) {
    const node = result.nodes[child];
    if (node.kind === "page") continue;
    let parent = parents.get(node.parent);
    if (!parent) {
      parent = worldTransform(result, node.parent);
      parents.set(node.parent, parent);
    }
    if (!node.transform && parent[0] === 1 && parent[1] === 0 && parent[2] === 0 && parent[3] === 1) {
      // Translation-only siblings need two world corners. Verify their extents as well:
      // subtracting two finite opposite-sign coordinates can overflow.
      const x = parent[4]+node.x, y = parent[5]+node.y;
      const right = x+node.width, bottom = y+node.height;
      if (!Number.isFinite(right-x) || !Number.isFinite(bottom-y)) throw new Error("Affine geometry must be finite");
    } else {
      transformBounds(multiply(parent,layerTransform(node)),node.width,node.height);
    }
  }
  return result;
}

export function executeRotation(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>, origin?: Point, vectorEdit?: VectorEditState): Document {
  if (!Object.hasOwn(rotationSpecs, command)) throw new Error(`Unsupported rotation command: ${command}`);
  const allowed = ["id", "ids", ...(command === "transform.rotate" ? ["degrees", "cx", "cy"] : [])];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  if (vectorEdit && command !== "transform.rotate" && !Object.hasOwn(params, "id") && !Object.hasOwn(params, "ids")) {
    const box = vectorPointBox(document, vectorEdit);
    if (box?.points.length) {
      const matrix = command === "object.flipH" ? pointBoxOnto(box, box.width, 0, 0, box.height)
        : command === "object.flipV" ? pointBoxOnto(box, 0, box.height, box.width, 0)
        : pointRotationMatrix(pointBoxCentre(box), command === "object.rotateLeft" ? 90 : command === "object.rotateRight" ? -90 : 180);
      const draft = new HierarchyDraft(document); transformVectorPoints(draft, vectorEdit.id, box.points, matrix);
      draft.normaliseGroups(); return validateChangedGeometry(draft);
    }
  }
  const targets = arrangementTargets(document, selection, params, false), ids = rootIds(document, targets);
  const box = boundsOf(document, ids)!, centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const pivot = sameIds(targets, selection) && origin ? origin : centre;
  const optional = (key: string, fallback: number) => { try { return parseNumber(params[key]); } catch { return fallback; } };
  const matrix: Affine = command === "object.flipH" ? [-1, 0, 0, 1, centre.x * 2, 0]
    : command === "object.flipV" ? [1, 0, 0, -1, 0, centre.y * 2]
    : rotateAbout(identity, { x: optional("cx", pivot.x), y: optional("cy", pivot.y) }, command === "transform.rotate" ? parseNumber(params.degrees, "degrees") : command === "object.rotateLeft" ? 90 : command === "object.rotateRight" ? -90 : 180);
  const draft = new HierarchyDraft(document);
  for (const id of ids) {
    const node = draft.nodes[id];
    if (node.kind === "page") throw new Error("Rotate layers, not pages");
    const world = multiply(matrix, worldTransform(draft.document, id));
    draft.set(withLayerTransform(node, multiply(inverse(worldTransform(draft.document, node.parent)), world)));
  }
  draft.normaliseGroups();
  return validateChangedGeometry(draft);
}
