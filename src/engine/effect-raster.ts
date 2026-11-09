import type { Colour } from "./colour";

/** Premultiplied byte planes used by shadows and layer/backdrop filters.
 * A one-channel plane holds coverage. RGBA planes have four interleaved channels. */
function boxRadii(sigma: number): readonly number[] {
  const variance = 4 * sigma * sigma;
  let lower = Math.floor(Math.sqrt(variance + 1));
  if (lower % 2 === 0) lower--;
  const count = Math.round((3 * variance - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return [0, 1, 2].map(i => (lower - 1) / 2 + (i < count ? 0 : 1));
}

/** The divisor includes transparent pixels beyond each end. Native box passes
 * truncate to bytes between passes, even when a later pass uses the same radius. */
function boxPass(input: Uint8Array, out: Uint8Array, lines: number, length: number,
  lineStride: number, stride: number, channels: number, radius: number) {
  const divisor = 2 * radius + 1;
  for (let line = 0; line < lines; line++) {
    for (let channel = 0; channel < channels; channel++) {
      const base = line * lineStride + channel;
      let sum = 0;
      for (let i = 0; i < Math.min(length, radius + 1); i++) sum += input[base + i * stride];
      for (let i = 0, at = base; i < length; i++, at += stride) {
        out[at] = Math.floor(sum / divisor);
        if (i + radius + 1 < length) sum += input[at + (radius + 1) * stride];
        if (i >= radius) sum -= input[at - radius * stride];
      }
    }
  }
}

/** Three horizontal box passes, then three vertical passes, in O(width × height)
 * at every radius. Only one scratch buffer is live. */
export function blurPixels(pixels: Uint8Array, width: number, height: number, channels: 1 | 4, sigma: number) {
  if (!Number.isFinite(sigma) || sigma <= .3 || !width || !height) return;
  const radii = boxRadii(Math.min(1e6, sigma)).filter(r => r > 0);
  if (!radii.length) return;
  // If even the first non-identity box cannot produce a nonzero byte on a row,
  // the remaining passes operate on transparent black.
  if (2 * radii[0] + 1 > width * 255) { pixels.fill(0); return; }
  let input: Uint8Array = pixels, target: Uint8Array = new Uint8Array(pixels.length);
  const rowStride = width * channels;
  for (const vertical of [false, true]) {
    for (const radius of radii) {
      if (vertical) boxPass(input, target, width, height, channels, rowStride, channels, radius);
      else boxPass(input, target, height, width, rowStride, channels, channels, radius);
      [input, target] = [target, input];
    }
  }
}

/** Grow or shrink coverage in a square neighbourhood. A monotonic deque retains
 * only candidates still inside the sliding window. Outside the image is empty. */
export function spreadPixels(alpha: Uint8Array, width: number, height: number, spread: number) {
  const radius = Math.min(400, Math.abs(spread));
  if (!radius || !width || !height) return;
  const grow = spread > 0;
  const scratch = new Uint8Array(alpha.length), deque = new Int32Array(Math.max(width, height));
  function pass(input: Uint8Array, output: Uint8Array, lines: number, length: number, lineStride: number, stride: number) {
    for (let line = 0; line < lines; line++) {
      const base = line * lineStride;
      let head = 0, tail = 0, right = 0;
      for (let x = 0; x < length; x++) {
        while (head < tail && deque[head] < x - radius) head++;
        while (right < length && right <= x + radius) {
          const next = input[base + right * stride];
          while (head < tail) {
            const last = input[base + deque[tail - 1] * stride];
            if (grow ? last > next : last < next) break;
            tail--;
          }
          deque[tail++] = right++;
        }
        const outside = !grow && (x < radius || x + radius >= length);
        output[base + x * stride] = outside ? 0 : input[base + deque[head] * stride];
      }
    }
  }
  pass(alpha, scratch, height, width, width, 1);
  pass(scratch, alpha, width, height, 1, width);
}

/** Native shadow::whole_px rounds halves away from zero. */
function wholePixel(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.sign(value) * Math.min(100000, Math.round(Math.abs(value)));
}

interface RasterShadow {
  readonly offset: readonly [number, number];
  readonly spread: number;
  readonly radius: number;
  readonly showBehind: boolean;
  readonly color: Colour;
}

function tintChannel(channel: number, alpha: number, mask: number) {
  const tinted = Math.round(Math.fround(Math.fround(channel * alpha) * 255));
  return Math.floor((tinted * mask + 127) / 255);
}

/** Premultiplied native bytes of a drop shadow cast by pixels. The optional covered area hides
 * shadows beneath translucent geometry. Groups and transparent images use the
 * source alpha for both casting and hiding. The caller composites with the shadow blend. */
export function dropShadowPixels(source: Uint8Array, width: number, height: number, shadow: RasterShadow,
  scale: number, cover = source, spreadOutline?: Uint8Array) {
  const dx = wholePixel(shadow.offset[0] * scale), dy = wholePixel(shadow.offset[1] * scale);
  // The geometry path has already applied both spread and the precise fractional offset.
  const out = spreadOutline ?? new Uint8Array(source.length);
  if (!spreadOutline) {
    const spread = wholePixel(shadow.spread * scale);
    const base = spread ? source.slice() : source;
    if (spread) spreadPixels(base, width, height, spread);
    const first = Math.max(0, -dx), end = Math.min(width, width - dx);
    if (end > first) for (let y = Math.max(0,-dy); y < Math.min(height,height-dy); y++) {
      const start = y * width;
      out.set(base.subarray(start + first, start + end), (y + dy) * width + first + dx);
    }
  }
  blurPixels(out, width, height, 1, shadow.radius / 2 * scale);
  const result = new Uint8Array(out.length * 4), color = shadow.color;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    const alpha = Math.fround(Math.fround(out[i] / 255) * color.a);
    const mask = shadow.showBehind ? 255 : 255 - cover[i];
    const at = i * 4;
    result[at] = tintChannel(color.r, alpha, mask); result[at + 1] = tintChannel(color.g, alpha, mask);
    result[at + 2] = tintChannel(color.b, alpha, mask); result[at + 3] = tintChannel(1, alpha, mask);
  }
  return result;
}

/** Padded outside coverage casts an inner shadow inwards, including from beyond
 * the layer rectangle. A prepared outline includes the fractional offset and
 * inverse spread. The pixel path uses whole-device-pixel placement. */
export function innerShadowPadding(shadow: RasterShadow, scale: number, outlined: boolean) {
  const reach = (Math.abs(shadow.radius) * 1.5 + Math.abs(shadow.spread) * (outlined ? 4 : 1)
    + Math.max(Math.abs(shadow.offset[0]), Math.abs(shadow.offset[1]))) * scale;
  return Number.isFinite(reach) ? Math.max(0, Math.min(2048, Math.ceil(reach))) + 2 : 2;
}

export function innerShadowPixels(cover: Uint8Array, width: number, height: number, shadow: RasterShadow, scale: number,
  paddedOutline?: Uint8Array) {
  const pad = innerShadowPadding(shadow, scale, !!paddedOutline);
  const w = width + 2 * pad, h = height + 2 * pad;
  const outside = paddedOutline ?? new Uint8Array(w * h);
  if (!paddedOutline) {
    const dx = pad + wholePixel(shadow.offset[0] * scale), dy = pad + wholePixel(shadow.offset[1] * scale);
    const first = Math.max(0,-dx), end = Math.min(width,w-dx);
    if (first < end) for (let y = Math.max(0,-dy); y < Math.min(height,h-dy); y++) {
      outside.set(cover.subarray(y * width + first, y * width + end), (y + dy) * w + first + dx);
    }
    spreadPixels(outside, w, h, -wholePixel(shadow.spread * scale));
  }
  for (let i = 0; i < outside.length; i++) outside[i] = 255 - outside[i];
  blurPixels(outside, w, h, 1, shadow.radius / 2 * scale);
  const result = new Uint8Array(width * height * 4), color = shadow.color;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const byte = Math.floor((outside[(y + pad) * w + x + pad] * cover[i] + 127) / 255);
    if (!byte) continue;
    const alpha = Math.fround(Math.fround(byte / 255) * color.a);
    result[4*i] = tintChannel(color.r, alpha, 255); result[4*i+1] = tintChannel(color.g, alpha, 255);
    result[4*i+2] = tintChannel(color.b, alpha, 255); result[4*i+3] = tintChannel(1, alpha, 255);
  }
  return result;
}
