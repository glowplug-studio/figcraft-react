import { withAlpha } from "./colour";
import { parseColour } from "./colour-css";
import { parseBoolean, parseIndex, parseNumber, parseString } from "./parameters";
import { readSolidPaint, type SolidPaint } from "./solid-paint";

const unsupportedBlends = new Set(["darken", "multiply", "plusdarker", "colorburn", "lighten", "screen", "pluslighter", "colordodge", "overlay", "softlight", "hardlight", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
function blend(value: unknown): SolidPaint["blend"] | undefined {
  const key = parseString(value)?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (key === "normal") return "normal"; if (key === "passthrough") return "passThrough";
  if (key && unsupportedBlends.has(key)) throw new Error("This paint blend mode is not supported yet");
  return undefined;
}
/** Parse once per command. Every target receives the edit on its own effective stack. */
export function paintStackEdit(action: "add" | "set" | "move" | "remove", params: Record<string, unknown>) {
  if (action === "move") {
    const from = parseIndex(params.from, "from"), to = parseIndex(params.to, "to");
    return (stack: readonly SolidPaint[]) => {
      if (from >= stack.length || to >= stack.length || from === to) return stack;
      const next = [...stack], [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    };
  }
  if (action === "add") {
    const supplied = params.paint ?? params.color;
    const paint = supplied == null ? undefined : readSolidPaint(supplied, true);
    return (stack: readonly SolidPaint[], fallback: SolidPaint) => [...stack, paint ?? fallback];
  }
  const index = params.index == null ? undefined : parseIndex(params.index);
  if (action === "remove") return (stack: readonly SolidPaint[]) => {
    const at = index ?? stack.length - 1;
    return at < 0 || at >= stack.length ? stack : stack.filter((_, i) => i !== at);
  };
  const replacement = params.paint == null ? undefined : readSolidPaint(params.paint, true);
  const color = parseColour(params.color), visible = parseBoolean(params.visible), mode = blend(params.blend);
  let opacity: number | undefined;
  if (params.opacity != null) {
    try {
      const value = parseNumber(params.opacity);
      const percent = typeof params.opacity === "string" && params.opacity.trim().endsWith("%");
      opacity = Math.fround(Math.max(0, Math.min(1, percent || value > 1 ? value / 100 : value)));
    } catch { /* Native optional invalid opacity is ignored. */ }
  }
  return (stack: readonly SolidPaint[], fallback: SolidPaint) => {
    const list = stack.length ? [...stack] : [fallback], at = index ?? list.length - 1;
    if (!list[at]) throw new Error(`No paint at index ${at}`);
    let slot = replacement ?? list[at];
    if (color) slot = { ...slot, color: withAlpha(color, 1), ...(color.a < 1 ? { opacity: color.a, colorAlpha: color.a } : {}) };
    if (opacity !== undefined) slot = { ...slot, opacity, colorAlpha: 1 };
    if (visible !== undefined) slot = { ...slot, visible };
    if (mode !== undefined) slot = { ...slot, blend: mode };
    list[at] = Object.freeze(slot);
    return list;
  };
}
