import { type Affine, inverse, transformPoint } from "./affine";
import type { Document, LayerNode, NodeId } from "./document";
import { worldTransform } from "./hierarchy";
import { parseIndex, parseNumber, parseString } from "./parameters";
import { measurePath, nearestOnPolylines, polylineAt, type MeasuredPolyline } from "./path-measure";
import { strokeGeometry } from "./shape-path";
import { defaultStroke, setStrokeProperties } from "./stroke";
import { widthPointFromSides, widthPointSides, widthProfilePoints, widthProfileSidesAt, type WidthProfile } from "./width-profile";
import type { Point } from "./geometry";

export type WidthSide = "left" | "right";
const uniform: WidthProfile = { points: [{ t: 0, scale: 1, bias: 0 }, { t: 1, scale: 1, bias: 0 }] };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

function optionalNumber(value: unknown) {
  try { return parseNumber(value); } catch { return undefined; }
}

export function editWidthPoint(node: LayerNode, p: Record<string, unknown>) {
  const stroke = node.stroke ?? defaultStroke;
  const rawSide = parseString(p.side)?.toLowerCase();
  if (rawSide !== undefined && rawSide !== "left" && rawSide !== "right") throw new Error("side: left|right");
  const width = optionalNumber(p.width);
  const scale = optionalNumber(p.scale) ?? (width !== undefined && stroke.weight > 0 ? width * (rawSide ? 2 : 1) / stroke.weight : undefined);
  const action = parseString(p.action) ?? (Object.hasOwn(p, "index") ? "set" : "add");
  const existing = stroke.widthProfile?.points.length ? stroke.widthProfile : undefined;
  if (action !== "add" && !existing) throw new Error("the stroke has no width points (add one first)");
  const profile = existing ?? uniform, points = [...profile.points];
  let index: number | null;
  if (action === "add") {
    const t = parseNumber(p.t, "t"), position = clamp(t, 0, 1);
    const point = scale !== undefined && !rawSide ? { t, scale: Number.isFinite(scale) ? scale : 1, bias: 0 } : widthPointFromSides(t, ...widthProfileSidesAt(profile, t));
    index = points.findIndex(other => other.t > position);
    if (index === -1) index = points.length;
    points.splice(index, 0, { ...point, t: position, scale: clamp(point.scale, 0, 1000) });
  } else if (["set", "move", "remove", "delete"].includes(action)) {
    index = parseIndex(p.index);
    const point = points[index];
    if (!point) throw new Error("no such width point");
    if (action === "remove" || action === "delete") {
      points.splice(index, 1);
      index = null;
    } else {
      const t = optionalNumber(p.t), lo = points[index - 1]?.t ?? 0, hi = points[index + 1]?.t ?? 1;
      points[index] = { ...point, t: t === undefined ? point.t : clamp(t, lo, Math.max(lo, hi)),
        ...(!rawSide && scale !== undefined && Number.isFinite(scale) ? { scale: clamp(scale, 0, 1000), bias: 0 } : {}) };
    }
  } else throw new Error("action: add|set|remove");

  if (index !== null && rawSide && scale !== undefined && Number.isFinite(scale)) {
    const point = points[index], [left, right] = widthPointSides(point), sideScale = clamp(scale, 0, 2000);
    const resized = widthPointFromSides(point.t, rawSide === "left" ? sideScale : left, rawSide === "right" ? sideScale : right);
    points[index] = { ...resized, scale: Math.min(resized.scale, 1000) };
  }
  return { node: setStrokeProperties(node, { widthProfile: widthProfilePoints({ points }) }), index, points: points.length };
}

const measured = new WeakMap<ReturnType<typeof strokeGeometry>, readonly MeasuredPolyline[]>();
export function widthLines(node: LayerNode): readonly MeasuredPolyline[] {
  const path = strokeGeometry(node);
  const cached = measured.get(path);
  if (cached) return cached;
  const lines = measurePath(path) ?? [];
  if (Object.isFrozen(path)) measured.set(path, lines);
  return lines;
}

type Pair = readonly [number, number];
export interface WidthHandle {
  index: number; at: Pair; sides: readonly [Pair, Pair]; width: number; oneSided: boolean;
}

function handlesOnLine(line: MeasuredPolyline, world: Affine, weight: number, minimum: number, index: number, t: number, sides: Pair): WidthHandle | undefined {
  const at = polylineAt(line, t);
  if (!at) return undefined;
  const centre = transformPoint(world, at.point);
  const dx = world[0] * at.normal.x + world[2] * at.normal.y, dy = world[1] * at.normal.x + world[3] * at.normal.y;
  const norm = Math.hypot(dx, dy), nx = norm > 1e-12 ? dx / norm : 0, ny = norm > 1e-12 ? dy / norm : 1;
  const handle = (scale: number, sign: number): Pair => {
    const reach = sign * Math.max(minimum, norm * Math.abs(weight * scale) / 2);
    return [centre.x + nx * reach, centre.y + ny * reach];
  };
  return { index, at: [centre.x, centre.y], sides: [handle(sides[1], 1), handle(sides[0], -1)],
    width: weight * (sides[0] + sides[1]) / 2, oneSided: Math.abs(sides[0] - sides[1]) > 1e-9 };
}

export function widthHandles(doc: Document, id: NodeId, zoom: number, previewT?: number): WidthHandle[] {
  const node = doc.nodes[id];
  if (node?.kind !== "vector") return [];
  const stroke = node.stroke ?? defaultStroke, profile = stroke.widthProfile;
  if (previewT === undefined && !profile?.points.length) return [];
  const points = previewT === undefined ? profile!.points.map((point, index) => ({ index, t: point.t, sides: widthPointSides(point) }))
    : [{ index: -1, t: previewT, sides: widthProfileSidesAt(profile ?? uniform, previewT) }];
  const world = worldTransform(doc, id), minimum = 8 / Math.max(1e-6, zoom), result: WidthHandle[] = [];
  for (const line of widthLines(node)) for (const point of points) {
    const handle = handlesOnLine(line, world, stroke.weight, minimum, point.index, point.t, point.sides);
    if (handle) result.push(handle);
  }
  return result;
}

export type WidthHit = { kind: "point"; index: number } | { kind: "handle"; index: number; side: WidthSide } | { kind: "path"; t: number; side: WidthSide };
export function widthHit(doc: Document, id: NodeId, point: Point, zoom: number): WidthHit | undefined {
  const node = doc.nodes[id];
  if (node?.kind !== "vector") return undefined;
  const handles = widthHandles(doc, id, zoom), tolerance = 6 / Math.max(zoom, 1e-6);
  let bestSide: Extract<WidthHit, { kind: "handle" }> | undefined, bestPoint: Extract<WidthHit, { kind: "point" }> | undefined;
  let sideDistance = Infinity, centreDistance = Infinity;
  const distance = ([x, y]: Pair) => Math.hypot(x - point.x, y - point.y);
  for (const handle of handles) {
    for (const [i, side] of (["right", "left"] as const).entries()) {
      const d = distance(handle.sides[i]);
      if (d <= tolerance && (d < sideDistance || (d === sideDistance && bestSide?.index === handle.index && side === "right"))) {
        sideDistance = d; bestSide = { kind: "handle", index: handle.index, side };
      }
    }
    const d = distance(handle.at);
    if (d <= tolerance && d < centreDistance) { centreDistance = d; bestPoint = { kind: "point", index: handle.index }; }
  }
  if (bestSide || bestPoint) return bestSide ?? bestPoint;
  const world = worldTransform(doc, id), det = world[0] * world[3] - world[1] * world[2];
  if (!det) return undefined;
  const local = transformPoint(inverse(world), point), lines = widthLines(node), nearest = nearestOnPolylines(lines, local);
  if (!nearest) return undefined;
  const at = polylineAt(lines[nearest.subpath], nearest.t);
  if (!at) return undefined;
  const side = (local.x - at.point.x) * at.normal.x + (local.y - at.point.y) * at.normal.y >= 0 ? "right" : "left";
  const stroke = node.stroke ?? defaultStroke, scales = widthProfileSidesAt(stroke.widthProfile ?? uniform, nearest.t);
  const half = stroke.weight / 2 * scales[side === "right" ? 1 : 0] * Math.sqrt(Math.abs(det));
  const centre = transformPoint(world, at.point);
  if (Math.hypot(centre.x - point.x, centre.y - point.y) <= Math.max(tolerance, half)) return { kind: "path", t: nearest.t, side };
}

export function dragWidthPoint(doc: Document, id: NodeId, hit: WidthHit, point: Point, alt: boolean) {
  const node = doc.nodes[id];
  if (node?.kind !== "vector") return;
  const local = transformPoint(inverse(worldTransform(doc, id)), point), lines = widthLines(node);
  if (hit.kind === "point") {
    const nearest = nearestOnPolylines(lines, local);
    if (nearest) return editWidthPoint(node, { index: hit.index, t: nearest.t });
    return;
  }
  const stroke = node.stroke ?? defaultStroke, t = hit.kind === "path" ? hit.t : stroke.widthProfile?.points[hit.index]?.t;
  if (t === undefined || stroke.weight <= 0) return;
  let distance = Infinity, projection = 0;
  for (const line of lines) {
    const at = polylineAt(line, t); if (!at) continue;
    const dx = local.x - at.point.x, dy = local.y - at.point.y, d = Math.hypot(dx, dy);
    if (d < distance) { distance = d; projection = dx * at.normal.x + dy * at.normal.y; }
  }
  if (!Number.isFinite(distance)) return;
  const side = hit.kind === "handle" ? hit.side : projection >= 0 ? "right" : "left";
  const reach = alt ? Math.max(0, side === "right" ? projection : -projection) : distance;
  return editWidthPoint(node, { ...(hit.kind === "path" ? { t } : { index: hit.index }), scale: 2 * reach / stroke.weight, ...(alt ? { side } : {}) });
}
