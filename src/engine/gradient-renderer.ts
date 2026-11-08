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

/** Split at device-pixel boundaries. Two antialiased edges on a translucent paint
 * otherwise leave a light seam between the texture and the padded end colour. */
function drawDiamond(context: CanvasRenderingContext2D, paint: GradientPaint, stops: readonly ColourStop[]) {
  const frame = context.getTransform(), inverse = frame.inverse();
  const width = context.canvas.width, height = context.canvas.height;
  const tile = context.createPattern(diamondTexture(context,paint,stops),"repeat");
  if (!tile || !Number.isFinite(inverse.a)) return;
  tile.setTransform(frame.translate(-1,-1).scale(2/256));
  context.resetTransform();
  const interior = new Path2D();
  // Intersect each row of pixel centres with both unit-square coordinate intervals.
  const extent = Math.abs(frame.b) + Math.abs(frame.d);
  const first = Math.max(0,Math.ceil(frame.f-extent-.5));
  const last = Math.min(height,Math.floor(frame.f+extent-.5)+1);
  const axisAligned = frame.b === 0 && frame.c === 0 || frame.a === 0 && frame.d === 0;
  if (axisAligned && last>first) {
    const radius = Math.abs(frame.a) + Math.abs(frame.c);
    const left = Math.max(0,Math.ceil(frame.e-radius-.5));
    const right = Math.min(width,Math.floor(frame.e+radius-.5)+1);
    if (right>left) interior.rect(left,first,right-left,last-first);
  }
  for (let y=first; !axisAligned && y<last; y++) {
    let left=0, right=width;
    const u=inverse.c*(y+.5)+inverse.e, v=inverse.d*(y+.5)+inverse.f;
    if (inverse.a===0 && Math.abs(u)>1 || inverse.b===0 && Math.abs(v)>1) continue;
    if (inverse.a!==0) {
      const x0=(-1-u)/inverse.a, x1=(1-u)/inverse.a;
      left=Math.max(left,Math.ceil(Math.min(x0,x1)-.5)); right=Math.min(right,Math.floor(Math.max(x0,x1)-.5)+1);
    }
    if (inverse.b!==0) {
      const x0=(-1-v)/inverse.b, x1=(1-v)/inverse.b;
      left=Math.max(left,Math.ceil(Math.min(x0,x1)-.5)); right=Math.min(right,Math.floor(Math.max(x0,x1)-.5)+1);
    }
    if (right>left) interior.rect(left,y,right-left,1);
  }
  const exterior=new Path2D(interior);
  exterior.rect(0,0,width,height);
  context.fillStyle=renderColour(stops[stops.length-1].color);
  context.fill(exterior,"evenodd");
  context.fillStyle=tile;
  context.fill(interior);
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
    if (paint.kind === "diamond") { drawDiamond(context,paint,stops); return; }
    const inverse = context.getTransform().inverse();
    const w = context.canvas.width, h = context.canvas.height;
    const dx = inverse.a*w, ex = inverse.c*h, dy = inverse.b*w, ey = inverse.d*h;
    const left = inverse.e+Math.min(0,dx)+Math.min(0,ex)-1, right = inverse.e+Math.max(0,dx)+Math.max(0,ex)+1;
    const top = inverse.f+Math.min(0,dy)+Math.min(0,ey)-1, bottom = inverse.f+Math.max(0,dy)+Math.max(0,ey)+1;
    if (![left,right,top,bottom].every(Number.isFinite)) return;
    const gradient = paint.kind === "linear" ? context.createLinearGradient(0,0,1,0)
      : paint.kind === "angular" ? context.createConicGradient(0,0,0) : context.createRadialGradient(0,0,0,0,0,1);
    for (const stop of stops) gradient.addColorStop(stop.position,renderColour(stop.color));
    context.fillStyle = gradient;
    context.fillRect(left,top,right-left,bottom-top);
  } finally { context.restore(); }
}
