import type { PathCommand } from "./corners";
import { ellipticalArcPath, TAU } from "./ellipse";
import type { Point } from "./geometry";
import { bandCaps, capShape, MAX_STROKE_WIDTH, renderDashes, type StrokeCap, type StrokeProps } from "./stroke";

/** Filled band for one straight segment. Caps extend beyond the segment, including each dash. */
export function segmentBand(start: Point, end: Point, width: number, caps: readonly [StrokeCap, StrokeCap]): PathCommand[] {
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  if (!(length > 0 && Number.isFinite(length) && width > 0 && Number.isFinite(width))) return [];
  const r = Math.min(width, MAX_STROKE_WIDTH) / 2, a = capShape(caps[0]), b = capShape(caps[1]);
  const left = a === "square" ? -r : 0, right = length + (b === "square" ? r : 0);
  const local: PathCommand[] = [["M", left, -r], ["L", right, -r]];
  if (b === "round") local.push(...ellipticalArcPath(length, 0, r, r, -Math.PI / 2, Math.PI).slice(1));
  else local.push(["L", right, r]);
  local.push(["L", left, r]);
  if (a === "round") local.push(...ellipticalArcPath(0, 0, r, r, Math.PI / 2, Math.PI).slice(1));
  local.push(["Z"]);
  const ux = dx / length, uy = dy / length, map = (x: number, y: number): [number, number] => [start.x + ux * x - uy * y, start.y + uy * x + ux * y];
  return local.map(c => c[0] === "Z" ? c : c[0] === "C" ? ["C", ...map(c[1], c[2]), ...map(c[3], c[4]), ...map(c[5], c[6])] : [c[0], ...map(c[1], c[2])]);
}

/** Native half-dash fit; each interval is outlined separately and all contours paint once. */
export function lineStrokeBand(length: number, props: StrokeProps): PathCommand[] {
  if (!(length > 0 && Number.isFinite(length) && props.weight > 0 && Number.isFinite(props.weight))) return [];
  const caps = bandCaps(props), dashes = renderDashes(length, false, props);
  if (!dashes) return segmentBand({ x: 0, y: 0 }, { x: length, y: 0 }, props.weight, caps);
  const result: PathCommand[] = [], { pattern, offset } = dashes;
  let at = -offset, index = 0;
  // The native pre-fit budget guarantees fewer than20000 steps, plus the last partial pattern.
  for (let steps = 0; at < length && steps <= 20000; steps++, index = (index + 1) % pattern.length) {
    const next = at + pattern[index];
    if (index % 2 === 0 && next > Math.max(0, at)) result.push(...segmentBand({ x: Math.max(0, at), y: 0 }, { x: Math.min(length, next), y: 0 }, props.weight, caps));
    at = next;
  }
  return result;
}

/** Exact native arrowhead vertices, including the reversed triangle's contour direction. */
export function lineArrowhead(length: number, weight: number, cap: StrokeCap, atEnd: boolean): PathCommand[] {
  if (!(length >= 1e-12 && Number.isFinite(length) && weight > 0 && Number.isFinite(weight))) return [];
  const w = Math.min(weight, MAX_STROKE_WIDTH), s = Math.max(w * 3, 6), tip = atEnd ? length : 0, dir = atEnd ? 1 : -1;
  const p = (along: number, side: number): Point => ({ x: tip + dir * along, y: dir * side });
  const polygon = (points: Point[]): PathCommand[] => [...points.map((point, i): PathCommand => [i === 0 ? "M" : "L", point.x, point.y]), ["Z"]];
  switch (cap) {
    case "triangleArrow": return polygon([p(w / 2, 0), p(-s, s * .6), p(-s, -s * .6)]);
    case "reversedTriangle": return polygon([p(-s, 0), p(0, s * .6), p(0, -s * .6)]);
    case "diamondFilled": return polygon([p(s / 2, 0), p(0, s / 2), p(-s / 2, 0), p(0, -s / 2)]);
    case "circleFilled": return [...ellipticalArcPath(tip, 0, s * .4, s * .4, 0, TAU), ["Z"]];
    case "lineArrow": return [...segmentBand(p(-s, s * .7), p(0, 0), w, ["round", "round"]), ...segmentBand(p(0, 0), p(-s, -s * .7), w, ["round", "round"])];
    default: return [];
  }
}
export function lineStrokePath(length: number, props: StrokeProps): readonly PathCommand[] {
  return [...lineStrokeBand(length, props), ...lineArrowhead(length, props.weight, props.capStart, false), ...lineArrowhead(length, props.weight, props.capEnd, true)];
}
