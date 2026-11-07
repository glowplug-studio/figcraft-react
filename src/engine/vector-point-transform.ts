import { inverse, multiply, transformPoint, type Affine } from "./affine";
import type { Document, NodeId } from "./document";
import type { Point } from "./geometry";
import { HierarchyDraft, worldTransform } from "./hierarchy";
import { refitVector, selectedVectorPoints, vectorNetwork, type VectorEditState } from "./vector-edit";
import { transformVertices } from "./vector-edit-ops";
import type { VectorHit } from "./vector-edit-hit";
import { handleAt, type Handle } from "./transform-handles";

const EPS = 1e-9;
export interface PointBox {
  readonly frame: Affine;
  readonly width: number;
  readonly height: number;
  readonly points: readonly number[];
  readonly others: readonly { readonly id: NodeId; readonly vertices: readonly number[] }[];
}

// Native vector operations validate the final points/handles atomically. Intermediate overflow
// must reach that guard instead of throwing from the general-purpose checked affine helpers.
function product(a: Affine, b: Affine): Affine {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function reciprocal(m: Affine): Affine {
  const r = 1 / (m[0] * m[3] - m[1] * m[2]);
  return [m[3] * r, -m[1] * r, -m[2] * r, m[0] * r,
    (m[2] * m[5] - m[3] * m[4]) * r, (m[1] * m[4] - m[0] * m[5]) * r];
}
function bounds(points: Iterable<Point>): { x: number; y: number; width: number; height: number } | undefined {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const width = right - x, height = bottom - y;
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : undefined;
}

/** Numeric properties always describe the active layer in its own axes. */
export function vectorPointBox(document: Document, state: VectorEditState): PointBox | undefined {
  const net = vectorNetwork(document, state.id); if (!net) return;
  const points = selectedVectorPoints(net, state), b = bounds(points.flatMap(i => net.vertices[i] ? [net.vertices[i]] : []));
  if (!b) return;
  return { frame: multiply(worldTransform(document, state.id), [1, 0, 0, 1, b.x, b.y]), width: b.width, height: b.height, points, others: [] };
}

/** The canvas shares page axes only when other edited layers have selected parts. */
export function shownVectorPointBox(document: Document, state: VectorEditState): PointBox | undefined {
  if (state.tool !== "move") return;
  let box: PointBox | undefined;
  if (state.others.some(p => p.vertices.length || p.segments.length)) {
    const net = vectorNetwork(document, state.id); if (!net) return;
    const points = selectedVectorPoints(net, state), others = state.others.flatMap(p => {
      const n = vectorNetwork(document, p.id), vertices = n && selectedVectorPoints(n, p);
      return vertices?.length ? [{ id: p.id, vertices }] : [];
    });
    function* pagePoints(): Iterable<Point> {
      for (const part of [{ id: state.id, vertices: points }, ...others]) {
        const n = vectorNetwork(document, part.id), w = worldTransform(document, part.id);
        for (const i of part.vertices) { const v = n?.vertices[i]; if (v) yield { x: w[0] * v.x + w[2] * v.y + w[4], y: w[1] * v.x + w[3] * v.y + w[5] }; }
      }
    }
    const b = bounds(pagePoints());
    if (b) box = { frame: [1, 0, 0, 1, b.x, b.y], width: b.width, height: b.height, points, others };
  } else box = vectorPointBox(document, state);
  return box && box.points.length + box.others.reduce((n, p) => n + p.vertices.length, 0) >= 2 && (box.width > EPS || box.height > EPS) ? box : undefined;
}
export function pointBoxCorners(box: PointBox): readonly [Point, Point, Point, Point] {
  return [transformPoint(box.frame, { x: 0, y: 0 }), transformPoint(box.frame, { x: box.width, y: 0 }),
    transformPoint(box.frame, { x: box.width, y: box.height }), transformPoint(box.frame, { x: 0, y: box.height })];
}
export function pointBoxCentre(box: PointBox): Point { return transformPoint(box.frame, { x: box.width / 2, y: box.height / 2 }); }
export type PointBoxHit = { kind: "handle"; handle: Handle } | { kind: "inside" };
export function hitVectorPointBox(box: PointBox, hit: VectorHit | undefined, point: Point, zoom: number): PointBoxHit | undefined {
  const handle = handleAt(pointBoxCorners(box), point, zoom);
  if (handle) {
    if (hit?.kind === "handle" || hit?.kind === "vertex") return;
    if (handle.kind === "corner" || handle.kind === "edge" && (handle.index % 2 === 0 ? box.height : box.width) > EPS || handle.kind === "rotate" && !hit) return { kind: "handle", handle };
  } else if (!hit) {
    try {
      const p = transformPoint(inverse(box.frame), point);
      if (p.x >= 0 && p.x <= box.width && p.y >= 0 && p.y <= box.height) return { kind: "inside" };
    } catch { /* A singular frame has no interior hit. */ }
  }
  return;
}
export function pointRotationMatrix(pivot: Point, degrees: number): Affine {
  const angle = -degrees * (Math.PI / 180), c = Math.cos(angle), s = Math.sin(angle);
  return product([c, s, -s, c, pivot.x, pivot.y], [1, 0, 0, 1, -pivot.x, -pivot.y]);
}
export function pointBoxOnto(box: PointBox, x0: number, y0: number, x1: number, y1: number): Affine {
  const sx = box.width > EPS ? (x1 - x0) / box.width : 1, sy = box.height > EPS ? (y1 - y0) / box.height : 1;
  return product(product(box.frame, [sx, 0, 0, sy, box.width > EPS ? x0 : 0, box.height > EPS ? y0 : 0]), reciprocal(box.frame));
}
export function transformVectorPoints(draft: HierarchyDraft, id: NodeId, points: readonly number[], matrix: Affine): void {
  const node = draft.nodes[id]; if (node?.kind !== "vector") throw new Error("Not a vector");
  const w = worldTransform(draft.document, id), local = product(product(reciprocal(w), matrix), w);
  const network = transformVertices(node.network, points, local);
  if (network !== node.network) draft.set(refitVector({ ...node, network }));
}
export function transformVectorBox(draft: HierarchyDraft, id: NodeId, box: PointBox, matrix: Affine): void {
  transformVectorPoints(draft, id, box.points, matrix);
  for (const part of box.others) transformVectorPoints(draft, part.id, part.vertices, matrix);
}
