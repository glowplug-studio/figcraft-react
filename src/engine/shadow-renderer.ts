import { blurRadius } from "./blur-renderer";
import { compositeSurface } from "./blend-composite";
import { maskOutline, paintedStrokePath } from "./boolean-result";
import { tracePath, type PathCommand } from "./corners";
import { isFrameLike, isLeaf, layerTransform, rectanglePaints, type Document, type LayerNode } from "./document";
import { dropShadowPixels, innerShadowPadding, innerShadowPixels } from "./effect-raster";
import type { Effect } from "./effects";
import { opaqueImageFill } from "./image-renderer";
import { reserveLayerPixels } from "./mask-renderer";
import { normaliseBooleanPath } from "./path-boolean";
import { defaultStroke, hasVisibleStroke } from "./stroke";
import { isClosedShape, shapePath } from "./shape-path";

type Shadow = Extract<Effect, { type: "dropShadow" | "innerShadow" }>;
export type ShadowOutline = { path: readonly PathCommand[]; rule: CanvasFillRule };

export function hasShadows(node: LayerNode) {
  return node.effects?.some(e => e.visible && (e.type === "dropShadow" || e.type === "innerShadow"));
}

function alphaPixels(ctx: CanvasRenderingContext2D) {
  const {width,height} = ctx.canvas;
  const data = ctx.getImageData(0,0,width,height).data;
  const alpha = new Uint8Array(width * height);
  for (let i=0;i<alpha.length;i++) alpha[i] = data[i*4+3];
  return alpha;
}

function filledShape(doc: Document, node: LayerNode): ShadowOutline | undefined {
  if (node.kind === "group") return;
  if (node.kind === "vector" || node.kind === "booleanOp") return maskOutline(doc,node,0);
  return {path:shapePath(node), rule:"nonzero"};
}

export function alphaFills(doc: Document, node: LayerNode, includeZero: boolean) {
  const paints = rectanglePaints(node).filter(p => p.visible && (includeZero || p.opacity > 0));
  return paints.length > 0 && paints.every(p => p.type === "pattern" || p.type === "image" && !opaqueImageFill(doc.images?.[p.image],p,node.width,node.height));
}

export function shadowOutlines(doc: Document, node: LayerNode, includeZero: boolean): ShadowOutline[] | undefined {
  if (node.kind === "group" || node.kind === "text" && hasVisibleStroke(node) || alphaFills(doc,node,includeZero)) return;
  const filled = rectanglePaints(node).some(p => p.visible && (includeZero || p.opacity > 0));
  if (!isLeaf(node) && node.kind !== "booleanOp" && node.children.some(id => { const child = doc.nodes[id]; return child && child.kind !== "page" && child.visible !== false; })
    && !(isFrameLike(node) && node.clip && filled)) return;
  const result: ShadowOutline[] = [];
  const shape = filled && isClosedShape(node) ? filledShape(doc,node) : undefined;
  if (shape) result.push(shape);
  const stroke = paintedStrokePath(doc,node);
  if (stroke?.length) {
    const s=node.stroke ?? defaultStroke;
    const even=!!s.sides || !s.dashes.length && isClosedShape(node) && s.align!=="center";
    result.push({path:stroke,rule:even ? "evenodd" : "nonzero"});
  }
  return result.length ? result : undefined;
}

function outlineAlpha(canvas: HTMLCanvasElement, width: number, height: number, geometry: readonly ShadowOutline[],
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
    const moved = node.effects?.some(e=>e.visible && (e.type==="layerBlur" && blurRadius(e)>0 || e.type==="texture" && !e.clipToShape && e.radius!==0));
    const hiding = !moved && drop.some(e=>!e.showBehind) && shadowOutlines(this.doc,node,true);
    const cover = hiding ? outlineAlpha(surface,width,height,hiding,matrix) : alpha;
    const casting = drop.some(e=>e.spread !== 0) && shadowOutlines(this.doc,node,false);
    for (const e of drop) {
      const spread = e.spread && casting ? outlineAlpha(surface,width,height,casting,matrix,e.spread,e.offset[0]*scale,e.offset[1]*scale) : undefined;
      const rgba = dropShadowPixels(alpha,width,height,e,scale,cover,spread);
      compositeSurface(ctx,writeShadow(surface,rgba,width,height),left,top,width,height,e.blend,node.opacity ?? 1);
    }
  }
  dispose() { this.surface.width = this.surface.height = 0; }
}
