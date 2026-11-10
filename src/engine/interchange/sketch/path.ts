import type { Point } from "../../geometry";
import { polygonPoints, starPoints } from "../../polygon";
import { wireVectorNetwork } from "../../vector-codec";
import { appendNetwork, transformNetwork, type VectorNetwork, type VectorRegion, type VectorSegment, type VectorVertex } from "../../vector-network";
import { children, clamp, numeric, object, type JsonObject } from "../rest/values";
import { frameSize, sketchLocal } from "./geometry";
import { sketchPoint } from "./gradient";

type Warn = (message: string) => void;
type Pair = readonly [number, number];
const zero: Pair = [0, 0];
const pathClasses = new Set(["shapePath", "rectangle", "oval", "star", "polygon", "triangle"]);

function winding(layer: JsonObject): VectorRegion["winding"] {
  const rule = Object.hasOwn(layer, "windingRule") ? layer.windingRule : object(layer.style).windingRule;
  return rule === 1 ? "evenOdd" : "nonZero";
}
export function sketchShows(layer: JsonObject, key: "fills" | "borders") {
  return children(object(layer.style)[key]).some(entry => object(entry).isEnabled !== false);
}
function pointInFrame(value: unknown, w: number, h: number) {
  const p = sketchPoint(value);
  if (!p) return;
  const fit = (v: number) => Number.isFinite(v) ? clamp(v, -1e7, 1e7) : 0;
  return { x: fit(p.x * w), y: fit(p.y * h) };
}
function sketchNetwork(layer: JsonObject, fillOpen: boolean, warn: Warn): VectorNetwork | undefined {
  const { w, h } = frameSize(layer);
  const vertices: VectorVertex[] = [], segments: VectorSegment[] = [];
  const incoming: Pair[] = [], outgoing: Pair[] = [];
  const points = children(layer.points);
  if (points.length > 100000) warn("paths with more than 100000 points were cut");
  for (const raw of points.slice(0, 100000)) {
    const entry = object(raw), p = pointInFrame(entry.point, w, h);
    if (!p) {
      warn("path points that couldn't be read were skipped");
      continue;
    }
    const curved = Number.isInteger(entry.curveMode) && entry.curveMode !== 1;
    function handle(enabled: unknown, value: unknown, vertex: Point): Pair {
      if (!(typeof enabled === "boolean" ? enabled : curved)) return zero;
      const control = pointInFrame(value, w, h);
      return control ? [control.x - vertex.x, control.y - vertex.y] : zero;
    }
    incoming.push(handle(entry.hasCurveTo, entry.curveTo, p));
    outgoing.push(handle(entry.hasCurveFrom, entry.curveFrom, p));
    vertices.push({ ...p, radius: clamp(numeric(entry.cornerRadius) ?? 0, 0, 1e6) });
  }
  if (!vertices.length) return;
  const closed = vertices.length > 1 && (layer.isClosed === true || (fillOpen && vertices.length > 2));
  const edges = closed ? vertices.length : vertices.length - 1;
  for (let a = 0; a < edges; a++) {
    const b = (a + 1) % vertices.length, closing = layer.isClosed !== true && b === 0;
    segments.push({ a, b, ta: closing ? zero : outgoing[a], tb: closing ? zero : incoming[b] });
  }
  const regions = closed ? [{ winding: winding(layer), loops: [segments.map((_, i) => i)] }] : [];
  return { vertices, segments, regions };
}
export function sketchShape(layer: JsonObject, warn: Warn, operandFill?: boolean, operandBorder = false) {
  const fill = operandFill ?? sketchShows(layer, "fills");
  if (layer.isClosed !== true && fill && (operandBorder || sketchShows(layer, "borders"))) {
    warn("open paths with both a fill and a border were closed; the border runs along the closing edge too");
  }
  const net = sketchNetwork(layer, fill, warn);
  if (!net) return;
  const count = numeric(layer.numberOfPoints), kind = layer._class;
  if ((kind === "star" || kind === "polygon") && count !== undefined && Number.isInteger(count) && count >= 3 && count <= 120 &&
      net.vertices.every(v => v.radius === 0) && net.segments.every(s => s.ta.every(n => n === 0) && s.tb.every(n => n === 0))) {
    const { w, h } = frameSize(layer), input = numeric(layer.radius) ?? 0;
    const ratio = input > 0 ? Math.min(input, 1) : 0.5, tol = 0.005 * Math.max(w, h) + 1e-6;
    const expected = kind === "star" ? starPoints(w, h, count, ratio) : polygonPoints(w, h, count);
    if (expected.length === net.vertices.length && expected.every((p, i) =>
      Math.abs(p.x - net.vertices[i].x) <= tol && Math.abs(p.y - net.vertices[i].y) <= tol)) {
      return kind === "star" ? { type: "STAR", pointCount: count, innerRadius: ratio } : { type: "REGULAR_POLYGON", pointCount: count };
    }
  }
  return { type: "VECTOR", vectorNetwork: wireVectorNetwork(net) };
}
export function sketchCompound(group: JsonObject, layers: readonly JsonObject[], warn: Warn) {
  if (!layers.every(layer => pathClasses.has(String(layer._class)))) return;
  const joined: { vertices: VectorVertex[]; segments: VectorSegment[]; regions: VectorRegion[] } = { vertices: [], segments: [], regions: [] };
  for (const layer of layers) {
    const net = sketchNetwork(layer, true, warn);
    if (!net) continue;
    const { w, h } = frameSize(layer);
    appendNetwork(joined, transformNetwork(net, sketchLocal(layer, w, h)));
  }
  if (!joined.vertices.length) return;
  const loops = joined.regions.flatMap(r => r.loops);
  return wireVectorNetwork({ ...joined, regions: loops.length ? [{ winding: winding(group), loops }] : [] });
}

/** Sketch 2025 corner treatments are editable outlines. Arc handles point into the rectangle. */
export function sketchCutCorners(layer: JsonObject): JsonObject {
  if (layer._class !== "rectangle" || layer.edited === true) return layer;
  const style = object(layer.style), corners = object(style.corners), kind = corners.style;
  if (kind !== 2 && kind !== 3 && kind !== 4) return layer;
  const radii = children(corners.radii).filter((v): v is number => numeric(v) !== undefined).slice(0, 4);
  const { w, h } = frameSize(layer);
  if (!radii.some(r => r > 0) || w <= 0 || h <= 0) return layer;
  const points: JsonObject[] = [];
  function add(x: number, y: number, from?: Pair, to?: Pair) {
    const point = (px: number, py: number) => "{" + px / w + ", " + py / h + "}";
    points.push({ point: point(x, y), curveMode: from || to ? 4 : 1, hasCurveFrom: !!from, hasCurveTo: !!to,
      curveFrom: from && point(...from), curveTo: to && point(...to) });
  }
  const directions = [[0,0,0,1,1,0], [w,0,-1,0,0,1], [w,h,0,-1,-1,0], [0,h,1,0,0,-1]];
  directions.forEach(([x,y,px,py,nx,ny], i) => {
    const r = clamp(radii[i % radii.length], 0, Math.min(w,h) / 2);
    if (!r) { add(x,y); return; }
    const ax = x + r*px, ay = y + r*py, bx = x + r*nx, by = y + r*ny, k = 0.5522847498*r;
    add(ax, ay, kind === 4 ? [ax+k*nx, ay+k*ny] : undefined);
    if (kind === 3) add(x+r*(px+nx), y+r*(py+ny));
    add(bx, by, undefined, kind === 4 ? [bx+k*px, by+k*py] : undefined);
  });
  const remainingStyle = { ...style };
  delete remainingStyle.corners;
  return { ...layer, edited: true, isClosed: true, points, style: remainingStyle };
}
