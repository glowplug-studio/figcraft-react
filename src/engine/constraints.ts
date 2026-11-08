import { isGroupLike } from "./document";
import { withLayerSize } from "./document";
import { isLeaf } from "./document";
import { transformBounds, withTranslation, type Affine } from "./affine";
import { defaultConstraints, layerTransform, withLayerTransform, type Constraints, type NodeId } from "./document";
import { HierarchyDraft } from "./hierarchy";

export function readConstraints(value: unknown, previous: Constraints = defaultConstraints): Constraints {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("constraints must be an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (key !== "horizontal" && key !== "vertical") throw new Error(`Unsupported constraint: ${key}`);
  const horizontal = Object.hasOwn(record, "horizontal") ? record.horizontal : previous.horizontal, vertical = Object.hasOwn(record, "vertical") ? record.vertical : previous.vertical;
  if (typeof horizontal !== "string" || !["left", "right", "leftRight", "center", "scale"].includes(horizontal)) throw new Error("horizontal: left|right|leftRight|center|scale");
  if (typeof vertical !== "string" || !["top", "bottom", "topBottom", "center", "scale"].includes(vertical)) throw new Error("vertical: top|bottom|topBottom|center|scale");
  return Object.freeze({ horizontal, vertical }) as Constraints;
}

/** Native layout axis factors retain a child's own rotation and reflection. */
export function axisFactors(matrix: Affine, kx: number, ky: number): readonly [number, number] {
  const along = (x: number, y: number, fallback: number) => {
    const length = Math.hypot(x, y), factor = Math.hypot(kx * x, ky * y) / length;
    return length > 1e-12 && Number.isFinite(factor) ? factor : fallback;
  };
  return [along(matrix[0], matrix[1], kx), along(matrix[2], matrix[3], ky)];
}

type Resize = { id: NodeId; oldWidth: number; oldHeight: number; groupScale?: readonly [number, number] };
/** Iterative native apply_constraints / scale_group_children, without React or recursion. */
export function resizeChildren(draft: HierarchyDraft, id: NodeId, oldWidth: number, oldHeight: number): void {
  const pending: Resize[] = [{ id, oldWidth, oldHeight }];
  while (pending.length) {
    const item = pending.pop()!, container = draft.nodes[item.id];
    if (!container || isLeaf(container) || container.kind === "page") continue;
    const nw = container.width, nh = container.height, ow = item.oldWidth, oh = item.oldHeight;
    const group = isGroupLike(container);
    if (!group && Math.abs(nw - ow) < 1e-9 && Math.abs(nh - oh) < 1e-9) continue;
    const [sx, sy] = item.groupScale ?? [ow > 1e-9 ? nw / ow : 1, oh > 1e-9 ? nh / oh : 1];
    for (const childId of container.children) {
      const child = draft.nodes[childId];
      if (!child || child.kind === "page") throw new Error("Invalid container child");
      const matrix = layerTransform(child), b = transformBounds(matrix, child.width, child.height);
      let x = b.x, y = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
      const constraints = child.constraints ?? defaultConstraints;
      if (!group) {
        switch (constraints.horizontal) {
          case "right": x += nw - ow; x1 += nw - ow; break;
          case "leftRight": x1 += nw - ow; break;
          case "center": x += (nw - ow) / 2; x1 += (nw - ow) / 2; break;
          case "scale": x *= sx; x1 *= sx; break;
        }
        switch (constraints.vertical) {
          case "bottom": y += nh - oh; y1 += nh - oh; break;
          case "topBottom": y1 += nh - oh; break;
          case "center": y += (nh - oh) / 2; y1 += (nh - oh) / 2; break;
          case "scale": y *= sy; y1 *= sy; break;
        }
      }
      const [kw, kh] = axisFactors(matrix, group ? sx : b.width > 1e-9 ? (x1 - x) / b.width : 1, group ? sy : b.height > 1e-9 ? (y1 - y) / b.height : 1);
      const width = Math.max(0, child.width * kw), height = Math.max(0, child.height * kh);
      const resized = Math.abs(width - child.width) > 1e-9 || Math.abs(height - child.height) > 1e-9;
      const linear: Affine = [matrix[0], matrix[1], matrix[2], matrix[3], 0, 0];
      const box = transformBounds(linear, width, height);
      if (group) { x = (b.x + b.width / 2) * sx - box.width / 2; y = (b.y + b.height / 2) * sy - box.height / 2; }
      const transform = withTranslation(linear, { x: x - box.x, y: y - box.y });
      transformBounds(transform, width, height);
      draft.set(withLayerSize(withLayerTransform(child, transform), width, height));
      if (!isLeaf(child) && (group || resized)) pending.push({ id: childId, oldWidth: child.width, oldHeight: child.height,
        ...(isGroupLike(child) ? { groupScale: [kw, kh] as const } : {}) });
    }
  }
}
