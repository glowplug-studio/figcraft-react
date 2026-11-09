import { compositeSurface } from "./blend-composite";
import { maskOutline, paintedStrokePath } from "./boolean-result";
import { tracePath, type PathCommand } from "./corners";
import { isLeaf, layerTransform, rectanglePaints, type Document, type LayerNode } from "./document";
import { dropShadowPixels, innerShadowPadding, innerShadowPixels } from "./effect-raster";
import type { Effect } from "./effects";
import { opaqueImageFill } from "./image-renderer";
import { reserveLayerPixels } from "./mask-renderer";
import { normaliseBooleanPath } from "./path-boolean";
import { isClosedShape, shapePath } from "./shape-path";

type Shadow = Extract<Effect, { type: "dropShadow" | "innerShadow" }>;
type Outline = { path: readonly PathCommand[]; rule: CanvasFillRule };

export function hasShadows(node: LayerNode) {
  return node.effects?.some(e => e.visible && (e.type === "dropShadow" || e.type === "innerShadow"));
}

/** Effects have page-space offsets and radii. An outline's spread also follows its local affine. */
export function shadowReach(node: LayerNode) {
  let page = 0, local = 0;
  for (const e of node.effects ?? []) if (e.visible && e.type === "dropShadow") {
    page = Math.max(page, Math.min(1e12, 2 * Math.abs(e.radius) + Math.abs(e.offset[0]) + Math.abs(e.offset[1]) + 4 * Math.abs(e.spread)));
    local = Math.max(local, Math.min(1e12, 4 * Math.max(0, e.spread)));
  }
  return { page, local };
}

function alphaPixels(ctx: CanvasRenderingContext2D) {
  const {width,height} = ctx.canvas;
  const data = ctx.getImageData(0,0,width,height).data;
  const alpha = new Uint8Array(width * height);
  for (let i=0;i<alpha.length;i++) alpha[i] = data[i*4+3];
  return alpha;
}

function filledShape(doc: Document, node: LayerNode): Outline | undefined {
  if (node.kind === "group") return;
  if (node.kind === "vector") return maskOutline(doc,node,0);
  return {path:shapePath(node), rule:"nonzero"};
}

function alphaFills(doc: Document, node: LayerNode, includeZero: boolean) {
  const paints = rectanglePaints(node).filter(p => p.visible && (includeZero || p.opacity > 0));
  return paints.length > 0 && paints.every(p => p.type === "pattern" || p.type === "image" && !opaqueImageFill(doc.images?.[p.image],p,node.width,node.height));
}

function outlines(doc: Document, node: LayerNode, includeZero: boolean): Outline[] | undefined {
  if (node.kind === "group" || alphaFills(doc,node,includeZero)) return;
  const filled = rectanglePaints(node).some(p => p.visible && (includeZero || p.opacity > 0));
  if (!isLeaf(node) && node.children.some(id => { const child = doc.nodes[id]; return child && child.kind !== "page" && child.visible !== false; })
    && !(node.kind === "frame" && node.clip && filled)) return;
  const result: Outline[] = [];
  const shape = filled && isClosedShape(node) ? filledShape(doc,node) : undefined;
  if (shape) result.push(shape);
  const stroke = paintedStrokePath(doc,node);
  if (stroke?.length) result.push({path:stroke,rule:"nonzero"});
  return result.length ? result : undefined;
}

function outlineAlpha(canvas: HTMLCanvasElement, width: number, height: number, geometry: readonly Outline[],
  matrix: DOMMatrix, spread = 0, dx = 0, dy = 0) {
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d",{willReadFrequently:true})!;
  ctx.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e+dx,matrix.f+dy);
  ctx.fillStyle = "white"; ctx.strokeStyle = "white";
  const paths = geometry.map(outline => {
    const path = new Path2D();
    let commands = outline.path;
    if (spread < 0 && outline.rule === "nonzero") {
      try { commands = normaliseBooleanPath(commands); } catch { /* Preserve the native best-effort outline. */ }
    }
    tracePath(path,commands);
    ctx.fill(path,outline.rule);
    return path;
  });
  const scale = Math.sqrt(Math.abs(matrix.a*matrix.d-matrix.b*matrix.c));
  const half = Number.isFinite(scale) && scale > 0 ? Math.min(Math.abs(spread),1e6/scale) : 0;
  if (half > 1e-6) {
    ctx.globalCompositeOperation = spread > 0 ? "source-over" : "destination-out";
    ctx.lineWidth = 2 * half;
    ctx.lineJoin = "miter"; ctx.miterLimit = 4;
    for (const path of paths) ctx.stroke(path);
  }
  return alphaPixels(ctx);
}

function writeShadow(canvas: HTMLCanvasElement, rgba: Uint8Array, width: number, height: number) {
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d",{willReadFrequently:true})!, image = ctx.createImageData(width,height);
  for (let at=0;at<rgba.length;at+=4) {
    const a = rgba[at+3];
    if (!a) continue;
    image.data[at] = Math.round(rgba[at]*255/a);
    image.data[at+1] = Math.round(rgba[at+1]*255/a);
    image.data[at+2] = Math.round(rgba[at+2]*255/a);
    image.data[at+3] = a;
  }
  ctx.putImageData(image,0,0);
  return ctx;
}

/** One isolated layer, with its children/strokes drawn between the inner and outer passes. */
export class ShadowLayer {
  readonly matrix: DOMMatrix;
  readonly surface: HTMLCanvasElement;
  constructor(readonly layer: CanvasRenderingContext2D, readonly doc: Document, readonly node: LayerNode, readonly scale: number) {
    this.matrix = layer.getTransform().multiply(new DOMMatrix([...layerTransform(node)]));
    this.surface = layer.canvas.ownerDocument.createElement("canvas");
  }
  inner() {
    const {node,layer,surface,scale,matrix} = this, {width,height} = layer.canvas;
    const inner = node.effects?.filter((e): e is Shadow => e.visible && e.type === "innerShadow");
    if (!inner?.length) return;
    const shape = alphaFills(this.doc,node,true) ? undefined : filledShape(this.doc,node);
    const cover = shape ? outlineAlpha(surface,width,height,[shape],matrix) : alphaPixels(layer);
    for (const e of inner) {
      const pad = innerShadowPadding(e, scale, !!shape), w=width+2*pad,h=height+2*pad;
      const release = reserveLayerPixels(w,h,2);
      if (!release) continue;
      try {
        const expanded = shape ? outlineAlpha(surface,w,h,[shape],matrix,-e.spread,pad+e.offset[0]*scale,pad+e.offset[1]*scale) : undefined;
        const rgba = innerShadowPixels(cover,width,height,e,scale,expanded);
        compositeSurface(layer,writeShadow(surface,rgba,width,height),0,0,width,height,"normal",1);
      } finally { release(); }
    }
  }
  drop(ctx: CanvasRenderingContext2D, left: number, top: number) {
    const {node,layer,scale,surface,matrix} = this, {width,height} = layer.canvas;
    const drop = node.effects?.filter((e): e is Shadow => e.visible && e.type === "dropShadow");
    if (!drop?.length) return;
    const alpha = alphaPixels(layer);
    const hiding = drop.some(e=>!e.showBehind) && outlines(this.doc,node,true);
    const cover = hiding ? outlineAlpha(surface,width,height,hiding,matrix) : alpha;
    const casting = drop.some(e=>e.spread !== 0) && outlines(this.doc,node,false);
    for (const e of drop) {
      const spread = e.spread && casting ? outlineAlpha(surface,width,height,casting,matrix,e.spread,e.offset[0]*scale,e.offset[1]*scale) : undefined;
      const rgba = dropShadowPixels(alpha,width,height,e,scale,cover,spread);
      compositeSurface(ctx,writeShadow(surface,rgba,width,height),left,top,width,height,e.blend,node.opacity ?? 1);
    }
  }
  dispose() { this.surface.width = this.surface.height = 0; }
}
