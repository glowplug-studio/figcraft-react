import { transformBounds, type Affine } from "./affine";
import { canvasBlend } from "./blend";
import { compositeSurface } from "./blend-composite";
import { renderColour } from "./colour";
import { drawGradient } from "./gradient-renderer";
import type { Rectangle } from "./geometry";
import type { LayerPaintSteps } from "./image-renderer";
import type { Paint } from "./solid-paint";
import type { RegionPaintSpace } from "./vector-network";

const buffers = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();

function* draw(ctx: CanvasRenderingContext2D, path: Path2D | undefined, rule: CanvasFillRule,
  width: number, height: number, paint: Paint, space?: RegionPaintSpace): LayerPaintSteps {
  if (paint.type === "solid") {
    ctx.fillStyle = renderColour(paint.color);
    if (path) ctx.fill(path,rule); else ctx.fillRect(0,0,width,height);
    return;
  }
  if (path) ctx.clip(path,rule);
  else { ctx.beginPath(); ctx.rect(0,0,width,height); ctx.clip(); }
  if (paint.type === "gradient") drawGradient(ctx,paint,width,height,space);
  else yield [ctx,paint,width,height,space];
}

/** Paint one local contour, retaining the active clip across suspended image decodes. */
export function* paintPath(ctx: CanvasRenderingContext2D, path: Path2D | undefined, rule: CanvasFillRule,
  width: number, height: number, paint: Paint, alpha: number, space?: RegionPaintSpace,
  deviceBounds?: (matrix: Affine) => Rectangle): LayerPaintSteps {
  const opacity = Math.min(1,Math.max(0,paint.opacity)) * alpha;
  if (paint.blend !== "plusDarker") {
    ctx.save();
    try {
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = canvasBlend[paint.blend];
      yield* draw(ctx,path,rule,width,height,paint,space);
    } finally { ctx.restore(); }
    return;
  }
  const m = ctx.getTransform(), matrix: Affine = [m.a,m.b,m.c,m.d,m.e,m.f];
  const b = deviceBounds ? deviceBounds(matrix) : transformBounds(matrix,width,height);
  const left=Math.max(0,Math.floor(b.x)), top=Math.max(0,Math.floor(b.y));
  const w=Math.min(ctx.canvas.width,Math.ceil(b.x+b.width))-left;
  const h=Math.min(ctx.canvas.height,Math.ceil(b.y+b.height))-top;
  if (w<=0 || h<=0) return;
  let target=buffers.get(ctx);
  if (!target) {
    target=ctx.canvas.ownerDocument.createElement("canvas").getContext("2d",{willReadFrequently:true})!;
    buffers.set(ctx,target);
  }
  if (target.canvas.width < w) target.canvas.width=w;
  if (target.canvas.height < h) target.canvas.height=h;
  target.resetTransform(); target.clearRect(0,0,w,h);
  target.save();
  try {
    target.setTransform(m.a,m.b,m.c,m.d,m.e-left,m.f-top);
    yield* draw(target,path,rule,width,height,paint,space);
  } finally { target.restore(); }
  compositeSurface(ctx,target,left,top,w,h,paint.blend,opacity);
}
