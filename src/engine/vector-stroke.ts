import { flattenContours, tracePath, type PathCommand } from "./corners";
import { cubicStartDirection, reverseCubic } from "./cubic";
import type { VectorNode } from "./document";
import type { Point } from "./geometry";
import { lineArrowhead, segmentBand } from "./line-stroke";
import { brushOutline } from "./brush-geometry";
import { variableStrokeOutline } from "./variable-stroke";
import { bandCaps, capShape, defaultStroke, lineDashes, MAX_STROKE_WIDTH, renderDashes, type StrokeCap, type StrokeJoin } from "./stroke";
import { freezeNetwork, networkCubic } from "./vector-network";
import { vectorStrokePath, vectorStrokeRuns } from "./vector-path";
import { drawnVectorNetwork } from "./vector-rounded";

interface Measured { readonly points: readonly Point[]; readonly distances: readonly number[]; readonly length: number }
interface Band { readonly path: readonly PathCommand[]; readonly measured: Measured; readonly closed: boolean; readonly caps: readonly [StrokeCap, StrokeCap]; readonly join: StrokeJoin; readonly dash: ReturnType<typeof lineDashes> | null; readonly outline?: readonly PathCommand[] }
export interface VectorStrokePlan {
  readonly bands: readonly Band[];
  readonly outline?: readonly PathCommand[];
  readonly arrows: readonly PathCommand[];
  readonly width: number;
  readonly miter: number;
  readonly align: "center" | "inside" | "outside";
  readonly clip: readonly PathCommand[];
  readonly rule: CanvasFillRule;
}
const plans = new WeakMap<VectorNode, VectorStrokePlan>();
function measure(path: readonly PathCommand[]): Measured {
  const points = flattenContours(path)[0] ?? [], distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { points, distances, length: distances.at(-1) ?? 0 };
}
/** Exact straight bands share the Line geometry, avoiding separate cap-edge compositing. */
function straightBand(band: Band, width: number): readonly PathCommand[] | undefined {
  if (band.path.length !== 2 || band.path[0][0] !== "M" || band.path[1][0] !== "L") return undefined;
  const a = { x: band.path[0][1], y: band.path[0][2] }, b = { x: band.path[1][1], y: band.path[1][2] }, length = band.measured.length;
  if (!band.dash || length <= 1e-12) return segmentBand(a, b, width, band.caps);
  const point = (t: number): Point => ({ x: a.x + (b.x - a.x) * t / length, y: a.y + (b.y - a.y) * t / length });
  const out: PathCommand[] = []; let at = -band.dash.offset, index = 0;
  for (let step = 0; at < length && step <= 20000; step++, index = (index + 1) % band.dash.pattern.length) {
    const next = at + band.dash.pattern[index];
    if (index % 2 === 0 && next > Math.max(0, at)) for (const c of segmentBand(point(Math.max(0, at)), point(Math.min(length, next)), width, band.caps)) out.push(c);
    at = next;
  }
  return out;
}
/** Native path_end deliberately skips cubic segments with a zero endpoint derivative. */
export function vectorPathEnd(path: readonly PathCommand[], atEnd: boolean): { point: Point; direction: Point } | undefined {
  const ends: { start: Point; end: Point; a: Point; b: Point }[] = []; let p: Point | undefined, start: Point | undefined;
  for (const c of path) {
    if (c[0] === "M") { p = start = { x: c[1], y: c[2] }; continue; }
    const end = c[0] === "Z" ? start : c[0] === "C" ? { x: c[5], y: c[6] } : { x: c[1], y: c[2] };
    if (p && end) ends.push({ start: p, end, a: c[0] === "C" ? { x: c[1], y: c[2] } : end, b: c[0] === "C" ? { x: c[3], y: c[4] } : p });
    p = end;
  }
  if (atEnd) ends.reverse();
  for (const e of ends) {
    const point = atEnd ? e.end : e.start, control = atEnd ? e.b : e.a;
    const dx = point.x - control.x, dy = point.y - control.y, length = Math.hypot(dx, dy);
    if (length >= 1e-12) return { point, direction: { x: dx / length, y: dy / length } };
  }
  return undefined;
}
export function vectorArrowhead(path: readonly PathCommand[], weight: number, cap: StrokeCap, atEnd: boolean): readonly PathCommand[] {
  const end = vectorPathEnd(path, atEnd); if (!end) return [];
  const { point: p, direction: d } = end;
  const map = (x: number, y: number): [number, number] => [p.x + (x - 1) * d.x - y * d.y, p.y + (x - 1) * d.y + y * d.x];
  return lineArrowhead(1, weight, cap, true).map(c => c[0] === "Z" ? c : c[0] === "C" ? ["C", ...map(c[1], c[2]), ...map(c[3], c[4]), ...map(c[5], c[6])] : [c[0], ...map(c[1], c[2])]);
}
/** Geometry and styles are cached independently of view transforms and Canvas surfaces. */
export function vectorStrokePlan(node: VectorNode): VectorStrokePlan {
  const cached = plans.get(node); if (cached) return cached;
  const props = node.stroke ?? defaultStroke, weight = Math.min(props.weight, MAX_STROKE_WIDTH), closed = node.network.regions.length > 0;
  let net = drawnVectorNetwork(node);
  const align = closed ? props.align : "center", width = weight * (align === "center" ? 1 : 2), clip = vectorStrokePath(net);
  const styled = !props.dashes.length && !props.widthProfile?.points.length && !props.brush && node.network.vertices.some(v => v.cap !== undefined || v.join !== undefined && v.join !== props.join);
  if (styled) net = freezeNetwork({ ...net, vertices: net.vertices.map(v => { const { join, ...rest } = v; return join === props.join ? rest : v; }) });
  const runs = vectorStrokeRuns(net, styled), bands: Band[] = [], arrows: PathCommand[] = [];
  const outline = props.brush ? brushOutline(clip, width, props, props.brush)
    : props.widthProfile?.points.length ? variableStrokeOutline(clip, width, props, props.widthProfile) : undefined;
  const adjacent: [number, boolean][][] = net.vertices.map(() => []);
  net.segments.forEach((s, i) => { adjacent[s.a]?.push([i, false]); adjacent[s.b]?.push([i, true]); });
  const breaks = (v: number) => styled && adjacent[v]?.length === 2 && net.vertices[v]?.join !== undefined;
  const cap = (v: number, inherited: StrokeCap): StrokeCap => breaks(v) ? "none" : styled ? net.vertices[v]?.cap ?? inherited : inherited;
  if (outline === undefined) {
    const measured = runs.map(r => measure(r.path)), dash = renderDashes(measured.reduce((n, m) => n + m.length, 0), true, props, runs.length);
    runs.forEach((run, i) => bands.push({ path: run.path, measured: measured[i], closed: run.closed, caps: styled ? [cap(run.start, props.capStart), cap(run.end, props.capEnd)] : bandCaps(props), join: props.join, dash: dash ? lineDashes(measured[i].length, run.closed, dash.pattern) : null }));
    if (styled) for (let i = 0; i < net.vertices.length; i++) {
      if (!breaks(i)) continue;
      const v = net.vertices[i], directions = adjacent[i].map(([s, end]) => { const c = networkCubic(net, s); return c ? cubicStartDirection(end ? reverseCubic(c) : c) : undefined; });
      if (!directions[0] || !directions[1]) continue;
      const reach = Math.max(width * .05, .2), a = directions[0], b = directions[1];
      const path: PathCommand[] = [["M", v.x + a.x * reach, v.y + a.y * reach], ["L", v.x, v.y], ["L", v.x + b.x * reach, v.y + b.y * reach]];
      bands.push({ path, measured: measure(path), closed: false, caps: ["none", "none"], join: v.join!, dash: null });
    }
  }
  if (!closed) {
    if (styled) {
      const open = runs.filter(r => !r.closed);
      open.forEach((r, i) => {
        for (const c of vectorArrowhead(r.path, weight, cap(r.start, i === 0 ? props.capStart : "none"), false)) arrows.push(c);
        for (const c of vectorArrowhead(r.path, weight, cap(r.end, i === open.length - 1 ? props.capEnd : "none"), true)) arrows.push(c);
      });
    } else {
      for (const c of vectorArrowhead(clip, weight, props.capStart, false)) arrows.push(c);
      for (const c of vectorArrowhead(clip, weight, props.capEnd, true)) arrows.push(c);
    }
  }
  const result: VectorStrokePlan = { bands: bands.map(b => ({ ...b, outline: straightBand(b, width) })), outline, arrows, width, miter: Math.max(1, Math.min(100, props.miterLimit)), align, clip, rule: net.regions.some(r => r.winding === "evenOdd") ? "evenodd" : "nonzero" };
  if (Object.isFrozen(node)) plans.set(node, result); return result;
}
function sample(m: Measured, distance: number): { point: Point; direction: Point } | undefined {
  let lo = 1, hi = m.points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (m.distances[mid] < distance) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < m.points.length; i++) {
    const a = m.points[i - 1], b = m.points[i], length = m.distances[i] - m.distances[i - 1]; if (length <= 1e-12) continue;
    const t = Math.max(0, Math.min(1, (distance - m.distances[i - 1]) / length));
    return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, direction: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } };
  }
  return undefined;
}
function paintCap(ctx: CanvasRenderingContext2D, m: Measured, distance: number, width: number, cap: StrokeCap, end: boolean): void {
  const shape = capShape(cap); if (shape === "none") return;
  const at = sample(m, distance); if (!at) return;
  const { point: p, direction: d } = at, r = width / 2; ctx.beginPath();
  if (shape === "round") ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
  else {
    const sign = end ? 1 : -1, x = d.x * r * sign, y = d.y * r * sign, nx = -d.y * r, ny = d.x * r;
    ctx.moveTo(p.x + nx, p.y + ny); ctx.lineTo(p.x + nx + x, p.y + ny + y); ctx.lineTo(p.x - nx + x, p.y - ny + y); ctx.lineTo(p.x - nx, p.y - ny); ctx.closePath();
  }
  ctx.fill();
}
/** Paint one opaque mask; stroke paint alpha is applied only after all bands/heads are combined. */
export function paintVectorStrokeMask(ctx: CanvasRenderingContext2D, node: VectorNode): void {
  const plan = vectorStrokePlan(node); ctx.fillStyle = ctx.strokeStyle = "black";
  if (plan.outline) { ctx.beginPath(); tracePath(ctx, plan.outline); ctx.fill("nonzero"); }
  else for (const band of plan.bands) {
    if (band.outline) { ctx.beginPath(); tracePath(ctx, band.outline); ctx.fill("nonzero"); continue; }
    const caps = band.caps.map(capShape), symmetric = caps[0] === caps[1];
    ctx.lineWidth = plan.width; ctx.lineJoin = band.join; ctx.miterLimit = plan.miter;
    ctx.lineCap = symmetric && caps[0] !== "none" ? caps[0] : "butt";
    ctx.setLineDash(band.dash?.pattern ?? []); ctx.lineDashOffset = band.dash?.offset ?? 0;
    ctx.beginPath(); tracePath(ctx, band.path); ctx.stroke();
    if (symmetric) continue;
    if (!band.dash) {
      if (!band.closed) { paintCap(ctx, band.measured, 0, plan.width, band.caps[0], false); paintCap(ctx, band.measured, band.measured.length, plan.width, band.caps[1], true); }
    } else {
      const intervals: [number, number][] = []; let at = -band.dash.offset, index = 0;
      for (let step = 0; at < band.measured.length && step <= 20000; step++, index = (index + 1) % band.dash.pattern.length) {
        const next = at + band.dash.pattern[index];
        if (index % 2 === 0 && next > Math.max(0, at)) intervals.push([Math.max(0, at), Math.min(band.measured.length, next)]);
        at = next;
      }
      const wraps = band.closed && intervals[0]?.[0] === 0 && Math.abs((intervals.at(-1)?.[1] ?? -1) - band.measured.length) < 1e-7;
      intervals.forEach(([a, b], i) => { if (!wraps || i !== 0) paintCap(ctx, band.measured, a, plan.width, band.caps[0], false); if (!wraps || i !== intervals.length - 1) paintCap(ctx, band.measured, b, plan.width, band.caps[1], true); });
    }
  }
  if (plan.align !== "center") { ctx.globalCompositeOperation = plan.align === "inside" ? "destination-in" : "destination-out"; ctx.beginPath(); tracePath(ctx, plan.clip); ctx.fill(plan.rule); ctx.globalCompositeOperation = "source-over"; }
  if (plan.arrows.length) { ctx.beginPath(); tracePath(ctx, plan.arrows); ctx.fill("nonzero"); }
}
