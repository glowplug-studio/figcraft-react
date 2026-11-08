import { decodeImageBitmap } from "./image-decode";
import { adjustImagePixels, type ImageFilters } from "./image-filters";
import { cropRect, imageTransform, placementCrop } from "./image-placement";
import type { ImageResource } from "./image-resource";
import type { ImagePaint } from "./solid-paint";
import type { RegionPaintSpace } from "./vector-network";

const MAX_SIDE = 16_384;
const PIXEL_BYTES = 512 * 1024 * 1024;
const MAX_CACHED_IMAGES = 256;

interface ImageVariant {
  key: string;
  resource: ImageResource;
  filters: ImageFilters;
  width: number;
  height: number;
  bytes: number;
  frame: number;
  state: "queued" | "loading" | "ready" | "failed";
  bitmap?: ImageBitmap;
}

async function decodeVariant(entry: ImageVariant, current: () => boolean): Promise<ImageBitmap> {
  const { resource, width, height, filters } = entry;
  const source = await decodeImageBitmap(resource, width, height);
  if (Object.values(filters).every(value => value === 0)) return source;
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
      adjustImagePixels(pixels.data, filters);
      context.putImageData(pixels, 0, y);
    }
    return surface.transferToImageBitmap();
  } finally { source.close(); }
}

export type DrawImagePaint = (context: CanvasRenderingContext2D, paint: ImagePaint, width: number, height: number, space?: RegionPaintSpace) => void;

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
function drawPixels(ctx: CanvasRenderingContext2D, paint: ImagePaint, bitmap: ImageBitmap, width: number, height: number, space?: RegionPaintSpace) {
  const iw = bitmap.width, ih = bitmap.height, w = space?.width ?? width, h = space?.height ?? height;
  const transform = drawableTransform(paint, iw, ih, w, h);
  if (!transform) return;
  ctx.save();
  try {
    if (space) ctx.transform(...space.transform);
    ctx.transform(...transform);
    const frame = ctx.getTransform(), inverse = frame.inverse();
    if (!Number.isFinite(inverse.a)) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
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
  #frame = 0;
  #bytes = 0;
  #loading = false;
  #filterKeys = new WeakMap<ImageFilters, string>();

  begin(resources: Readonly<Record<string, ImageResource>>, redraw: () => void) {
    if (resources !== this.#resources) {
      for (const [key, entry] of this.#entries) if (resources[entry.key] !== entry.resource) this.#remove(key, entry);
    }
    this.#resources = resources;
    this.#redraw = redraw;
    this.#frame++;
  }

  draw: DrawImagePaint = (ctx, paint, width, height, space) => this.#draw(ctx,paint,width,height,space);
  drawGhost(ctx:CanvasRenderingContext2D,paint:ImagePaint,width:number,height:number) {
    this.#draw(ctx,paint,width,height,undefined,2048);
  }
  #draw(ctx:CanvasRenderingContext2D,paint:ImagePaint,width:number,height:number,space?:RegionPaintSpace,maxSide?:number) {
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
    const key = JSON.stringify([paint.image, rw, rh, filterKey]);
    let entry = this.#entries.get(key);
    if (entry && entry.resource !== resource) { this.#remove(key, entry); entry = undefined; }
    if (!entry) {
      entry = { key: paint.image, resource, filters: paint.filters, width: rw, height: rh, bytes: rw*rh*4, frame: this.#frame, state: "queued" };
      this.#entries.set(key, entry);
    }
    entry.frame = this.#frame;
    if (entry.bitmap) drawPixels(ctx, paint, entry.bitmap, width, height, space);
  }

  #remove(key: string, entry: ImageVariant) {
    this.#entries.delete(key);
    if (entry.bitmap) { this.#bytes -= entry.bytes; entry.bitmap.close(); }
  }

  end() {
    for (const [key, entry] of this.#entries) {
      if (entry.frame !== this.#frame && entry.state !== "ready") this.#remove(key, entry);
    }
    if (!this.#loading) void this.#load();
  }

  async #load() {
    this.#loading = true;
    try {
      for (const [key, entry] of this.#entries) {
        if (entry.state !== "queued" || entry.frame !== this.#frame) continue;
        for (const [oldKey, old] of this.#entries) {
          if (this.#bytes + entry.bytes <= PIXEL_BYTES && this.#entries.size <= MAX_CACHED_IMAGES) break;
          if (old.state === "ready" && old.frame !== this.#frame) this.#remove(oldKey, old);
        }
        if (this.#bytes + entry.bytes > PIXEL_BYTES) continue;
        entry.state = "loading";
        try {
          const bitmap = await decodeVariant(entry, () => this.#entries.get(key) === entry);
          if (this.#entries.get(key) !== entry) { bitmap.close(); continue; }
          entry.bitmap = bitmap;
          entry.state = "ready";
          this.#bytes += entry.bytes;
          this.#redraw?.();
        } catch { entry.state = "failed"; }
      }
    } finally { this.#loading = false; }
  }

  clear() {
    for (const [key, entry] of this.#entries) this.#remove(key, entry);
    this.#resources = undefined;
    this.#redraw = undefined;
  }
}
