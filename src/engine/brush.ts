/** Native procedural brush metadata; geometry remains independent of the document model. */
export interface Brush {
  readonly preset: string;
  readonly spacing: number;
  readonly sizeJitter: number;
  readonly rotationJitter: number;
  readonly scatter: number;
  readonly seed: number;
}
export const brushPresets = Object.freeze([
  { id: "taper", label: "Taper", kind: "stretch" }, { id: "ink", label: "Ink", kind: "stretch" },
  { id: "ribbon", label: "Ribbon", kind: "stretch" }, { id: "bristle", label: "Bristle", kind: "stretch" },
  { id: "dots", label: "Dots", kind: "scatter" }, { id: "stars", label: "Stars", kind: "scatter" },
  { id: "confetti", label: "Confetti", kind: "scatter" }, { id: "leaves", label: "Leaves", kind: "scatter" },
] as const);
export const brushPreset = (id: string) => brushPresets.find(p => p.id === id);
export const defaultBrush: Brush = Object.freeze({ preset: "", spacing: 1.5, sizeJitter: 0, rotationJitter: 0, scatter: 0, seed: 0 });
export function sanitiseBrush(brush: Brush): Brush {
  const clamp = (v: number, lo: number, hi: number, fallback: number) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  return Object.freeze({ ...brush, spacing: clamp(brush.spacing, .1, 100, 1.5), sizeJitter: clamp(brush.sizeJitter, 0, 1, 0), rotationJitter: clamp(brush.rotationJitter, 0, 1, 0), scatter: clamp(brush.scatter, 0, 4, 0) });
}
export function brushReachFactor(brush: Brush): number { const b = sanitiseBrush(brush); return 1 + b.sizeJitter + 2 * b.scatter; }
/** Raw serde values, including unknown preset ids, survive native files. */
export function readBrush(value: unknown): Brush | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Brush must be an object");
  const raw = value as Record<string, unknown>;
  const number = (key: string, fallback: number) => {
    const n = raw[key]; if (n === undefined) return fallback;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`Brush ${key} must be a finite number`); return n;
  };
  const preset = raw.preset === undefined ? "" : raw.preset;
  if (typeof preset !== "string") throw new Error("Brush preset must be a string");
  const seed = number("seed", 0); if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Brush seed must be an unsigned32-bit integer");
  return Object.freeze({ preset, spacing: number("spacing", 1.5), sizeJitter: number("size_jitter", 0), rotationJitter: number("rotation_jitter", 0), scatter: number("scatter", 0), seed });
}
export const wireBrush = (brush: Brush): Record<string, unknown> => ({ preset: brush.preset, spacing: brush.spacing, size_jitter: brush.sizeJitter, rotation_jitter: brush.rotationJitter, scatter: brush.scatter, seed: brush.seed });
/** Native brush_of uses serde after sorted camel-to-snake key conversion, not numeric coercion. */
export function parseBrush(value: unknown): Brush | undefined {
  if (value === null) return undefined;
  let raw: unknown = value;
  if (typeof value === "string") raw = { preset: value };
  else if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>, snake: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) snake[key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)] = object[key];
    raw = snake;
  }
  const brush = readBrush(raw);
  if (!brush || !brushPreset(brush.preset)) throw new Error("Unknown brush preset");
  return sanitiseBrush(brush);
}
