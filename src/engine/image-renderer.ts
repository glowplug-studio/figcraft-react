import { decodeImageBitmap } from "./image-decode";
import { adjustImagePixels, type ImageFilters } from "./image-filters";
import { cropRect, imageTransform, placementCrop } from "./image-placement";
import type { ImageResource } from "./image-resource";
import type { ImagePaint } from "./solid-paint";
import type { RegionPaintSpace } from "./vector-network";

import { convertColourPixels, type ColourProfile } from "./colour-spaces";

const MAX_SIDE = 16_384;
const PIXEL_BYTES = 512 * 1024 * 1024;
const MAX_CACHED_IMAGES = 256;

interface ImageVariant {
  key: string;
  resource: ImageResource;
  filters: ImageFilters;
  profile: ColourProfile;
  screen: boolean;
  width: number;
  height: number;
  bytes: number;
  loading?: boolean;
  bitmap?: ImageBitmap;
}

export async function decodeVariant(entry: Pick<ImageVariant, "resource" | "width" | "height" | "filters" | "profile" | "screen">, current: () => boolean): Promise<ImageBitmap> {
  const { resource, width, height, filters, profile } = entry;
  const source = await decodeImageBitmap(resource, width, height, profile);
  const adjust = Object.values(filters).some(value => value !== 0);
  const convert = profile === "displayP3" && !resource.icc && !resource.profileName?.startsWith("Gamma ");
  const proof = entry.screen && profile === "displayP3";
  if (!adjust && !convert && !proof) return source;
  try {
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image adjustment surface is unavailable");
    context.drawImage(source, 0, 0);
    source.close();
    // Limit transient readback to one MiB and allow input or document replacement between strips.
    const rows = Math.max(1, Math.floor(262144 / width));
    for (let y = 0; y < height; y += rows) {
      if (y) await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!current()) throw new Error("Image decode was cancelled");
      const pixels = context.getImageData(0, y, width, Math.min(rows, height-y));
      if (adjust) adjustImagePixels(pixels.data, filters);
      if (convert) convertColourPixels(pixels.data, "srgb", profile);
      if (proof) convertColourPixels(pixels.data, profile, "srgb");
      context.putImageData(pixels, 0, y);
    }
    return surface.transferToImageBitmap();
  } finally { source.close(); }
}

export type PaintSteps = Generator<[context: CanvasRenderingContext2D, paint: ImagePaint, width: number, height: number, space?: RegionPaintSpace], void>;

function coversBox(paint: ImagePaint, iw: number, ih: number, w: number, h: number): boolean {
  if (paint.scale_mode !== "crop") return paint.scale_mode === "fill";
  const crop = placementCrop(paint, iw, ih, w, h);
  const [x0,y0,x1,y1] = cropRect(crop);
  return crop[1] === 0 && crop[2] === 0 && Math.min(x0,x1) <= 0 && Math.min(y0,y1) <= 0 && Math.max(x0,x1) >= 1 && Math.max(y0,y1) >= 1;
}

// A file may contain finite coefficients whose products exceed JavaScript's numeric range.
function drawableTransform(paint: ImagePaint, iw: number, ih: number, w: number, h: number) {
  try { return imageTransform(paint, iw, ih, w, h); }
  catch { return undefined; }
}

/** Draw into an established path or coverage mask. Extend boundary texels for covered strokes. */
function drawPixels(ctx: CanvasRenderingContext2D, paint: ImagePaint, bitmap: ImageBitmap, width: number, height: number, space: RegionPaintSpace | undefined, magnifiedPixels: boolean) {
  const iw = bitmap.width, ih = bitmap.height, w = space?.width ?? width, h = space?.height ?? height;
  const transform = drawableTransform(paint, iw, ih, w, h);
  if (!transform) return;
  ctx.save();
  try {
    if (space) ctx.transform(...space.transform);
    ctx.transform(...transform);
    const frame = ctx.getTransform(), inverse = frame.inverse();
    if (!Number.isFinite(inverse.a)) return;
    // Upstream shows individual fill texels from two device pixels per image pixel.
    ctx.imageSmoothingEnabled = !magnifiedPixels || Math.abs(frame.a*frame.d-frame.b*frame.c) < 4;
    ctx.imageSmoothingQuality = magnifiedPixels ? "high" : "low";
    if (paint.scale_mode === "tile") {
      const pattern = ctx.createPattern(bitmap, "repeat");
      if (!pattern) return;
      pattern.setTransform(frame);
      ctx.resetTransform();
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    if (coversBox(paint, iw, ih, w, h)) {
      // Image paints also apply to outside strokes, which can extend beyond the layer box.
      const corners = [[0,0], [ctx.canvas.width,0], [0,ctx.canvas.height], [ctx.canvas.width,ctx.canvas.height]];
      const xs = corners.map(([x,y]) => inverse.a*x + inverse.c*y + inverse.e);
      const ys = corners.map(([x,y]) => inverse.b*x + inverse.d*y + inverse.f);
      const x0 = Math.min(0, Math.floor(Math.min(...xs))), x1 = Math.max(iw, Math.ceil(Math.max(...xs)));
      const y0 = Math.min(0, Math.floor(Math.min(...ys))), y1 = Math.max(ih, Math.ceil(Math.max(...ys)));
      const columns = [[0,1,x0,-x0], [0,iw,0,iw], [iw-1,1,iw,x1-iw]];
      const rows = [[0,1,y0,-y0], [0,ih,0,ih], [ih-1,1,ih,y1-ih]];
      for (const [sx,sw,x,dw] of columns) for (const [sy,sh,y,dh] of rows) {
        if (dw > 0 && dh > 0) ctx.drawImage(bitmap, sx,sy,sw,sh, x,y,dw,dh);
      }
    } else ctx.drawImage(bitmap, 0, 0);
  } finally { ctx.restore(); }
}

/** One serial decode queue per output canvas. Changes to filters and resources invalidate independently. */
export class CanvasImages {
  #entries = new Map<string, ImageVariant>();
  #resources?: Readonly<Record<string, ImageResource>>;
  #redraw?: () => void;
  readonly #budget: number;
  #profile: ColourProfile = "srgb";
  #bytes = 0;
  #loading?: Promise<void>;
  #ghostWaiting?: Promise<void>;
  #filterKeys = new WeakMap<ImageFilters, string>();

  constructor(byteBudget = PIXEL_BYTES) { this.#budget = byteBudget; }

  begin(resources: Readonly<Record<string, ImageResource>>, redraw: () => void, profile: ColourProfile = "srgb") {
    this.#profile = profile;
    if (resources !== this.#resources) {
      for (const [key, entry] of this.#entries) if (resources[entry.key] !== entry.resource) this.#remove(key, entry);
    }
    this.#resources = resources;
    this.#redraw = redraw;

  }

  paint(ctx: CanvasRenderingContext2D, paint: ImagePaint, width: number, height: number, space?: RegionPaintSpace) {
    return this.#draw(ctx, paint, width, height, space);
  }

  drawGhost(ctx:CanvasRenderingContext2D,paint:ImagePaint,width:number,height:number) {
    const pending = this.#draw(ctx,paint,width,height,undefined,2048);
    if (pending && pending !== this.#ghostWaiting) {
      this.#ghostWaiting = pending;
      void pending.then(() => {
        if (this.#ghostWaiting !== pending) return;
        this.#ghostWaiting = undefined;
        this.#redraw?.();
      });
    }
  }

  #draw(ctx:CanvasRenderingContext2D,paint:ImagePaint,width:number,height:number,space?:RegionPaintSpace,maxSide?:number): void | Promise<void> {
    const resource = this.#resources?.[paint.image];
    if (!resource || !resource.width || !resource.height || resource.width * resource.height * 4 > PIXEL_BYTES) return;
    const w = space?.width ?? width, h = space?.height ?? height;
    if (!w || !h) return;
    const transform = drawableTransform(paint, resource.width, resource.height, w, h);
    if (!transform) return;
    const frame = ctx.getTransform(), long = Math.max(resource.width, resource.height);
    let determinant = (frame.a*frame.d-frame.b*frame.c) * (transform[0]*transform[3]-transform[1]*transform[2]);
    if (space) determinant *= space.transform[0]*space.transform[3]-space.transform[1]*space.transform[2];
    const shown = long * Math.sqrt(Math.abs(determinant));
    const side = maxSide ?? (paint.scale_mode === "tile" ? MAX_SIDE : shown <= 4096 ? 4096 : shown <= 8192 ? 8192 : MAX_SIDE);
    const ratio = Math.min(1, side/long);
    const rw = Math.max(1, Math.round(resource.width*ratio)), rh = Math.max(1, Math.round(resource.height*ratio));
    let filterKey = this.#filterKeys.get(paint.filters);
    if (!filterKey) {
      filterKey = Object.values(paint.filters).join(",");
      this.#filterKeys.set(paint.filters, filterKey);
    }
    const key = JSON.stringify([paint.image, rw, rh, filterKey, this.#profile]);
    const cached = this.#entries.get(key);
    if (cached && cached.resource === resource) {
      if (cached.loading) return this.#loading;
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      if (cached.bitmap) drawPixels(ctx, paint, cached.bitmap, width, height, space, maxSide === undefined);
      return;
    }
    if (this.#loading) return this.#loading;
    const bytes = rw * rh * 4;
    for (const [oldKey, old] of this.#entries) {
      if (this.#entries.size < MAX_CACHED_IMAGES && this.#bytes + bytes <= this.#budget) break;
      this.#remove(oldKey, old);
    }
    const entry: ImageVariant = {key:paint.image, resource, profile:this.#profile, screen:false, filters:paint.filters,
      width:rw, height:rh, bytes, loading:true};
    this.#entries.set(key,entry);
    const current = () => this.#entries.get(key) === entry;
    this.#loading = decodeVariant(entry,current).then(bitmap => {
      if (!current()) { bitmap.close(); return; }
      entry.bitmap = bitmap;
      this.#bytes += entry.bytes;
    }, () => { /* Keep this unreadable variant empty until the resource changes or is evicted. */ }).finally(() => {
      entry.loading = false;
      this.#loading = undefined;
    });
    return this.#loading;
  }

  #remove(key: string, entry: ImageVariant) {
    this.#entries.delete(key);
    if (entry.bitmap) { this.#bytes -= entry.bytes; entry.bitmap.close(); }
  }

  clear() {
    for (const [key, entry] of this.#entries) this.#remove(key, entry);
    this.#resources = undefined;
    this.#ghostWaiting = undefined;
    this.#redraw = undefined;
  }
}
