import { colour, fromRgba8, toRgba8, withAlpha, type Colour } from "./colour";
import { readGradient, type Gradient } from "./gradient";
import { parseColour } from "./colour-css";

interface PaintProperties {
  readonly opacity: number;
  readonly visible: boolean;
  readonly blend: "normal" | "passThrough";
  readonly colorAlpha: number;
}
export interface SolidPaint extends PaintProperties { readonly type: "solid"; readonly color: Colour }
export interface GradientPaint extends PaintProperties, Gradient { readonly type: "gradient" }
export type Paint = SolidPaint | GradientPaint;

export function solidPaint(value: Colour): SolidPaint {
  return Object.freeze({ type: "solid", color: withAlpha(value, 1), opacity: value.a, visible: true, blend: "normal", colorAlpha: value.a });
}
/** Native full paint records keep typed colour alpha distinct from independent opacity. */
export function readPaint(value: unknown, command = false): Paint {
  if (command) {
    const color = parseColour(value);
    if (color) return solidPaint(color);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A paint object is required");
  const p = value as Record<string, unknown>;
  const opacity = p.opacity ?? 1, colorAlpha = p.colorAlpha ?? 1;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || typeof colorAlpha !== "number" || !Number.isFinite(colorAlpha)) throw new Error("Paint opacity and colour alpha must be finite numbers");
  if (p.visible !== undefined && typeof p.visible !== "boolean") throw new Error("Paint visibility must be boolean");
  if (p.blend !== undefined && p.blend !== "normal" && p.blend !== "passThrough") throw new Error("This paint blend mode is not supported yet");
  const storedOpacity = Math.fround(command ? Math.max(0, Math.min(1, opacity)) : opacity), storedAlpha = Math.fround(colorAlpha);
  if (!Number.isFinite(storedOpacity) || !Number.isFinite(storedAlpha)) throw new Error("Paint opacity and colour alpha exceed the finite native range");
  const properties: PaintProperties = { opacity: storedOpacity, visible: p.visible !== false, blend: p.blend ?? "normal", colorAlpha: storedAlpha };
  if (p.type === "solid") {
    if (Object.keys(p).some(key => !["type","color","opacity","visible","blend","colorAlpha"].includes(key))) throw new Error("Unsupported solid paint property");
    const color = parseColour(p.color);
    if (!color) throw new Error("Invalid paint colour");
    return Object.freeze({ type: "solid", color, ...properties });
  }
  if (typeof p.type !== "string" || !p.type.toLowerCase().endsWith("gradient")) throw new Error("This paint kind is not supported yet");
  if (Object.keys(p).some(key => !["type","kind","stops","from","to","width","opacity","visible","blend","colorAlpha"].includes(key))) throw new Error("Unsupported gradient paint property");
  return Object.freeze({ type:"gradient", ...readGradient(p,command), ...properties });
}

export function readPaints(value: unknown, command = false): readonly Paint[] {
  if (!command && !Array.isArray(value)) throw new Error("Native paints must be an array");
  return Object.freeze((Array.isArray(value) ? value : [value]).map(paint => readPaint(paint, command)));
}

export function readSolidPaint(value: unknown, command = false): SolidPaint {
  const paint = readPaint(value, command);
  if (paint.type !== "solid") throw new Error("A solid paint is required");
  return paint;
}

export function readSolidPaints(value: unknown, command = false): readonly SolidPaint[] {
  if (!command && !Array.isArray(value)) throw new Error("Native paints must be an array");
  return Object.freeze((Array.isArray(value) ? value : [value]).map(paint => readSolidPaint(paint, command)));
}

export function isLegacyPaint(paint: Paint): boolean {
  if (paint.type !== "solid") return false;
  const bytes = toRgba8(paint.color), canonical = fromRgba8(...bytes);
  return paint.visible && paint.opacity === 1 && paint.colorAlpha === 1 && paint.blend === "normal" && paint.color.a === 1
    && paint.color.r === canonical.r && paint.color.g === canonical.g && paint.color.b === canonical.b;
}
export function paintColour(paint: SolidPaint): Colour {
  return colour(paint.color.r, paint.color.g, paint.color.b, Math.fround(paint.color.a * paint.opacity));
}

const sameColour = (a: Colour, b: Colour) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
export function samePaints(left: readonly Paint[], right: readonly Paint[]): boolean {
  return left.length === right.length && left.every((a, i) => {
    const b = right[i];
    if (a === b) return true;
    if (a.opacity !== b.opacity || a.visible !== b.visible || a.blend !== b.blend || a.colorAlpha !== b.colorAlpha) return false;
    if (a.type === "solid") return b.type === "solid" && sameColour(a.color,b.color);
    return b.type === "gradient" && a.kind === b.kind
      && (["from","to","width"] as const).every(key => a[key][0] === b[key][0] && a[key][1] === b[key][1])
      && a.stops.length === b.stops.length && a.stops.every((s,j) => s.position === b.stops[j].position && sameColour(s.color,b.stops[j].color));
  });
}
