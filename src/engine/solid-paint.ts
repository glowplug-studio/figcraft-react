import { colour, fromRgba8, toRgba8, withAlpha, type Colour } from "./colour";
import { parseColour } from "./colour-css";

export interface SolidPaint {
  readonly type: "solid";
  readonly color: Colour;
  readonly opacity: number;
  readonly visible: boolean;
  readonly blend: "normal" | "passThrough";
  readonly colorAlpha: number;
}
export function solidPaint(value: Colour): SolidPaint {
  return Object.freeze({ type: "solid", color: withAlpha(value, 1), opacity: value.a, visible: true, blend: "normal", colorAlpha: value.a });
}
/** Native full paint records keep typed colour alpha distinct from independent opacity. */
export function readSolidPaint(value: unknown, command = false): SolidPaint {
  if (command) {
    const color = parseColour(value);
    if (color) return solidPaint(color);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A solid paint object is required");
  const p = value as Record<string, unknown>;
  if (p.type !== "solid") throw new Error("This paint kind is not supported yet");
  if (Object.keys(p).some(key => !["type", "color", "opacity", "visible", "blend", "colorAlpha"].includes(key))) throw new Error("Unsupported solid paint property");
  const color = parseColour(p.color);
  if (!color) throw new Error("Invalid paint colour");
  const opacity = p.opacity ?? 1, colorAlpha = p.colorAlpha ?? 1;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || typeof colorAlpha !== "number" || !Number.isFinite(colorAlpha)) throw new Error("Paint opacity and colour alpha must be finite numbers");
  if (p.visible !== undefined && typeof p.visible !== "boolean") throw new Error("Paint visibility must be boolean");
  if (p.blend !== undefined && p.blend !== "normal" && p.blend !== "passThrough") throw new Error("This paint blend mode is not supported yet");
  const storedOpacity = Math.fround(command ? Math.max(0, Math.min(1, opacity)) : opacity), storedAlpha = Math.fround(colorAlpha);
  if (!Number.isFinite(storedOpacity) || !Number.isFinite(storedAlpha)) throw new Error("Paint opacity and colour alpha exceed the finite native range");
  return Object.freeze({ type: "solid", color, opacity: storedOpacity, visible: p.visible !== false, blend: p.blend ?? "normal", colorAlpha: storedAlpha });
}
export function readSolidPaints(value: unknown, command = false): readonly SolidPaint[] {
  if (!command && !Array.isArray(value)) throw new Error("Native paints must be an array");
  const paints = Array.isArray(value) ? value : [value];
  return Object.freeze(paints.map(paint => readSolidPaint(paint, command)));
}
export function isLegacyPaint(paint: SolidPaint): boolean {
  const bytes = toRgba8(paint.color), canonical = fromRgba8(...bytes);
  return paint.visible && paint.opacity === 1 && paint.colorAlpha === 1 && paint.blend === "normal" && paint.color.a === 1
    && paint.color.r === canonical.r && paint.color.g === canonical.g && paint.color.b === canonical.b;
}
export function paintColour(paint: SolidPaint): Colour {
  return colour(paint.color.r, paint.color.g, paint.color.b, Math.fround(paint.color.a * paint.opacity));
}

export function samePaints(left: readonly SolidPaint[], right: readonly SolidPaint[]): boolean {
  return left.length === right.length && left.every((paint, index) => {
    const other = right[index];
    return paint.type === other.type && paint.opacity === other.opacity && paint.visible === other.visible
      && paint.blend === other.blend && paint.colorAlpha === other.colorAlpha
      && paint.color.r === other.color.r && paint.color.g === other.color.g
      && paint.color.b === other.color.b && paint.color.a === other.color.a;
  });
}
