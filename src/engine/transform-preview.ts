import { inverse, multiply, transformPoint, type Affine } from "./affine";
import { axisFactors, resizeChildren } from "./constraints";
import type { Document, NodeId } from "./document";
import { withLayerTransform } from "./document";
import type { Point } from "./geometry";
import { HierarchyDraft, rootIds, worldTransform } from "./hierarchy";
import { validateChangedGeometry, selectionFrame } from "./rotation";
import { scaleSubtree } from "./sizing";
import { nativeSign, resizedBox, scaleFactor, type Handle, type HandleFrame, type ScaleAnchor } from "./transform-handles";

export interface ResizeStart { readonly frame: HandleFrame; readonly ids: readonly NodeId[]; readonly handle: Handle }
export function resizeStart(document: Document, selection: readonly NodeId[], handle: Handle): ResizeStart | undefined {
  const ids = rootIds(document, selection), frame = selectionFrame(document, ids);
  return frame ? { ids, frame, handle } : undefined;
}
export function previewResize(document: Document, start: ResizeStart, point: Point, keep: boolean, centre: boolean, keepChildren: boolean, scale?: ScaleAnchor): { document: Document; hint?: { factor: number; pivot: Point } } {
  const { frame, ids, handle } = start, inv = inverse(frame.matrix), q = transformPoint(inv, point), draft = new HierarchyDraft(document);
  if (![q.x, q.y].every(Number.isFinite)) throw new Error("Resize point must be finite");
  const setWorld = (id: NodeId, world: Affine) => {
    const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot resize a page");
    draft.set(withLayerTransform(node, multiply(inverse(worldTransform(draft.document, node.parent)), world)));
  };
  const size = (id: NodeId, width: number, height: number, preserve: boolean) => {
    const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot resize a page");
    draft.set({ ...node, width, height }); if (!preserve) resizeChildren(draft, id, node.width, node.height);
  };
  let hint: { factor: number; pivot: Point } | undefined;
  if (scale) {
    const amount = scaleFactor(handle, q, frame.width, frame.height, scale, centre);
    if (!amount) return { document };
    const { factor: k, pivot } = amount, sign = nativeSign(k), about = multiply(frame.matrix, [1, 0, 0, 1, pivot.x * (1 - k), pivot.y * (1 - k)]);
    for (const id of ids) {
      const c = multiply(inv, worldTransform(document, id));
      setWorld(id, multiply(about, [sign * c[0], sign * c[1], sign * c[2], sign * c[3], k * c[4], k * c[5]]));
      scaleSubtree(draft, id, Math.abs(k));
    }
    hint = { factor: k, pivot: transformPoint(frame.matrix, pivot) };
  } else {
    const single = ids.length === 1, node = document.nodes[ids[0]];
    const [x0, y0, x1, y1] = resizedBox(handle, q, frame.width, frame.height, keep || single && node.kind !== "page" && node.constrainProportions === true, centre);
    if (single) {
      const id = ids[0], width = Math.abs(x1 - x0), height = Math.abs(y1 - y0), preserve = keepChildren && node.kind === "frame";
      const kept = preserve ? node.children.map(id => ({ id, world: worldTransform(document, id) })) : [];
      let world = multiply(worldTransform(document, id), [1, 0, 0, 1, Math.min(x0, x1), Math.min(y0, y1)]);
      if (x1 < x0) world = multiply(world, [-1, 0, 0, 1, width, 0]);
      if (y1 < y0) world = multiply(world, [1, 0, 0, -1, 0, height]);
      setWorld(id, world); size(id, Math.max(.01, width), Math.max(.01, height), preserve);
      for (const child of kept) setWorld(child.id, child.world);
    } else {
      const sx = frame.width > 1e-9 ? (x1 - x0) / frame.width : 1, sy = frame.height > 1e-9 ? (y1 - y0) / frame.height : 1;
      const mirror: Affine = [nativeSign(sx), 0, 0, nativeSign(sy), 0, 0];
      for (const id of ids) {
        const n = document.nodes[id]; if (n.kind === "page") throw new Error("Cannot resize a page");
        const local = multiply(inv, worldTransform(document, id)), centre = transformPoint(local, { x: n.width / 2, y: n.height / 2 });
        const [kw, kh] = axisFactors(local, sx, sy), width = n.width * kw, height = n.height * kh, m = multiply(mirror, local);
        const linear: Affine = [m[0], m[1], m[2], m[3], 0, 0], offset = transformPoint(linear, { x: width / 2, y: height / 2 });
        setWorld(id, multiply(frame.matrix, [m[0], m[1], m[2], m[3], x0 + centre.x * sx - offset.x, y0 + centre.y * sy - offset.y]));
        size(id, width, height, false);
      }
    }
  }
  draft.normaliseGroups(); return { document: validateChangedGeometry(draft), hint };
}
