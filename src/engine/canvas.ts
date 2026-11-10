import { reversedRuns } from "./paint-runs";
import type { ColourProfile } from "./colour-spaces";
import { rasterExportPlan } from "./export-area";
import { drawLayoutGuides } from "./layout-guides";
import { fontGeometryCache } from "./font-generation";
import { prepareDocumentText, documentTextReady } from "./text-node-layout";
import { assetDropSlot, assetSwapTarget } from "./component-assets";
import { defaultMain } from "./component-tree";
import { worldRenderBounds } from "./render-bounds";
import { originBoxPoints } from "./rotation";
import { CanvasTextInput } from "./canvas-text-input";
import { paintText } from "./text-painter";
import { beginGlassFrame } from "./glass-shape";
import { backdropParent } from "./backdrop-stack";
import { effectMargin, effectReach, usesPixelLayer, drawLayerEffects } from "./layer-effects-renderer";
import type { ShadowLayer } from "./shadow-renderer";
import { compositeSurface } from "./blend-composite";
import { drawMasked, reserveLayerPixels } from "./mask-renderer";
import { booleanResult } from "./boolean-result";
import { ArcInteraction } from "./arc-handles";
import { DrawInteraction } from "./draw-interaction";
import { isFrameLike, isLeaf } from "./document";
import { CornerInteraction } from "./corner-handles";
import { tracePath, type PathCommand } from "./corners";
import { shapePath, hasShapePath } from "./shape-path";
import { canvasAccent } from "./canvas-colours";
import { pageOf, pageColour, rectanglePaints, rectangleTransform, type Document, type LayerNode, type PageNode } from "./document";
import { convertColourPixels } from "./colour-spaces";
import { renderColour } from "./colour";
import { EditorEngine } from "./editor";
import { type Point, type Rectangle } from "./geometry";
import { multiply, transformBounds, transformPoint, type Affine } from "./affine";
import { pageForNode, subtreeIds, worldTransform } from "./hierarchy";
import { boundsOf, pageToScreen, screenToPage, scrollView, viewOrigin, zoomAt, type Viewport } from "./viewport";
import { SmartHandles } from "./smart-handles";
import { MoveInteraction } from "./move-interaction";
import { TransformInteraction } from "./transform-interaction";
import { paintStroke, strokeBounds } from "./stroke-renderer";
import { hasVisibleStroke } from "./stroke";
import { ImageCropInteraction } from "./image-crop-interaction";
import { LayoutSpacingInteraction } from "./layout-spacing-interaction";
import { BlurInteraction } from "./blur-interaction";
import { GradientInteraction } from "./gradient-interaction";
import { ImagePage } from "./image-page";
import type { PatternPaint } from "./solid-paint";
import { patternResolution, type PatternCell } from "./pattern";
import { paintPatternTiles, resolveLayerPaints } from "./pattern-renderer";
import { CanvasImages, type LayerPaintSteps, type PaintSteps } from "./image-renderer";
import { paintPath } from "./paint-path";
import { pathBounds } from "./vector-path";
import { vectorPaintRegions } from "./vector-presentation";
import { VectorInteraction } from "./vector-interaction";
import { drawVectorEdit } from "./vector-edit-overlay";
import { drawPen } from "./pen-overlay";
import { ShapeBuilderInteraction } from "./shape-builder-interaction";
import { pencilPointerPressure } from "./pencil-samples";

const workingSurfaces = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();
const imagePages = new WeakMap<CanvasRenderingContext2D, ImagePage>();
const imageCaches = new WeakMap<CanvasRenderingContext2D, CanvasImages>();
const compositeSurfaces = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
// Immutable document snapshots invalidate these derived bounds after any edit.
const groupBounds = fontGeometryCache<Document, Map<string, { box: Rectangle; margin: number } | undefined>>();
const opacity = (value: number) => Math.max(0, Math.min(1, value));

const fillPaths = new WeakMap<readonly PathCommand[],Path2D>();
function fillPath(commands: readonly PathCommand[]) {
  let path = fillPaths.get(commands);
  if (!path) { path = new Path2D(); tracePath(path,commands); fillPaths.set(commands,path); }
  return path;
}

function* paintRectangle(context: CanvasRenderingContext2D, node: LayerNode, alpha = 1, strokes = true): LayerPaintSteps {
  context.save();
  if (node.transform) context.transform(...node.transform);
  else context.translate(node.x, node.y);
  if (node.kind === "text") {
    yield* paintText(context, node, alpha);
    if (strokes) yield* paintStroke(context, node, alpha);
    context.restore();
    return;
  }
  const regions = node.kind === "vector" ? vectorPaintRegions(node) : [{ paints: rectanglePaints(node), path: hasShapePath(node) ? shapePath(node) : undefined, rule: "nonzero" as const }];
  for (const region of regions) for (const paint of region.paints) {
    if (!paint.visible || paint.opacity <= 0) continue;
    const commands = region.path, space = "space" in region ? region.space : undefined;
    const bounds = paint.blend === "plusDarker" && commands ? (matrix:Affine) => {
      const b = pathBounds(commands);
      return b ? transformBounds(multiply(matrix,[1,0,0,1,b.x,b.y]),b.width,b.height) : {x:0,y:0,width:0,height:0};
    } : undefined;
    yield* paintPath(context,commands && fillPath(commands),region.rule,node.width,node.height,paint,alpha,space,bounds);
  }
  if (strokes) yield* paintStroke(context, node, alpha);
  context.restore();
}
function* paintLayerStroke(context: CanvasRenderingContext2D, node: LayerNode): LayerPaintSteps {
  context.save(); context.transform(...rectangleTransform(node)); yield* paintStroke(context, node, 1); context.restore();
}

/** Node opacity affects the finished stack, including antialiased edges, once. */
function* paintComposite(context: CanvasRenderingContext2D, node: LayerNode, draw: (target: CanvasRenderingContext2D, shadows?: ShadowLayer) => PaintSteps, painted?: Rectangle, effect?: { doc: Document; scale: number }): PaintSteps {
  const matrix = context.getTransform();
  const bounds = painted ?? strokeBounds(node, multiply([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], rectangleTransform(node)));
  const margin = effect ? effectMargin(node,effect.scale) : 0;
  const left = Math.max(-margin, Math.floor(bounds.x)), top = Math.max(-margin, Math.floor(bounds.y));
  const width = Math.min(effect ? 16384 : Infinity, Math.min(context.canvas.width + margin, Math.ceil(bounds.x + bounds.width)) - left);
  const height = Math.min(effect ? 16384 : Infinity, Math.min(context.canvas.height + margin, Math.ceil(bounds.y + bounds.height)) - top);
  if (width <= 0 || height <= 0) return;
  // Chromium rounds half-opacity compositing differently on its whole-image fast path.
  // Crop the exact paint rectangle from a padded surface to retain native byte rounding.
  const surfaceWidth = !effect && (node.opacity ?? 1) < 1 ? width + 1 : width;
  const release = reserveLayerPixels(surfaceWidth, height, effect ? 6 : 1);
  if (!release) return;
  try {
    let surface = compositeSurfaces.get(context);
    if (!surface) {
      surface = context.canvas.ownerDocument.createElement("canvas");
      compositeSurfaces.set(context, surface);
    }
    if (surface.width !== surfaceWidth) surface.width = surfaceWidth;
    if (surface.height !== height) surface.height = height;
    const scratch = surface.getContext("2d");
    if (!scratch) throw new Error("Canvas compositing is unavailable");
    scratch.resetTransform(); scratch.clearRect(0, 0, surfaceWidth, height);
    scratch.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - left, matrix.f - top);
    if (effect) yield* drawLayerEffects(context,scratch,node,draw,left,top,effect.doc,effect.scale);
    else {
      const detach=backdropParent(scratch,context,left,top,node.opacity??1,node.blend??"normal");
      try { yield* draw(scratch); } finally { detach(); }
    }
    compositeSurface(context, scratch, left, top, width, height, node.blend ?? "normal", opacity(node.opacity ?? 1));
  } finally { release(); }
}

function paddedRect(box: Rectangle, pad: number): Rectangle {
  return pad ? { x: box.x-pad, y: box.y-pad, width: box.width+2*pad, height: box.height+2*pad } : box;
}
function outlinePad(matrix: Affine, local: number) {
  return local * Math.max(Math.abs(matrix[0])+Math.abs(matrix[2]), Math.abs(matrix[1])+Math.abs(matrix[3]));
}
function paintedGroupBounds(context: CanvasRenderingContext2D, document: Document, node: LayerNode, scale: number): Rectangle | undefined {
  const m = context.getTransform();
  const screenBounds = (entry?: {box: Rectangle; margin: number}) => entry && paddedRect(transformBounds(
    multiply([m.a, m.b, m.c, m.d, m.e, m.f], [1, 0, 0, 1, entry.box.x, entry.box.y]), entry.box.width, entry.box.height), entry.margin * scale);
  let cachedDocument = groupBounds.get(document);
  if (!cachedDocument) { cachedDocument = new Map(); groupBounds.set(document, cachedDocument); }
  if (cachedDocument.has(node.id)) return screenBounds(cachedDocument.get(node.id));
  // Cache in the parent's coordinates: pan/zoom changes the view, not descendant geometry.
  const pending: { node: LayerNode; parent: Affine; depth: number; margin: number }[] = [{ node, parent: [1, 0, 0, 1, 0, 0], depth: 0, margin: 0 }];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, margin = 0;
  while (pending.length) {
    const item = pending.pop()!, current = item.node;
    if (current.visible === false || (current.opacity ?? 1) <= 0 || item.depth > 256) continue;
    const matrix = multiply(item.parent, rectangleTransform(current));
    const reach = current.effects?.length ? effectReach(current) : undefined;
    const stackMargin = item.margin + (reach?.page ?? 0);
    margin = Math.max(margin, stackMargin);
    if (!isLeaf(current)) {
      for (const id of current.children) {
        const child = document.nodes[id];
        if (child && child.kind !== "page") pending.push({ node: child, parent: matrix, depth: item.depth + 1, margin: stackMargin });
      }
    }
    if (current.kind !== "group") {
      const bounds = paddedRect(strokeBounds(current, matrix), reach ? outlinePad(matrix,reach.local) : 0);
      x0 = Math.min(x0, bounds.x); y0 = Math.min(y0, bounds.y);
      x1 = Math.max(x1, bounds.x + bounds.width); y1 = Math.max(y1, bounds.y + bounds.height);
    }
  }
  const bounds = x0 === Infinity ? undefined : { box: {x: x0, y: y0, width: x1 - x0, height: y1 - y0}, margin };
  cachedDocument.set(node.id, bounds);
  return screenBounds(bounds);
}

// A single normal solid stroke already combines its geometry into one coverage mask or path.
// Applying node opacity there avoids a second 8-bit rounding at antialiased edges.
function loneNormalStroke(node: LayerNode): boolean {
  const paints = node.strokes;
  if (paints?.length !== 1 || paints[0].type !== "solid" || paints[0].blend !== "normal") return false;
  return node.kind === "vector" ? vectorPaintRegions(node).every(region => !region.paints.length)
    : !rectanglePaints(node).length;
}

function* drawLayer(context: CanvasRenderingContext2D, document: Document, node: LayerNode, depth: number, nesting: number, scale: number, view?: Rectangle): PaintSteps {
  if (node.isMask || node.visible === false || (node.opacity ?? 1) <= 0 || depth > 256) return;
  if (node.kind === "booleanOp") {
    const result = booleanResult(document, node);
    if (result) yield* drawLayer(context, document, result.isMask || result.blend !== node.blend ? { ...result, isMask: false, blend: node.blend } : result, depth, nesting, scale);
    return;
  }
  const effect = usesPixelLayer(node) ? { doc: document, scale } : undefined;
  const blended = node.blend !== undefined && node.blend !== "normal" && node.blend !== "passThrough";
  if (!isLeaf(node)) {
    const composite = effect || blended || node.blend === "normal" && node.children.length || (node.opacity ?? 1) < .999;
    const childView = view && !composite && !node.transform
      ? {x:view.x-node.x, y:view.y-node.y, width:view.width, height:view.height} : undefined;
    const draw = function* (target: CanvasRenderingContext2D, shadows?: ShadowLayer): PaintSteps {
      if (isFrameLike(node)) yield* resolveLayerPaints(paintRectangle(target, node, 1, false), document, depth, nesting, drawLayer, !!shadows);
      if (isFrameLike(node)) shadows?.inner();
      target.save(); target.transform(...rectangleTransform(node));
      if (isFrameLike(node) && node.clip) { target.beginPath(); tracePath(target, shapePath(node)); target.clip(); }
      yield* drawChildren(target, document, node.children, depth + 1, nesting, scale, childView, isFrameLike(node) && node.layout?.reverseZ);
      target.restore();
      if (node.kind === "group") shadows?.inner();
      if (isFrameLike(node) && hasVisibleStroke(node)) yield* resolveLayerPaints(paintLayerStroke(target, node), document, depth, nesting, drawLayer);
    };
    if (composite) {
      const bounds = paintedGroupBounds(context, document, node, scale);
      if (bounds) yield* paintComposite(context, node, draw, bounds, effect);
    } else yield* draw(context);
  } else if (effect) {
    const bounds = deviceBounds(context,document,node,scale);
    yield* paintComposite(context,node,function* (target,shadows) {
      yield* resolveLayerPaints(paintRectangle(target,node,1,false),document,depth,nesting,drawLayer,!!shadows);
      shadows?.inner();
      if (hasVisibleStroke(node)) yield* resolveLayerPaints(paintLayerStroke(target,node),document,depth,nesting,drawLayer);
    },bounds,effect);
  } else if (blended || hasShapePath(node) || hasVisibleStroke(node) || node.fills || node.opacity !== undefined && node.opacity !== 1) {
    const alpha = opacity(node.opacity ?? 1);
    const faded = alpha < .999;
    if (blended || faded && !loneNormalStroke(node)) {
      yield* paintComposite(context,node,target=>resolveLayerPaints(paintRectangle(target,node),document,depth,nesting,drawLayer));
    } else yield* resolveLayerPaints(paintRectangle(context,node,faded ? alpha : 1),document,depth,nesting,drawLayer);
  } else {
    context.fillStyle = node.fill;
    if (node.transform) {
      context.save(); context.transform(...node.transform); context.fillRect(0, 0, node.width, node.height); context.restore();
    } else context.fillRect(node.x, node.y, node.width, node.height);
  }
}

const pendingTextFrames = new WeakMap<CanvasRenderingContext2D, object>();

/** Only this module paints editable geometry; React never renders canvas layers. */
export function renderDocument(context: CanvasRenderingContext2D, document: Document, width: number, height: number, selection: readonly string[] = [], preview?: Rectangle, view?: Viewport, editingId?: string, invalidate?: () => void): void | Promise<void> {
  if (!documentTextReady(document)) {
    const frame = {}, matrix = context.getTransform();
    pendingTextFrames.set(context, frame);
    return prepareDocumentText(document).then(() => {
      if (pendingTextFrames.get(context) !== frame) return;
      pendingTextFrames.delete(context);
      if (invalidate) return invalidate();
      context.save();
      try {
        context.setTransform(matrix);
        drawDocumentFrame(context, document, width, height, selection, preview, view, editingId);
      } finally { context.restore(); }
    });
  }
  pendingTextFrames.delete(context);
  drawDocumentFrame(context, document, width, height, selection, preview, view, editingId, invalidate);
}

const sliceGuides = new WeakMap<Document, readonly string[]>();

function drawSliceGuides(ctx: CanvasRenderingContext2D, doc: Document, zoom: number) {
  let ids = sliceGuides.get(doc);
  if (!ids) {
    ids = subtreeIds(doc, doc.currentPage).filter(id => {
      const node = doc.nodes[id];
      return node.kind === "slice" && node.visible !== false;
    });
    sliceGuides.set(doc, ids);
  }
  if (!ids.length) return;
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.strokeStyle = "#6e6e6e";
  for (const id of ids) {
    const corners = originBoxPoints(doc, [id])!;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawDocumentFrame(context: CanvasRenderingContext2D, document: Document, width: number, height: number, selection: readonly string[], preview?: Rectangle, view?: Viewport, editingId?: string, invalidate?: () => void, drawImageOverlay?: (images?: CanvasImages) => void): void {
  beginGlassFrame();
  let images = imageCaches.get(context);
  let redraw = invalidate;
  if (document.images) {
    if (!images) { images = new CanvasImages(); imageCaches.set(context, images); }
    const matrix = invalidate ? undefined : context.getTransform();
    redraw ??= () => {
      context.save();
      try {
        context.setTransform(matrix!);
        drawDocumentFrame(context, document, width, height, selection, preview, view, editingId, undefined, drawImageOverlay);
      } finally { context.restore(); }
    };
    images.begin(document.images, redraw, document.colourProfile);
  } else if (images) {
    images.clear();
    imagePages.get(context)?.clear();
    imagePages.delete(context);
    images = undefined;
  }
  const origin = view ? viewOrigin(view) : { x: 0, y: 0 }, zoom = view?.zoom ?? 1;
  function drawPage(target: CanvasRenderingContext2D) {
    const paint = (ctx: CanvasRenderingContext2D) => paintPage(ctx,document,width,height,origin,zoom);
    if (images && redraw) {
      let staged = imagePages.get(context);
      if (!staged) { staged = new ImagePage(); imagePages.set(context, staged); }
      staged.draw(target,document,width,height,origin,zoom,images,paint,redraw);
    } else {
      // Missing image references are transparent, including in legacy files without image members.
      for (const _ of paint(target)) { /* No bitmap to draw. */ }
    }
  }
  if (document.colourProfile === "displayP3") {
    let working = workingSurfaces.get(context);
    if (!working) {
      working = context.canvas.ownerDocument.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      workingSurfaces.set(context, working);
    }
    const matrix = context.getTransform();
    const w = Math.max(1, Math.ceil(width * Math.hypot(matrix.a, matrix.b)));
    const h = Math.max(1, Math.ceil(height * Math.hypot(matrix.c, matrix.d)));
    if (working.canvas.width !== w) working.canvas.width = w;
    if (working.canvas.height !== h) working.canvas.height = h;
    if (width > 0 && height > 0) {
      working.setTransform(w / width, 0, 0, h / height, 0, 0);
      drawPage(working);
      const rows = Math.max(1, Math.floor(262144 / w));
      for (let y = 0; y < h; y += rows) {
        const strip = working.getImageData(0, y, w, Math.min(h - y, rows));
        convertColourPixels(strip.data, "displayP3", "srgb", view?.proofSrgb ? {width:w, y} : undefined);
        working.putImageData(strip, 0, y);
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(working.canvas, 0, 0, width, height);
    }
  } else {
    if (workingSurfaces.has(context)) {
      const surface = workingSurfaces.get(context)!.canvas;
      surface.width = surface.height = 0;
      workingSurfaces.delete(context);
    }
    drawPage(context);
  }
  context.save();
  context.scale(zoom, zoom); context.translate(-origin.x, -origin.y);
  if (view && view.slices !== false) drawSliceGuides(context, document, zoom);
  if (view && view.layoutGrids !== false) drawLayoutGuides(context, document, {...origin, width:width/zoom, height:height/zoom}, zoom);
  context.strokeStyle = canvasAccent(document);
  context.lineWidth = 1 / zoom;
  const neighbours = new Set<string>();
  for (const id of editingId ? [...selection, editingId] : selection) {
    let parent = document.nodes[id]?.parent;
    while (parent) {
      const group = document.nodes[parent];
      if (group?.kind === "booleanOp") {
        for (const child of group.children) if (!selection.includes(child) && child !== editingId) neighbours.add(child);
        break;
      }
      parent = group?.parent;
    }
  }
  if (neighbours.size) {
    context.save(); context.globalAlpha *= .6;
    for (const id of neighbours) {
      const node = document.nodes[id];
      if (!node || node.kind === "page" || node.visible === false) continue;
      const outline = node.kind === "booleanOp" ? booleanResult(document,node) : node;
      if (!outline) continue;
      const matrix = worldTransform(document,id); context.beginPath();
      tracePath(context,shapePath(outline),p=>transformPoint(matrix,p)); context.stroke();
    }
    context.restore();
  }
  for (const id of selection) {
    const node = document.nodes[id];
    if (node && node.kind !== "page") {
      const outline = node.kind === "booleanOp" ? booleanResult(document, node) : node;
      if (outline && hasShapePath(outline)) {
        context.beginPath(); const matrix = worldTransform(document, id); tracePath(context, shapePath(outline), point => transformPoint(matrix, point)); context.stroke();
      } else if (node.transform || node.parent !== document.currentPage) {
        // Map the outline points so stroke width remains in screen pixels under scale/skew.
        const [a, b, c, d, e, f] = worldTransform(document, id);
        context.beginPath(); context.moveTo(e, f);
        context.lineTo(a * node.width + e, b * node.width + f);
        context.lineTo(a * node.width + c * node.height + e, b * node.width + d * node.height + f);
        context.lineTo(c * node.height + e, d * node.height + f);
        context.closePath(); context.stroke();
      } else context.strokeRect(node.x, node.y, node.width, node.height);
    }
  }
  if (preview) {
    context.fillStyle = "#d9d9d9";
    context.fillRect(preview.x, preview.y, preview.width, preview.height);
    context.strokeRect(preview.x, preview.y, preview.width, preview.height);
  }
  context.restore();
  drawImageOverlay?.(images);

}

function* paintPage(context: CanvasRenderingContext2D, document: Document, width: number, height: number, origin: Point, zoom: number): PaintSteps {
  const page = pageOf(document);
  context.clearRect(0, 0, width, height);
  context.fillStyle = page.backgroundColor ? renderColour(pageColour(page)) : page.background;
  context.fillRect(0, 0, width, height);
  context.save();
  context.scale(zoom, zoom); context.translate(-origin.x, -origin.y);
  const device = context.getTransform();
  yield* drawChildren(context, document, page.children, 0, 0, Math.sqrt(Math.abs(device.a*device.d-device.b*device.c)), { ...origin, width: width / zoom, height: height / zoom });
  context.restore();
}

function deviceBounds(context: CanvasRenderingContext2D, document: Document, node: LayerNode, scale: number) {
  if (!isLeaf(node)) return paintedGroupBounds(context, document, node, scale);
  const m = context.getTransform();
  const matrix = multiply([m.a,m.b,m.c,m.d,m.e,m.f], rectangleTransform(node));
  const bounds = strokeBounds(node,matrix);
  if (!node.effects?.length) return bounds;
  const reach = effectReach(node);
  return paddedRect(bounds,reach.page*scale+outlinePad(matrix,reach.local));
}

function* drawChildren(context: CanvasRenderingContext2D, document: Document, children: readonly string[],
  depth: number, nesting: number, scale: number, view?: Rectangle, reverseZ = false): PaintSteps {
  const order = reverseZ ? reversedRuns(document, children) : undefined;
  for (let cursor = 0, length = order?.length ?? children.length; cursor < length; cursor++) {
    const index = order ? order[cursor] : cursor;
    const node = document.nodes[children[index]];
    if (!node || node.kind === "page" || node.visible === false) continue;
    if (node.isMask) {
      let end = index + 1;
      while (end < children.length && !document.nodes[children[end]]?.isMask) end++;
      yield* drawMasked(context, document, node, children, index + 1, end, depth, nesting, drawLayer, deviceBounds, scale);
      if (!order) cursor = end - 1;
      continue;
    }
    // A clipped frame confines every child to its outline. Its own stroke can extend beyond it.
    const confined = (depth===0 ? isLeaf(node) : node.kind==="rectangle") || isFrameLike(node) && node.clip;
    if (view && confined && !usesPixelLayer(node)) {
      const bounds = hasVisibleStroke(node) ? strokeBounds(node, rectangleTransform(node)) : node.transform ? transformBounds(node.transform, node.width, node.height) : node;
      if (bounds.x > view.x + view.width || bounds.y > view.y + view.height || bounds.x + bounds.width < view.x || bounds.y + bounds.height < view.y) continue;
    }
    yield* drawLayer(context, document, node, depth, nesting, scale, view);
  }
}

function* drawExportLayers(ctx: CanvasRenderingContext2D, doc: Document, ids: readonly string[], scale: number, depth=0): PaintSteps {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.kind === "page") { yield* drawChildren(ctx, doc, node.children, depth, 0, scale); continue; }
    ctx.save();
    try {
      ctx.transform(...worldTransform(doc, node.parent));
      yield* drawLayer(ctx, doc, node, depth, 0, scale);
    } finally { ctx.restore(); }
  }
}

async function paintExportSteps(doc:Document,steps:PaintSteps,signal?:AbortSignal) {
  const images = new CanvasImages();
  try {
    if (doc.images) images.begin(doc.images, () => {}, doc.colourProfile);
    for (const args of steps) {
      let wait = images.paint(...args);
      while (wait) {
        await wait;
        if (signal?.aborted) return false;
        wait = images.paint(...args);
      }
    }
    return true;
  } finally { steps.return(); images.clear(); }
}

export async function renderPatternPaint(ctx:CanvasRenderingContext2D,doc:Document,paint:PatternPaint,width:number,height:number,depth:number,nesting:number) {
  function* fill():LayerPaintSteps { yield [ctx,paint,width,height]; }
  await paintExportSteps(doc,resolveLayerPaints(fill(),doc,depth,nesting,drawLayer));
}

export async function renderPatternTile(doc:Document,source:LayerNode,cell:PatternCell,depth:number,nesting:number) {
  const r=patternResolution(cell,2);
  if (!r || nesting>=2 || depth>=256) return;
  const canvas=window.document.createElement("canvas");
  try {
    canvas.width=r.width; canvas.height=r.height;
    const ctx=canvas.getContext("2d")!;
    const steps=paintPatternTiles(ctx,doc,source,cell,r.kx,r.ky,depth,nesting,drawLayer);
    await paintExportSteps(doc,steps);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b ? resolve(b) : reject(new Error("Could not encode SVG pattern tile")),"image/png"));
  } finally { canvas.width=canvas.height=0; }
}

/** File previews include the page colour. Asset previews use the same paint pipeline on transparency. */
export async function renderAreaPixels(canvas: HTMLCanvasElement, doc: Document, bound: Rectangle, scale: number,
  roots: readonly string[] | undefined, signal?: AbortSignal, rounding = 0, background?: PageNode, profile: ColourProfile = "srgb", flatten = false, depth=0) {
  if (!documentTextReady(doc)) await prepareDocumentText(doc);
  if (signal?.aborted) return false;
  canvas.width = Math.max(1, Math.ceil(scale * bound.width - rounding));
  canvas.height = Math.max(1, Math.ceil(scale * bound.height - rounding));
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  if (background) {
    ctx.fillStyle = background.backgroundColor ? renderColour(pageColour(background)) : background.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.translate(-bound.x, -bound.y);
  beginGlassFrame();
  let steps: PaintSteps;
  if (roots) steps = drawExportLayers(ctx, doc, roots, scale, depth);
  else {
    const page = doc.nodes[doc.pages[0]];
    if (page.kind !== "page") return false;
    steps = drawChildren(ctx, doc, page.children, 0, 0, scale);
  }
  if (!await paintExportSteps(doc,steps,signal)) return false;
  if (flatten) {
    ctx.save(); ctx.resetTransform(); ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
  }
  if ((doc.colourProfile ?? "srgb") !== profile) {
    const rows = Math.max(1, Math.floor(1048576 / canvas.width));
    for (let y = 0; y < canvas.height; y += rows) {
      const pixels = ctx.getImageData(0, y, canvas.width, Math.min(rows, canvas.height - y));
      convertColourPixels(pixels.data, doc.colourProfile ?? "srgb", profile);
      ctx.putImageData(pixels, 0, y);
    }
  }
  return true;
}

export async function renderAssetThumbnail(canvas: HTMLCanvasElement, doc: Document, id: string, pixels: number, signal: AbortSignal) {
  const bound = worldRenderBounds(doc, id);
  if (!bound || !bound.width || !bound.height) return;
  const scratch = canvas.ownerDocument.createElement("canvas");
  try {
    const scale = Math.min(2, pixels / Math.max(bound.width, bound.height));
    if (!await renderAreaPixels(scratch, doc, bound, scale, [id], signal, 1e-6) || signal.aborted) return;
    canvas.width = scratch.width;
    canvas.height = scratch.height;
    canvas.getContext("2d")?.drawImage(scratch, 0, 0);
  } finally { scratch.width = scratch.height = 0; }
}

export async function renderRasterExport(doc: Document, selection: readonly string[], params: Record<string, unknown>, format: "png" | "jpg" | "webp", savedSize?: import("./export-area").ExportSize, drawn?: readonly string[]) {
  const plan = rasterExportPlan(doc, selection, params, savedSize);
  const scratch = globalThis.document.createElement("canvas");
  try {
    const rendered = await renderAreaPixels(scratch, doc, plan.area, plan.scale, drawn ?? plan.drawn, undefined, 1e-6, undefined, plan.profile, format === "jpg");
    if (!rendered) throw new Error("Could not render the export area");
    const mime = format === "jpg" ? "image/jpeg" : "image/" + format;
    const blob = format === "jpg"
      ? await (await import("./export-jpeg")).encodeExportJpeg(scratch.getContext("2d")!.getImageData(0, 0, scratch.width, scratch.height), plan.quality)
      : await new Promise<Blob | null>(resolve => scratch.toBlob(resolve, mime, format === "webp" ? 1 : undefined));
    if (!blob) throw new Error("Could not encode the requested raster size");
    if (format === "png") return (await import("./export-png")).tagExportPng(blob, plan.profile);
    const { tagExportJpeg, tagExportWebp } = await import("./export-image-profile");
    return format === "jpg" ? tagExportJpeg(blob, plan.profile) : tagExportWebp(blob, plan.profile);
  } finally { scratch.width = scratch.height = 0; }
}

export async function renderFileThumbnail(doc: Document): Promise<Blob | undefined> {
  let solo: string | undefined, bound: Rectangle | undefined;
  let pageId = doc.pages[0];
  // Native IDs are ordered numerically, including IDs above the JavaScript array-index range.
  const chosen = Object.values(doc.nodes).filter(n => n.thumbnailFlag === "true" && isFrameLike(n))
    .sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
  for (const node of chosen) {
    const page = pageForNode(doc, node.id);
    if (!page || !doc.pages.includes(page)) continue;
    const candidate = worldRenderBounds(doc, node.id);
    if (candidate && candidate.width > 0 && candidate.height > 0 && Object.values(candidate).every(Number.isFinite)) {
      solo = node.id; bound = candidate; pageId = page; break;
    }
  }
  const first = doc.nodes[doc.pages[0]];
  bound ??= first?.kind === "page" ? boundsOf(doc, first.children) : undefined;
  if (!bound || !Object.values(bound).every(Number.isFinite)) return;
  const scratch = globalThis.document.createElement("canvas");
  try {
    const scale = Math.min(2, 400 / Math.max(1, bound.width, bound.height));
    const background = doc.nodes[pageId];
    if (background?.kind !== "page" || !await renderAreaPixels(scratch, doc, bound, scale, solo ? [solo] : undefined, undefined, 0, background)) return;
    return await new Promise<Blob | undefined>(resolve => scratch.toBlob(blob => resolve(blob ?? undefined), "image/png"));
  } finally { scratch.width = scratch.height = 0; }
}

/** Owns transient gesture state and a demand-driven render loop, outside React. */
export class CanvasController {
  #frame = 0;
  #disposed = false;
  #pointer: number | null = null;
  #penPointer = false;
  #assetDrop?: {id: string; line?: readonly [number,number,number,number]};
  #observer: ResizeObserver;
  #unsubscribe: () => void;
  #unsubscribeView: () => void;
  #unsubscribeOrigin: () => void;
  #unsubscribeCanvas: () => void;
  #smart: SmartHandles;
  #moving: MoveInteraction;
  #transforming: TransformInteraction;
  #rounding: CornerInteraction;
  #drawing: DrawInteraction;
  #gradients: GradientInteraction;
  #spacing: LayoutSpacingInteraction;
  #blurHandles: BlurInteraction;
  #crop: ImageCropInteraction;
  #text: CanvasTextInput;
  #arcs: ArcInteraction;
  #vectors: VectorInteraction;
  #builder: ShapeBuilderInteraction;
  #dragOrigin = false;
  #space = false;
  #zoomHeld = false;
  #pan?: { screen: Point; view: Viewport };
  #zoomStart?: Point;
  #zoomArea?: Rectangle;
  #abort = new AbortController();
  #width = 0;
  #height = 0;
  #dpr = 1;
  constructor(private canvas: HTMLCanvasElement, private engine: EditorEngine, private onError: (message: string) => void) {
    this.#smart = new SmartHandles(engine, onError);
    this.#moving = new MoveInteraction(engine, onError);
    this.#transforming = new TransformInteraction(engine, onError);
    this.#rounding = new CornerInteraction(engine, onError);
    this.#text = new CanvasTextInput(canvas,engine,()=>this.invalidate(),onError,this.#abort.signal);
    this.#drawing = new DrawInteraction(engine, onError);
    this.#gradients = new GradientInteraction(engine);
    this.#blurHandles = new BlurInteraction(engine);
    this.#spacing = new LayoutSpacingInteraction(engine);
    this.#crop = new ImageCropInteraction(engine);
    this.#arcs = new ArcInteraction(engine, onError);
    this.#builder = new ShapeBuilderInteraction(engine);
    this.#vectors = new VectorInteraction(engine, onError);
    const options = { signal: this.#abort.signal };
    canvas.addEventListener("pointerdown", this.#down, options);
    canvas.addEventListener("pointermove", this.#move, options);
    canvas.addEventListener("pointerleave", event => { if (this.#pointer === null) { this.#builder.cancel(); this.engine.pen.hover(undefined, event); this.#smart.hover(undefined, event); this.#spacing.hover(undefined); this.#rounding.hover(undefined); this.#arcs.hover(undefined); this.#vectors.hover(undefined); this.invalidate(); } }, options);
    canvas.addEventListener("pointerup", this.#up, options);
    canvas.addEventListener("dblclick", this.#doubleClick, options);
    canvas.addEventListener("pointercancel", this.#cancelEvent, options);
    canvas.addEventListener("lostpointercapture", this.#cancelEvent, options);
    canvas.addEventListener("keydown", this.#key, options);
    window.addEventListener("keyup", this.#keyUp, options);
    canvas.addEventListener("wheel", this.#wheel, { ...options, passive: false });
    window.addEventListener("blur", this.#blur, options);
    window.addEventListener("resize", this.#resize, options);
    this.#observer = new ResizeObserver(this.#resize);
    this.#observer.observe(canvas);
    this.#unsubscribe = engine.subscribe(() => {
      if (!engine.pen.open && !engine.pencil.active) this.cancel();
      this.invalidate();
    });
    this.#unsubscribeView = engine.subscribeView(() => this.invalidate());
    this.#unsubscribeOrigin = engine.subscribeOrigin(() => this.invalidate());
    this.#unsubscribeCanvas = engine.subscribeCanvas(() => this.invalidate());
    this.#resize();
  }
  #point(event: { clientX: number; clientY: number }): Point {
    return screenToPage(this.engine.getView(), this.#screenPoint(event));
  }
  #screenPoint(event: { clientX: number; clientY: number }): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  #down = (event: PointerEvent): void => {
    if (this.#pointer !== null || !this.engine.getSnapshot().editable) return;
    if (event.button === 1 || event.button === 0 && (this.#space || this.#zoomHeld)) {
      event.preventDefault(); this.canvas.focus(); this.#pointer = event.pointerId;
      if (event.button === 1 || this.#space) this.#pan = { screen: this.#screenPoint(event), view: this.engine.getView() };
      else this.#zoomStart = this.#screenPoint(event);
      this.canvas.setPointerCapture(event.pointerId); return;
    }
    if (event.button !== 0) return;
    this.canvas.focus();
    try {
      const crop=this.#crop.down(this.#screenPoint(event));
      if (crop===true || crop==="layer" && this.#transforming.down(this.#point(event))) {
        event.preventDefault(); this.#pointer=event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
      }
      if (this.#gradients.down(this.#screenPoint(event)) || this.#blurHandles.down(this.#screenPoint(event)) || this.#spacing.down(this.#screenPoint(event))) {
        event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
      }
      if (this.engine.getSnapshot().paintPicker) this.engine.setPaintPicker();
      if (this.#builder.down(this.#point(event), event) || this.engine.pencil.down(this.#point(event), pencilPointerPressure(event))) {
        event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
      }
      if (this.engine.pen.down(this.#point(event), event)) {
        event.preventDefault(); this.#penPointer = true; this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
      }
    } catch (error) { this.#penFailure(error); return; }
    if (this.#vectors.down(this.#point(event), event)) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
    }
    if (this.#onOrigin(this.#point(event))) {
      event.preventDefault(); this.#dragOrigin = true; this.#pointer = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId); return;
    }
    if (this.#smart.down(this.#screenPoint(event), event)) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
    }
    if (this.#arcs.down(this.#point(event)) || this.#rounding.down(this.#point(event))) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
    }
    if (this.#transforming.down(this.#point(event))) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
    }
    if (this.#drawing.down(this.#point(event)) || this.#moving.down(this.#point(event), event)) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate();
    }
  };

  #move = (event: PointerEvent): void => {
    if (event.pointerId===this.#pointer && this.#crop.active) {
      try {this.#crop.move(this.#screenPoint(event),event.shiftKey);} catch (e) {this.cancel();this.onError(e instanceof Error ? e.message : "Crop failed");}
      this.invalidate();return;
    }
    if (event.pointerId === this.#pointer && this.#spacing.active) {
      try { this.#spacing.move(this.#screenPoint(event), event.shiftKey); } catch (error) {
        this.cancel(); this.onError(error instanceof Error ? error.message : "Could not change layout spacing");
      }
      this.canvas.style.cursor = "grabbing"; this.invalidate(); return;
    }
    if (event.pointerId === this.#pointer && (this.#gradients.active || this.#blurHandles.active)) {
      const started = performance.now();
      try { (this.#blurHandles.active ? this.#blurHandles : this.#gradients).move(this.#screenPoint(event)); } catch (error) { this.cancel(); this.onError(error instanceof Error ? error.message : "Could not move effect or gradient handle"); }
      performance.measure("figcraft:pointer", {start:started,end:performance.now()}); return;
    }
    if (this.engine.getSnapshot().tool === "shapeBuilder" && (this.#pointer === null || this.#builder.active)) {
      if (this.#pointer !== null && this.#pointer !== event.pointerId) return;
      this.canvas.style.cursor = "crosshair";
      this.#builder.move(this.#point(event), event.altKey);
      this.invalidate(); return;
    }
    if (this.engine.getSnapshot().tool === "pencil" && (this.#pointer === null || this.engine.pencil.active)) {
      try {
        this.canvas.style.cursor = "crosshair";
        if (this.#pointer === event.pointerId) {
          const started = performance.now(); this.engine.pencil.move(this.#point(event), pencilPointerPressure(event)); performance.measure("figcraft:pointer", { start: started, end: performance.now() });
        }
        this.invalidate();
      } catch (error) { this.#penFailure(error); }
      return;
    }
    if (this.engine.getSnapshot().tool === "pen" && (this.#pointer === null || this.#penPointer)) {
      try {
        if (this.#pointer === null) this.canvas.style.cursor = this.engine.pen.hover(this.#point(event), event);
        else if (this.#pointer === event.pointerId) {
          const started = performance.now(); this.engine.pen.move(this.#point(event)); performance.measure("figcraft:pointer", { start: started, end: performance.now() });
        }
        this.invalidate();
      } catch (error) { this.#penFailure(error); }
      return;
    }
    if (this.#pointer === null) {
      this.canvas.style.cursor = this.#crop.cursor(this.#screenPoint(event)) ?? this.#gradients.cursor(this.#screenPoint(event)) ?? this.#blurHandles.cursor(this.#screenPoint(event)) ?? this.#spacing.hover(this.#screenPoint(event)) ?? (this.engine.getVectorEdit() ? this.#vectors.hover(this.#point(event), event) ?? "default" : this.#onOrigin(this.#point(event)) ? "move" : this.#arcs.hover(this.#point(event)) ?? this.#rounding.hover(this.#point(event)) ?? this.#transforming.hover(this.#point(event)) ?? this.#smart.hover(this.#screenPoint(event), event));
      this.invalidate();
    }
    if (event.pointerId === this.#pointer && this.#vectors.active) {
      const started = performance.now(); this.#vectors.move(this.#point(event), event); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#arcs.active) {
      const started = performance.now(); this.#arcs.move(this.#point(event), event.shiftKey); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#rounding.active) {
      const started = performance.now(); this.#rounding.move(this.#point(event), event.altKey); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#transforming.active) {
      const started = performance.now(); this.#transforming.move(this.#point(event), event); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#moving.active) {
      const started = performance.now(); this.#moving.move(this.#point(event), event);
      this.canvas.style.cursor = this.#moving.copying ? "copy" : "default"; this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#smart.active) {
      const started = performance.now();
      this.#smart.move(this.#screenPoint(event), event, this.#width, this.#height); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#dragOrigin) {
      const started = performance.now();
      try { this.engine.dragRotationOrigin(this.#point(event), this.engine.getView().zoom); }
      catch (error) { this.onError(error instanceof Error ? error.message : "Could not move rotation origin"); this.cancel(); }
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#pan) {
      const point = this.#screenPoint(event);
      this.engine.updateView(scrollView(this.#pan.view, point.x - this.#pan.screen.x, point.y - this.#pan.screen.y)); return;
    }
    if (event.pointerId === this.#pointer && this.#zoomStart) {
      const point = this.#screenPoint(event), start = this.#zoomStart;
      this.#zoomArea = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
      this.invalidate(); return;
    }
    if (event.pointerId === this.#pointer && this.#drawing.active) {
      const started = performance.now(); this.#drawing.move(this.#point(event), event); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() });
    }
  };

  #up = (event: PointerEvent): void => {
    if (event.pointerId===this.#pointer && this.#crop.active) {this.#crop.up();this.cancel();return;}
    if (event.pointerId === this.#pointer && this.#spacing.active) { this.#spacing.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#blurHandles.active) { this.#blurHandles.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#gradients.active) { this.#gradients.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#builder.active) {
      try { this.#builder.up(this.#point(event),event); } catch (error) { this.onError(error instanceof Error ? error.message : "Shape Builder failed"); }
      this.cancel(); return;
    }
    if (event.pointerId === this.#pointer && this.engine.pencil.active) {
      try { this.engine.pencil.up(this.#point(event), pencilPointerPressure(event)); this.cancel(); } catch (error) { this.#penFailure(error); } return;
    }
    if (event.pointerId === this.#pointer && this.#penPointer) { this.engine.pen.up(); this.cancel(true); return; }
    if (event.pointerId === this.#pointer && this.#vectors.active) {
      const point = this.#point(event), forward = this.#vectors.up(point); this.cancel();
      if (forward && this.#moving.down(forward, event)) this.#moving.up(point, event);
      return;
    }
    if (event.pointerId === this.#pointer && this.#arcs.active) { this.#arcs.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#drawing.active) { this.#drawing.up(this.#point(event)); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#rounding.active) { this.#rounding.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#transforming.active) { this.#transforming.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#moving.active) { this.#moving.up(this.#point(event), event); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#smart.active) {
      this.#smart.up(this.#screenPoint(event), event, this.#width, this.#height); this.cancel(); return;
    }
    if (event.pointerId === this.#pointer && this.#dragOrigin) { this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#pan) { this.#move(event); this.cancel(this.engine.pen.open); return; }
    if (event.pointerId === this.#pointer && this.#zoomStart) {
      const start = this.#zoomStart, end = this.#screenPoint(event), view = this.engine.getView();
      const a = screenToPage(view, { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) });
      const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
      this.cancel(this.engine.pen.open);
      try { this.engine.execute("view.zoomAt", width > 4 && height > 4 ? { ...a, width: width / view.zoom, height: height / view.zoom } : { ...screenToPage(view, end), out: event.altKey }); }
      catch (error) { this.onError(error instanceof Error ? error.message : "Could not zoom"); }
      return;
    }
  };

  #wheel = (event: WheelEvent): void => {
    if (!this.engine.getSnapshot().editable) return;
    event.preventDefault();
    const view = this.engine.getView(), unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.vh : 1;
    const dx = event.deltaX * unit, dy = event.deltaY * unit;
    this.engine.updateView(event.ctrlKey || event.metaKey
      ? zoomAt(view, view.zoom * Math.exp(Math.max(-50, Math.min(50, -dy * 0.005))), screenToPage(view, this.#screenPoint(event)))
      : scrollView(view, -dx, -dy, event.shiftKey));
  };
  #onOrigin(point: Point): boolean {
    const origin = this.engine.getRotationOrigin();
    return Boolean(origin.editing && origin.point && Math.hypot(point.x - origin.point.x, point.y - origin.point.y) * this.engine.getView().zoom <= 8);
  }
  #doubleClick = (event: MouseEvent): void => {
    if (!this.engine.getSnapshot().editable) return;
    event.preventDefault();
    try {
      if (this.#text.active && this.#text.doubleClick(event)) return;
      if (this.engine.getSnapshot().tool === "shapeBuilder") return;
      if (this.engine.pen.doubleClick(this.#point(event))) return;
      if (this.#vectors.doubleClick(this.#point(event))) return;
      if (this.#transforming.doubleClickEdge(this.#point(event), event)) return;
      if (this.#text.doubleClick(event)) return;
      if (this.#onOrigin(this.#point(event))) this.engine.execute("transform.setRotationOrigin", { reset: true });
      else this.#moving.doubleClick(this.#point(event));
    } catch (error) { this.onError(error instanceof Error ? error.message : "Could not enter layer"); }
  };
  #blur = (): void => { this.#space = false; this.#zoomHeld = false; this.cancel(); };
  #cancelEvent = (event: PointerEvent): void => { if (this.#pointer === event.pointerId) this.cancel(); };
  #penFailure(error: unknown): void { this.cancel(); this.onError(error instanceof Error ? error.message : "Could not draw path"); }
  #key = (event: KeyboardEvent): void => {
    if (this.engine.getSnapshot().crop && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key==="Enter" || event.key==="Escape")) {
      event.preventDefault();event.stopPropagation();
      if (event.key==="Enter") {this.#crop.up();this.#transforming.up();}
      this.cancel();this.engine.finishCrop();return;
    }
    if (this.engine.getSnapshot().tool === "shapeBuilder" && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault(); event.stopPropagation();
      const finish = event.key === "Enter" || !this.#builder.active;
      this.cancel(); if (finish) this.engine.execute("tool.move");
      return;
    }
    if (this.engine.pen.open && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault(); event.stopPropagation();
      try { this.engine.pen.finish(event.key === "Escape" ? "pen" : "move"); this.cancel(); } catch (error) { this.#penFailure(error); }
      return;
    }
    if (!event.ctrlKey && !event.metaKey && (event.code === "Space" || event.key.toLowerCase() === "z")) {
      event.preventDefault();
      if (event.code === "Space") this.#space = true; else this.#zoomHeld = true;
    }
    if (event.key === "Escape") { event.preventDefault(); if (this.#vectors.active) event.stopPropagation(); this.cancel(); }
  };
  #keyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.#space = false;
    if (event.key.toLowerCase() === "z") this.#zoomHeld = false;
  };
  formatText(props: Record<string,unknown>) { return this.#text.format(props); }
  finishText() { this.#text.finish(); }
  flushTextForSave() { return this.#text.flushForSave(); }
  cancel(preservePen = false): void {
    if (!preservePen) {
      this.#crop.cancel();
      this.#gradients.cancel(); this.#blurHandles.cancel(); this.#spacing.cancel();
      this.#builder.cancel();
      this.engine.pencil.cancel();
      this.engine.pen.cancel();
      this.#vectors.cancel();
      this.#arcs.cancel();
      this.#drawing.cancel();
      this.#rounding.cancel();
      this.#transforming.cancel();
      this.#moving.cancel();
      this.#smart.cancel();
    }
    const pointer = this.#pointer;
    this.#pointer = null;
    this.#penPointer = false;
    this.#dragOrigin = false;
    this.canvas.style.cursor = "";
    this.#pan = undefined; this.#zoomStart = undefined; this.#zoomArea = undefined;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.invalidate();
  }
  #resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    this.#width = bounds.width;
    this.#height = bounds.height;
    this.#dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * this.#dpr));
    const height = Math.max(1, Math.round(bounds.height * this.#dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.engine.resizeViewport(this.#width, this.#height);
    this.invalidate();
  };
  invalidate(): void {
    if (this.#disposed || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const context = this.canvas.getContext("2d");
      if (!context) { this.onError("Canvas 2D is unavailable in this browser"); return; }
      const started = performance.now();
      context.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
      const snapshot = this.engine.getSnapshot();
      const view = this.engine.getView(), origin = viewOrigin(view);
      const vectorEdit = this.engine.getRenderVectorEdit(), pen = this.engine.getSnapshot().tool === "pen";
      const builder = snapshot.tool === "shapeBuilder";
      const crop = this.engine.pickedCrop();
      drawDocumentFrame(context, this.#text.preeditDocument ?? this.engine.getRenderDocument(), this.#width, this.#height, vectorEdit || pen || builder || this.#text.active ? [] : this.engine.getRenderSelection(), undefined, view, vectorEdit?.id, () => this.invalidate(), crop ? images => this.#crop.draw(context, images) : undefined);
      if (!this.#text.active && !crop && !builder && !pen && !vectorEdit && !this.#moving.active && !this.#transforming.active && !this.#rounding.active && !this.#arcs.active && !this.#drawing.active) this.#smart.draw(context);
      if (!this.#text.active && !crop && !builder && !pen && !vectorEdit && !this.#moving.active && !this.#transforming.active && !this.#smart.active && !this.#drawing.active) { this.#rounding.draw(context); this.#arcs.draw(context); }
      if (!this.#text.active && !crop && !builder && !pen && !vectorEdit && !this.#moving.active && !this.#smart.active) this.#transforming.draw(context);
      this.#text.draw(context);
      this.#moving.draw(context); this.#drawing.draw(context);
      if (vectorEdit) drawVectorEdit(context, this.engine.getRenderDocument(), vectorEdit, view, this.#vectors.overlay);
      if (pen) drawPen(context, this.engine.getRenderDocument(), view, this.engine.pen.overlay);
      this.engine.pencil.draw(context);
      if (builder) this.#builder.draw(context);
      this.#gradients.draw(context); this.#blurHandles.draw(context); this.#spacing.draw(context);
      const rotationOrigin = this.engine.getRotationOrigin();
      if (!vectorEdit && rotationOrigin.editing && rotationOrigin.point) {
        const point = pageToScreen(view, rotationOrigin.point);
        context.strokeStyle = canvasAccent(this.engine.getRenderDocument()); context.fillStyle = "#ffffff"; context.lineWidth = 1.5;
        context.beginPath(); context.arc(point.x, point.y, 5, 0, Math.PI * 2); context.fill(); context.stroke();
        context.beginPath();
        for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          context.moveTo(point.x + x * 5, point.y + y * 5); context.lineTo(point.x + x * 10, point.y + y * 10);
        }
        context.stroke(); context.fillStyle = canvasAccent(this.engine.getRenderDocument());
        context.beginPath(); context.arc(point.x, point.y, 1.5, 0, Math.PI * 2); context.fill();
      }
      if (this.#assetDrop) {
        const {id,line} = this.#assetDrop, doc = this.engine.getRenderDocument();
        const corners = doc.nodes[id] && id !== doc.currentPage && originBoxPoints(doc,[id]);
        context.save();
        context.strokeStyle = "#9747ff"; context.lineWidth = 2;
        if (corners) {
          context.beginPath();
          corners.slice(0,4).forEach((point,i)=>{
            const p = pageToScreen(view,point);
            if (i) context.lineTo(p.x,p.y); else context.moveTo(p.x,p.y);
          });
          context.closePath(); context.stroke();
        }
        if (line) {
          const a = pageToScreen(view,{x:line[0],y:line[1]}), b = pageToScreen(view,{x:line[2],y:line[3]});
          context.beginPath(); context.moveTo(a.x,a.y); context.lineTo(b.x,b.y); context.stroke();
        }
        context.restore();
      }
      if (this.#zoomArea) {
        context.strokeStyle = canvasAccent(this.engine.getRenderDocument()); context.lineWidth = 1;
        context.strokeRect(this.#zoomArea.x, this.#zoomArea.y, this.#zoomArea.width, this.#zoomArea.height);
      }
      this.canvas.dataset.viewOriginX = String(origin.x); this.canvas.dataset.viewOriginY = String(origin.y); this.canvas.dataset.viewZoom = String(view.zoom);
      performance.measure("figcraft:render", { start: started, end: performance.now() });
      // Keep diagnostics bounded during long editing sessions.
      if (performance.getEntriesByName("figcraft:render").length > 600) performance.clearMeasures("figcraft:render");
      if (performance.getEntriesByName("figcraft:pointer").length > 1200) performance.clearMeasures("figcraft:pointer");
    });
  }
  previewAsset(id?: string, point?: Point, alt = false, source?:Document) {
    const doc = this.engine.getRenderDocument();
    const main = id && defaultMain(source ?? doc,id);
    if (!main || !point) {
      if (this.#assetDrop) { this.#assetDrop = undefined; this.invalidate(); }
      return;
    }
    const swap = alt ? assetSwapTarget(doc,point,main,source ?? doc) : undefined;
    const slot = swap ? undefined : assetDropSlot(doc,point);
    this.#assetDrop = {id:swap?.id ?? slot!.parent,line:slot?.line};
    this.invalidate();
    return swap?.id;
  }

  dispose(): void {
    const context = this.canvas.getContext("2d");
    if (context) { imagePages.get(context)?.clear(); imagePages.delete(context); imageCaches.get(context)?.clear(); imageCaches.delete(context); }
    this.#disposed = true;
    this.cancel();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#observer.disconnect();
    this.#unsubscribe();
    this.#unsubscribeView();
    this.#unsubscribeOrigin();
    this.#unsubscribeCanvas();
    this.#abort.abort();
  }
}
