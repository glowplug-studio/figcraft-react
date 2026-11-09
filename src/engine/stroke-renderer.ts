import { compositeSurface } from "./blend-composite";
import { paintPath } from "./paint-path";
import { multiply, transformBounds, type Affine } from "./affine";
import type { LayerPaintSteps } from "./image-renderer";
import { drawGradient } from "./gradient-renderer";
import { renderColour, withAlpha } from "./colour";
import { flattenContours, tracePath, type PathCommand } from "./corners";
import type { LayerNode } from "./document";
import type { Point, Rectangle } from "./geometry";
import { lineArrowhead, lineStrokePath } from "./line-stroke";
import { shapePath } from "./shape-path";
import { closedStrokeRing } from "./stroke-geometry";
import { clippedSideStrokePath, sideStrokeGeometry } from "./side-stroke";
import { bandCaps, capShape, defaultStroke, hasVisibleStroke, MAX_STROKE_WIDTH, renderDashes } from "./stroke";
import { variableStrokeOutline } from "./variable-stroke";
import { sanitiseWidthProfile, widthProfileMaxScale } from "./width-profile";
import { brushOutline } from "./brush-geometry";
import { brushReachFactor } from "./brush";
import { paintVectorStrokeMask } from "./vector-stroke";

interface FilledStroke { readonly path: Path2D; readonly rule: CanvasFillRule }
const paths = new WeakMap<LayerNode, FilledStroke | null>();
const profiles = new WeakMap<LayerNode, Path2D | null>();
const shapes = new WeakMap<readonly PathCommand[], Path2D>();
const surfaces = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
const boundsCache = new WeakMap<LayerNode, { matrix: Affine; bounds: Rectangle }>();
interface Mask { readonly surface: HTMLCanvasElement; readonly context: CanvasRenderingContext2D; readonly matrix: readonly number[]; readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly bytes: number }
const masks = new WeakMap<CanvasRenderingContext2D, { entries: Map<LayerNode, Mask>; bytes: number }>();
// Raster reuse is bounded by both pixel bytes and entry count; large masks use the scratch pool.
const MASK_BUDGET = 16 * 1024 * 1024, MASK_COUNT = 256;
const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value));
function closedPath(commands: readonly PathCommand[]): Path2D {
  let cached = shapes.get(commands); if (cached) return cached;
  cached = new Path2D();
  for (const command of commands) {
    if (command[0] === "M") cached.closePath();
    tracePath(cached, [command]);
  }
  cached.closePath(); shapes.set(commands, cached); return cached;
}
function profilePath(node: LayerNode): Path2D | null {
  const previous = profiles.get(node); if (previous !== undefined) return previous;
  const props = node.stroke ?? defaultStroke;
  if (!props.brush && !props.widthProfile?.points.length) { profiles.set(node, null); return null; }
  const weight = Math.min(props.weight, MAX_STROKE_WIDTH);
  const width = weight * (node.kind === "line" || props.align === "center" ? 1 : 2);
  const commands = props.brush ? brushOutline(shapePath(node), width, props, props.brush)
    : variableStrokeOutline(shapePath(node), width, props, props.widthProfile!);
  if (commands === undefined) { profiles.set(node, null); return null; }
  const path = new Path2D(); tracePath(path, commands);
  if (node.kind === "line") {
    tracePath(path, lineArrowhead(node.width, weight, props.capStart, false));
    tracePath(path, lineArrowhead(node.width, weight, props.capEnd, true));
  }
  profiles.set(node, path); return path;
}
function filledStroke(node: LayerNode): FilledStroke | null {
  if (node.kind === "vector") return null;
  const previous = paths.get(node); if (previous !== undefined) return previous;
  const sides = sideStrokeGeometry(node);
  if (sides) {
    const path = new Path2D(); tracePath(path, clippedSideStrokePath(sides));
    const result: FilledStroke = { path, rule: "evenodd" };
    paths.set(node, result); return result;
  }
  const profile = profilePath(node);
  if (profile) {
    const result: FilledStroke | null = node.kind === "line" || node.stroke?.align === "center"
      ? { path: profile, rule: node.stroke?.sides ? "evenodd" : "nonzero" } : null;
    paths.set(node, result); return result;
  }
  const commands = node.kind === "line" ? lineStrokePath(node.width, node.stroke ?? defaultStroke) : closedStrokeRing(node);
  const result = commands === undefined ? null : { path: new Path2D(), rule: node.kind === "line" && !node.stroke?.sides ? "nonzero" as const : "evenodd" as const };
  if (result && commands) tracePath(result.path, commands);
  paths.set(node, result); return result;
}

/** Conservative local stroke reach also protects offscreen alpha surfaces and viewport culling. */
export function strokeReach(node: LayerNode): number {
  if (!hasVisibleStroke(node) || node.kind === "group") return 0;
  const props = node.stroke ?? defaultStroke, base = Math.min(props.weight, MAX_STROKE_WIDTH);
  // Rendering sanitises raw file profiles; use the same finite envelope for allocation/culling.
  const w = base * (props.widthProfile?.points.length ? Math.max(1, widthProfileMaxScale(sanitiseWidthProfile(props.widthProfile))) : 1) * (props.brush ? brushReachFactor(props.brush) : 1);
  if (props.sides && (node.kind === "rectangle" || node.kind === "frame")) {
    const side = Math.max(0, ...props.sides.filter(Number.isFinite));
    return side * (props.align === "inside" ? 0 : props.align === "center" ? .5 : 1);
  }
  if (node.kind === "line") return Math.max(w, 3 * base, 6);
  if (node.kind === "vector") return Math.max(w * Math.max(1, Math.min(100, props.miterLimit)), 3 * base, 6);
  if (props.align === "inside") return 0;
  const spread = props.align === "outside" ? w : w / 2;
  return spread * (props.join === "miter" ? Math.max(1, Math.min(100, props.miterLimit)) : 1);
}
export function strokeBounds(node: LayerNode, matrix: Affine): Rectangle {
  if (!hasVisibleStroke(node)) return transformBounds(matrix, node.width, node.height);
  const prior = boundsCache.get(node);
  if (prior && matrix.every((value, i) => value === prior.matrix[i])) return prior.bounds;
  const reach = strokeReach(node);
  const bounds = reach === 0 ? transformBounds(matrix, node.width, node.height)
    : transformBounds(multiply(matrix, [1, 0, 0, 1, -reach, -reach]), node.width + reach * 2, node.height + reach * 2);
  boundsCache.set(node, { matrix, bounds }); return bounds;
}

interface Contour { readonly points: readonly Point[]; readonly lengths: readonly number[]; readonly length: number }
const measured = new WeakMap<readonly PathCommand[], readonly Contour[]>();
function contours(commands: readonly PathCommand[]): readonly Contour[] {
  const prior = measured.get(commands); if (prior) return prior;
  const result = flattenContours(commands).map(raw => {
    const points = [...raw];
    if (points.length && (points[0].x !== points.at(-1)!.x || points[0].y !== points.at(-1)!.y)) points.push(points[0]);
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return { points, lengths, length: lengths.at(-1) ?? 0 };
  });
  measured.set(commands, result); return result;
}
function atDistance(contour: Contour, distance: number): { point: Point; direction: Point } | undefined {
  const { points, lengths } = contour;
  let lo = 1, hi = lengths.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (lengths[mid] < distance) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < points.length; i++) {
    const length = lengths[i] - lengths[i - 1]; if (length <= 1e-12) continue;
    const a = points[i - 1], b = points[i], t = Math.max(0, Math.min(1, (distance - lengths[i - 1]) / length));
    return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, direction: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } };
  }
  return undefined;
}
/** Add asymmetric dash caps to a butt-stroked opaque mask; the final paint applies alpha once. */
function dashCaps(context: CanvasRenderingContext2D, contour: Contour, pattern: readonly number[], width: number, start: ReturnType<typeof capShape>, end: ReturnType<typeof capShape>): void {
  const intervals: [number, number][] = [];
  let position = 0, index = 0;
  for (let step = 0; position < contour.length && step <= 20000; step++, index = (index + 1) % pattern.length) {
    const next = position + pattern[index];
    if (index % 2 === 0 && next > position) intervals.push([position, Math.min(contour.length, next)]);
    position = next;
  }
  const wraps = intervals.length > 0 && intervals[0][0] === 0 && Math.abs(intervals.at(-1)![1] - contour.length) < 1e-7;
  const r = width / 2;
  for (let i = 0; i < intervals.length; i++) for (const isEnd of [false, true]) {
    if (wraps && (!isEnd && i === 0 || isEnd && i === intervals.length - 1)) continue;
    const cap = isEnd ? end : start; if (cap === "none") continue;
    const sample = atDistance(contour, intervals[i][isEnd ? 1 : 0]); if (!sample) continue;
    const { point: p, direction: d } = sample;
    context.beginPath();
    if (cap === "round") context.arc(p.x, p.y, r, 0, Math.PI * 2);
    else {
      const sign = isEnd ? 1 : -1, x = d.x * r * sign, y = d.y * r * sign, nx = -d.y * r, ny = d.x * r;
      context.moveTo(p.x + nx, p.y + ny); context.lineTo(p.x + nx + x, p.y + ny + y); context.lineTo(p.x - nx + x, p.y - ny + y); context.lineTo(p.x - nx, p.y - ny); context.closePath();
    }
    context.fill();
  }
}
const gradientMasks = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
function* paintMask(context: CanvasRenderingContext2D, node: LayerNode, mask: Mask, alpha: number): LayerPaintSteps {
  const { surface, context: scratch, left, top, width, height } = mask;
  scratch.resetTransform(); scratch.globalCompositeOperation = "source-in";
  context.save(); context.resetTransform();
  for (const paint of node.strokes ?? []) if (paint.visible && paint.opacity > 0) {
    if (paint.type !== "solid" || paint.blend === "plusDarker") {
      // The cached coverage mask must retain its original alpha for every paint and redraw.
      let buffer = gradientMasks.get(context);
      if (!buffer) { buffer = context.canvas.ownerDocument.createElement("canvas"); gradientMasks.set(context,buffer); }
      if (buffer.width < width) buffer.width = width;
      if (buffer.height < height) buffer.height = height;
      const target = buffer.getContext("2d")!;
      target.resetTransform(); target.globalCompositeOperation = "source-over"; target.clearRect(0,0,buffer.width,buffer.height);
      const [a,b,c,d,e,f] = mask.matrix;
      target.setTransform(a,b,c,d,e-left,f-top);
      if (paint.type === "solid") {
        target.resetTransform(); target.fillStyle = renderColour(paint.color); target.fillRect(0,0,width,height);
      } else if (paint.type === "gradient") drawGradient(target,paint,node.width,node.height);
      else yield [target,paint,node.width,node.height];
      target.resetTransform(); target.globalCompositeOperation = "destination-in";
      target.drawImage(surface,0,0,width,height,0,0,width,height);
      compositeSurface(context,target,left,top,width,height,paint.blend,clampAlpha(paint.opacity)*alpha);
      continue;
    }
    scratch.fillStyle = renderColour(withAlpha(paint.color, 1)); scratch.fillRect(0, 0, surface.width, surface.height);
    compositeSurface(context,scratch,left,top,width,height,paint.blend,clampAlpha(paint.opacity)*clampAlpha(paint.color.a)*alpha);
  }
  context.restore();
}

/** Caller has entered node-local coordinates. No DOM or React node represents a canvas layer. */
export function* paintStroke(context: CanvasRenderingContext2D, node: LayerNode, alpha = 1): LayerPaintSteps {
  if (!hasVisibleStroke(node) || node.kind === "group") return;
  const filled = filledStroke(node), paints = node.strokes ?? [];
  if (filled) {
    for (const paint of paints) if (paint.visible && paint.opacity > 0) {
      yield* paintPath(context,filled.path,filled.rule,node.width,node.height,paint,alpha,undefined,matrix=>strokeBounds(node,matrix));
    }
    return;
  }
  const matrix = context.getTransform(), coefficients: Affine = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  const cacheKey = [...coefficients, context.canvas.width, context.canvas.height];
  let cache = masks.get(context); if (!cache) { cache = { entries: new Map(), bytes: 0 }; masks.set(context, cache); }
  const previous = cache.entries.get(node);
  if (previous && cacheKey.every((v, i) => v === previous.matrix[i])) {
    cache.entries.delete(node); cache.entries.set(node, previous); yield* paintMask(context, node, previous, alpha); return;
  }
  if (previous) { cache.entries.delete(node); cache.bytes -= previous.bytes; }
  const bounds = strokeBounds(node, coefficients);
  const left = Math.max(0, Math.floor(bounds.x) - 1), top = Math.max(0, Math.floor(bounds.y) - 1);
  const width = Math.min(context.canvas.width, Math.ceil(bounds.x + bounds.width) + 1) - left, height = Math.min(context.canvas.height, Math.ceil(bounds.y + bounds.height) + 1) - top;
  if (width <= 0 || height <= 0) { if (previous) previous.surface.width = previous.surface.height = 0; return; }
  const bytes = width * height * 4, reuse = previous && bytes <= MASK_BUDGET;
  if (previous && !reuse) previous.surface.width = previous.surface.height = 0;
  let surface = reuse ? previous.surface : surfaces.get(context);
  if (!surface) { surface = context.canvas.ownerDocument.createElement("canvas"); surfaces.set(context, surface); }
  // A pan changes raster phase, so redraw it, but retain the node's bounded surface.
  if (reuse ? surface.width !== width : surface.width < width) surface.width = width;
  if (reuse ? surface.height !== height : surface.height < height) surface.height = height;
  const scratch = surface.getContext("2d"); if (!scratch) throw new Error("Stroke rendering is unavailable");
  scratch.resetTransform(); scratch.globalCompositeOperation = "source-over"; scratch.globalAlpha = 1; scratch.clearRect(0, 0, surface.width, surface.height);
  scratch.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - left, matrix.f - top);
  if (node.kind === "vector") paintVectorStrokeMask(scratch, node);
  else {
  const props = node.stroke ?? defaultStroke, commands = shapePath(node), path = closedPath(commands);
  const profile = profilePath(node);
  scratch.fillStyle = "black";
  if (profile) scratch.fill(profile, "nonzero");
  else {
    const lines = contours(commands);
    const dashes = renderDashes(lines.reduce((sum, line) => sum + line.length, 0), true, props, lines.length);
    const caps = bandCaps(props).map(capShape), symmetric = caps[0] === caps[1];
    scratch.lineWidth = Math.min(props.weight * (props.align === "center" ? 1 : 2), MAX_STROKE_WIDTH);
    scratch.lineJoin = props.join; scratch.miterLimit = Math.max(1, Math.min(100, props.miterLimit)); scratch.lineCap = symmetric && caps[0] !== "none" ? caps[0] : "butt";
    scratch.setLineDash(dashes?.pattern ?? []); scratch.lineDashOffset = 0; scratch.strokeStyle = "black"; scratch.stroke(path);
    if (dashes && !symmetric) for (const line of lines) dashCaps(scratch, line, dashes.pattern, scratch.lineWidth, caps[0], caps[1]);
  }
  if (props.align !== "center") { scratch.globalCompositeOperation = props.align === "inside" ? "destination-in" : "destination-out"; scratch.fill(path); }
  }
  let mask: Mask = { surface, context: scratch, matrix: cacheKey, left, top, width, height, bytes };
  if (bytes <= MASK_BUDGET) {
    while (cache.entries.size && (cache.entries.size >= MASK_COUNT || cache.bytes + bytes > MASK_BUDGET)) {
      const oldest = cache.entries.keys().next().value!, evicted = cache.entries.get(oldest)!;
      cache.bytes -= evicted.bytes; cache.entries.delete(oldest); evicted.surface.width = evicted.surface.height = 0;
    }
    if (reuse) { cache.entries.set(node, mask); cache.bytes += bytes; }
    else {
      const stored = context.canvas.ownerDocument.createElement("canvas"); stored.width = width; stored.height = height;
      const target = stored.getContext("2d");
      if (target) {
        target.drawImage(surface, 0, 0, width, height, 0, 0, width, height);
        mask = { ...mask, surface: stored, context: target }; cache.entries.set(node, mask); cache.bytes += bytes;
      }
    }
  }
  yield* paintMask(context, node, mask, alpha);
}
