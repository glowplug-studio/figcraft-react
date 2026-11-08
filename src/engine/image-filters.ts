const channels = ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"] as const;
export type ImageFilters = Readonly<Record<typeof channels[number], number>>;
export interface ImagePreset { readonly name: string; readonly filters: ImageFilters }

const zero: ImageFilters = Object.freeze({ exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0 });

/** Native file values are f32. Only command edits clamp adjustments into the advertised slider range. */
export function readImageFilters(value: unknown): ImageFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("image filters must be an object");
  const filters = { ...zero };
  for (const [key, raw] of Object.entries(value)) {
    if (!Object.hasOwn(zero, key)) throw new Error(`unknown image adjustment: ${key}`);
    if (typeof raw !== "number" || !Number.isFinite(Math.fround(raw))) throw new Error(`image adjustment ${key} must be a finite number`);
    filters[key as keyof ImageFilters] = Math.fround(raw);
  }
  return Object.freeze(filters);
}

function builtIn(id: string, label: string, filters: Partial<ImageFilters>) {
  return Object.freeze({ id, label, filters: readImageFilters(filters) });
}

export const imageFilterPresets = Object.freeze([
  builtIn("vivid", "Vivid", { contrast: 0.2, saturation: 0.45, highlights: -0.1, shadows: 0.1 }),
  builtIn("muted", "Muted", { contrast: -0.15, saturation: -0.45 }),
  builtIn("warm", "Warm", { temperature: 0.5, tint: 0.1, saturation: 0.1 }),
  builtIn("cool", "Cool", { temperature: -0.5, tint: -0.05 }),
  builtIn("blackAndWhite", "Black & white", { saturation: -1, contrast: 0.15 }),
  builtIn("fade", "Fade", { contrast: -0.35, saturation: -0.2, shadows: 0.35, highlights: -0.1 }),
  builtIn("reset", "Reset", {}),
]);

export function listImagePresets(saved: readonly ImagePreset[] = []) {
  return { builtIn: imageFilterPresets, saved };
}

/** Apply native adjustments to straight-alpha Canvas pixels, retaining the alpha byte. */
export function adjustImagePixels(pixels: Uint8ClampedArray, filters: ImageFilters): void {
  if (channels.every(key => filters[key] === 0)) return;
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const exposure = 2 ** (2 * clamp(filters.exposure)), contrast = 1 + clamp(filters.contrast);
  const saturation = 1 + clamp(filters.saturation);
  const temperature = .15 * clamp(filters.temperature), tint = .15 * clamp(filters.tint);
  const highlights = .3 * clamp(filters.highlights), shadows = .3 * clamp(filters.shadows);
  const input = (byte: number, alpha: number) => (Math.round(byte * alpha / 255) / alpha * exposure - .5) * contrast + .5;
  const output = (v: number, adjustment: number, alpha: number) => Math.round(Math.max(0, Math.min(1, v+adjustment)) * alpha) * 255 / alpha;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i+3];
    if (!alpha) continue;
    // tiny-skia stores premultiplied bytes before the filter reads its input.
    let r = input(pixels[i], alpha), g = input(pixels[i+1], alpha), b = input(pixels[i+2], alpha);
    const grey = .2126*r + .7152*g + .0722*b;
    r = grey + (r-grey)*saturation + temperature;
    g = grey + (g-grey)*saturation + tint;
    b = grey + (b-grey)*saturation - temperature;
    const luminance = Math.max(0, Math.min(1, .2126*r + .7152*g + .0722*b));
    const adjustment = highlights*luminance*luminance + shadows*(1-luminance)*(1-luminance);
    pixels[i] = output(r, adjustment, alpha); pixels[i+1] = output(g, adjustment, alpha); pixels[i+2] = output(b, adjustment, alpha);
  }
}
