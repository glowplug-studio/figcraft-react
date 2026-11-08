import { multiply } from "./affine";
import { renderColour, toRgba8 } from "./colour";
import { gradientFrame, sampleSorted, sortedStops, type ColourStop } from "./gradient";
import type { GradientPaint } from "./solid-paint";
import type { RegionPaintSpace } from "./vector-network";

const stopCache = new WeakMap<GradientPaint, readonly ColourStop[]>();
const diamonds = new WeakMap<GradientPaint, HTMLCanvasElement>();

// The native 256px diamond texture samples the Manhattan distance at texel centres.
function diamondTexture(context: CanvasRenderingContext2D, paint: GradientPaint, stops: readonly ColourStop[]) {
  const cached = diamonds.get(paint);
  if (cached) return cached;
  const tile = context.canvas.ownerDocument.createElement("canvas");
  tile.width = tile.height = 256;
  const ctx = tile.getContext("2d")!;
  const pixels = ctx.createImageData(256, 256);
  // The quantised distances have only 256 distinct values.
  const palette = Array.from({length:256}, (_, i) => toRgba8(sampleSorted(stops,i/128)));
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    pixels.data.set(palette[Math.abs(x-127.5) + Math.abs(y-127.5)], 4*(y*256+x));
  }
  ctx.putImageData(pixels,0,0);
  diamonds.set(paint,tile);
  return tile;
}

/** Fill the current clip in gradient coordinates. The caller established the shape or stroke mask. */
export function drawGradient(context: CanvasRenderingContext2D, paint: GradientPaint, width: number, height: number, space?: RegionPaintSpace) {
  const frame = gradientFrame(paint,space?.width ?? width,space?.height ?? height);
  if (!frame.every(Number.isFinite)) return;
  const matrix = space ? multiply(space.transform,frame) : frame;
  if (!matrix.every(Number.isFinite) || matrix[0]*matrix[3] === matrix[1]*matrix[2]) return;
  let stops = stopCache.get(paint);
  if (!stops) { stops = sortedStops(paint.stops); stopCache.set(paint,stops); }
  context.save();
  try {
    context.transform(...matrix);
    const inverse = context.getTransform().inverse();
    const w = context.canvas.width, h = context.canvas.height;
    const dx = inverse.a*w, ex = inverse.c*h, dy = inverse.b*w, ey = inverse.d*h;
    const left = inverse.e+Math.min(0,dx)+Math.min(0,ex)-1, right = inverse.e+Math.max(0,dx)+Math.max(0,ex)+1;
    const top = inverse.f+Math.min(0,dy)+Math.min(0,ey)-1, bottom = inverse.f+Math.max(0,dy)+Math.max(0,ey)+1;
    if (![left,right,top,bottom].every(Number.isFinite)) return;
    if (paint.kind === "diamond") {
      const surround = new Path2D();
      // Cover the viewport and the entire tile so the even-odd hole is always nested.
      const x = Math.min(left,-1), y = Math.min(top,-1);
      surround.rect(x,y,Math.max(right,1)-x,Math.max(bottom,1)-y);
      surround.rect(-1,-1,2,2);
      context.fillStyle = renderColour(stops[stops.length-1].color);
      context.fill(surround,"evenodd");
      context.drawImage(diamondTexture(context,paint,stops),-1,-1,2,2);
      return;
    }
    const gradient = paint.kind === "linear" ? context.createLinearGradient(0,0,1,0)
      : paint.kind === "angular" ? context.createConicGradient(0,0,0) : context.createRadialGradient(0,0,0,0,0,1);
    for (const stop of stops) gradient.addColorStop(stop.position,renderColour(stop.color));
    context.fillStyle = gradient;
    context.fillRect(left,top,right-left,bottom-top);
  } finally { context.restore(); }
}
