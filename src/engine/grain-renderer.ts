import { inverse, type Affine } from "./affine";
import { compositeSurface } from "./blend-composite";
import type { Effect } from "./effects";
import { reserveLayerPixels } from "./mask-renderer";

type Grain = Extract<Effect, { type: "noise" | "texture" }>;
const word = 0x100000000;
const i64Limit = 2 ** 63;
const f32 = Math.fround;

// High word of an unsigned 32 × 32 product. Splitting at 16 bits keeps every
// intermediate exactly representable by a JS number.
function highProduct(a: number, b: number) {
  const al = a & 65535, ah = a >>> 16, bl = b & 65535, bh = b >>> 16;
  const middle = al * bh + ah * bl + ((al * bl) >>> 16);
  return (ah * bh + Math.floor(middle / 65536)) >>> 0;
}

function lowWord(n: number) {
  return n >= i64Limit ? 0xffffffff : n <= -i64Limit ? 0 : n >>> 0;
}
function highWord(n: number) {
  return n >= i64Limit ? 0x7fffffff : n <= -i64Limit ? 0x80000000 : Math.floor(n / word) >>> 0;
}

/** Native grain::hash using two wrapping 32-bit words, with no allocation in the pixel loop. */
export class GrainHash {
  lo = 0;
  hi = 0;
  readonly seedLo: number;
  readonly seedHi: number;
  constructor(seed: number) {
    this.seedLo = Math.imul(seed,0x9e3779f9);
    this.seedHi = (highProduct(seed,0x9e3779f9) + Math.imul(seed,0x165667b1)) >>> 0;
  }
  #mix(lo: number, hi: number) {
    this.lo ^= this.hi >>> 1;
    this.hi = (highProduct(this.lo,lo) + Math.imul(this.hi,lo) + Math.imul(this.lo,hi)) >>> 0;
    this.lo = Math.imul(this.lo,lo);
  }
  set(x: number, y: number) {
    const xl=lowWord(x), xh=highWord(x), yl=lowWord(y), yh=highWord(y);
    this.lo = Math.imul(xl,0x7f4a7c15) ^ Math.imul(yl,0x27d4eb4f) ^ this.seedLo;
    this.hi = ((highProduct(xl,0x7f4a7c15) + Math.imul(xh,0x7f4a7c15) + Math.imul(xl,0x9e3779b9)) ^
      (highProduct(yl,0x27d4eb4f) + Math.imul(yh,0x27d4eb4f) + Math.imul(yl,0xc2b2ae3d)) ^ this.seedHi) >>> 0;
    this.#mix(0xed558ccd,0xff51afd7);
    this.#mix(0x1a85ec53,0xc4ceb9fe);
    this.lo = (this.lo ^ (this.hi >>> 1)) >>> 0;
  }
}

const grainSize = (v: number) => 2 * (Number.isFinite(v) ? Math.min(1000,Math.max(.01,v)) : .5);
function cellCoordinate(v: number) {
  const fine = v * 1048576;
  return Math.floor((fine < 0 ? -Math.round(-fine) : Math.round(fine)) / 1048576);
}

function cellMatrix(xf: Affine, effect: Grain): Affine | undefined {
  let inv: Affine;
  try { inv = inverse(xf); } catch { return; }
  const gx = grainSize(effect.size), gy = grainSize(effect.sizeY ?? effect.size);
  const m: Affine = [inv[0]/gx,inv[1]/gy,inv[2]/gx,inv[3]/gy,inv[4]/gx,inv[5]/gy];
  return m.every(Number.isFinite) ? m : undefined;
}

function colourByte(v: number, alpha: number) {
  return Math.round(f32(f32(v * alpha) * 255));
}

/** Generate a premultiplied overlay (noise) or replacement (texture). */
export function grainPixels(source: Uint8Array, width: number, height: number, effect: Grain, xf: Affine, scale: number, seed: number) {
  const texture = effect.type === "texture";
  const rawRadius = texture ? effect.radius * scale : 0;
  const density = texture ? 0 : f32(Math.max(0,Math.min(1,effect.density)));
  if (texture ? !Number.isFinite(rawRadius) || rawRadius < .5 : !density) return;
  const m = cellMatrix(xf,effect);
  if (!m) return;
  const r = f32(Math.min(2048,rawRadius)), hash = new GrainHash(texture ? seed ^ 0x7e57 : seed);
  const out = new Uint8Array(source.length);
  let lastX = NaN, lastY = NaN, mx = 0, my = 0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const offset = (y*width+x)*4;
    if (!texture && source[offset+3] === 0) continue;
    const ix = cellCoordinate(m[0]*(x+.5) + m[2]*(y+.5) + m[4]);
    const iy = cellCoordinate(m[1]*(x+.5) + m[3]*(y+.5) + m[5]);
    if (ix !== lastX || iy !== lastY) {
      lastX=ix; lastY=iy; hash.set(ix,iy);
      if (texture) {
        const angle = f32(((hash.lo & 65535)/65536) * f32(2*Math.PI));
        const distance = f32(f32(Math.sqrt((hash.lo>>>16)/65536)) * r);
        mx = Math.floor(f32(.5 + f32(f32(Math.cos(angle)) * distance)));
        my = Math.floor(f32(.5 + f32(f32(Math.sin(angle)) * distance)));
      }
    }
    if (effect.type === "texture") {
      const sx=x+mx, sy=y+my;
      if (sx<0 || sy<0 || sx>=width || sy>=height) continue;
      const src=(sy*width+sx)*4, keep=effect.clipToShape ? source[offset+3] : 255;
      for (let c=0;c<4;c++) out[offset+c]=Math.floor((source[src+c]*keep+127)/255);
    } else {
      if ((hash.lo & 65535)/65536 >= density) continue;
      const colour=effect.mode==="duo" && hash.hi>>>31 ? effect.secondary : effect.color;
      const multi=effect.mode==="multi";
      const opacity=multi ? Math.max(0,Math.min(1,effect.opacity)) : colour.a;
      const alpha=f32(f32(source[offset+3]/255)*opacity);
      out[offset]=colourByte(multi ? (hash.lo>>>16)/65536 : colour.r,alpha);
      out[offset+1]=colourByte(multi ? (hash.hi & 65535)/65536 : colour.g,alpha);
      out[offset+2]=colourByte(multi ? (hash.hi>>>16)/65536 : colour.b,alpha);
      out[offset+3]=colourByte(1,alpha);
    }
  }
  return out;
}

export function applyGrain(ctx: CanvasRenderingContext2D, effect: Grain, xf: Affine, scale: number, id: string) {
  const {width,height} = ctx.canvas, release=reserveLayerPixels(width,height,4);
  if (!release) return;
  let overlay: HTMLCanvasElement | undefined;
  try {
    const image=ctx.getImageData(0,0,width,height), data=image.data;
    const input=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    if (effect.type==="texture") for (let i=0;i<input.length;i+=4) {
      for(let c=0;c<3;c++) input[i+c]=Math.round(input[i+c]*input[i+3]/255);
    }
    const out=grainPixels(input,width,height,effect,xf,scale,Number(BigInt.asUintN(32,BigInt(id))));
    if (!out) return;
    for (let i=0;i<out.length;i+=4) {
      const alpha=out[i+3];
      for(let c=0;c<3;c++) data[i+c]=alpha ? Math.round(out[i+c]*255/alpha) : 0;
      data[i+3]=alpha;
    }
    if (effect.type==="texture") ctx.putImageData(image,0,0);
    else {
      overlay=ctx.canvas.ownerDocument.createElement("canvas"); overlay.width=width; overlay.height=height;
      const grains=overlay.getContext("2d")!;
      grains.putImageData(image,0,0);
      compositeSurface(ctx,grains,0,0,width,height,effect.blend,1);
    }
  } finally {
    if (overlay) overlay.width=overlay.height=0;
    release();
  }
}
