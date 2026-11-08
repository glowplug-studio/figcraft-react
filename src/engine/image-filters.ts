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
