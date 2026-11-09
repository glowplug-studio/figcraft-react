import { isBlendMode } from "./blend";
import { colour } from "./colour";
import { parseColour } from "./colour-css";

export const effectTypes = ["dropShadow", "innerShadow", "layerBlur", "backgroundBlur", "noise", "texture", "glass"] as const;
type EffectInput = "archive" | "command" | "properties";
const black = colour(0, 0, 0, .25), white = colour(1, 1, 1, .25);
const snake = (name: string) => name.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase());

function invalid(field: string): never { throw new Error("Invalid effect " + field); }
function finite(value: unknown, field: string): number {
  return typeof value === "number" && Number.isFinite(value) ? value : invalid(field);
}

/** Native EffectKind serde flattens each variant into the tagged object.
 * Commands additionally refuse non-null keys ignored by the selected variant. */
export function readEffect(value: unknown, input: EffectInput) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("record");
  const fields = new Map<string, unknown>();
  for (const [key, entry] of Object.entries(value)) {
    if (input !== "archive" && fields.size >= 32) throw new Error("Effect has more than 32 properties");
    const name = input === "properties" ? snake(key) : key;
    if (fields.has(name)) throw new Error("Duplicate effect property " + name);
    fields.set(name, entry);
  }
  function take(name: string, fallback: unknown, alias = name): unknown {
    if (name !== alias && fields.has(name) && fields.has(alias)) throw new Error("Duplicate effect property " + name);
    const key = fields.has(name) ? name : alias;
    if (!fields.has(key)) return fallback;
    const entry = fields.get(key);
    fields.delete(key);
    return entry;
  }
  const num = (key: string, def: number) => finite(take(snake(key), def, key), key);
  function flag(key: string, def: boolean) {
    const entry = take(snake(key), def, key);
    return typeof entry === "boolean" ? entry : invalid(key);
  }
  function pair(key: string, x: number, y: number, alias = key) {
    const entry = take(key, [x, y], alias);
    if (!Array.isArray(entry) || entry.length !== 2) return invalid(key);
    return Object.freeze([finite(entry[0], key), finite(entry[1], key)] as const);
  }
  function blendMode() {
    const entry = take("blend", "normal");
    return isBlendMode(entry) ? entry : invalid("blend");
  }
  function grainSize() {
    const size = num("size", .5), sizeY = take("size_y", null, "sizeY");
    return sizeY === null ? { size } : { size, sizeY: finite(sizeY, "sizeY") };
  }
  function finish<T extends object>(record: T): Readonly<T> {
    if (input !== "archive") {
      const unknown = [...fields].filter(([, entry]) => entry !== null).map(([key]) => key);
      if (unknown.length) throw new Error("Unknown effect properties: " + unknown.join(", "));
    }
    return Object.freeze(record);
  }
  const type = take("type", undefined), visible = flag("visible", true);
  switch (type) {
    case "dropShadow": case "innerShadow":
      return finish({ type, visible, color: parseColour(take("color", black)) ?? invalid("color"),
        offset: pair("offset", 0, 4), radius: num("radius", 4), spread: num("spread", 0),
        blend: blendMode(), showBehind: flag("showBehind", false) } as const);
    case "layerBlur": case "backgroundBlur": {
      const entry = take("blur_type", "uniform", "blurType");
      const blurType = entry === "progressive" || entry === "PROGRESSIVE" ? "progressive"
        : ["uniform", "normal", "NORMAL", "UNIFORM"].some(mode => entry === mode) ? "uniform" : invalid("blurType");
      return finish({ type, visible, blurType, radius: num("radius", 4), startRadius: num("startRadius", 0),
        start: pair("start", .5, 0, "startOffset"), end: pair("end", .5, 1, "endOffset") } as const);
    }
    case "noise": {
      const mode = take("mode", "mono");
      if (mode !== "mono" && mode !== "duo" && mode !== "multi") return invalid("mode");
      return finish({ type, visible, mode, ...grainSize(), density: num("density", .5),
        color: parseColour(take("color", black)) ?? invalid("color"),
        secondary: parseColour(take("secondary", white)) ?? invalid("secondary"),
        opacity: finite(Math.fround(num("opacity", .25)), "opacity"), blend: blendMode() } as const);
    }
    case "texture":
      return finish({ type, visible, ...grainSize(), radius: num("radius", 4), clipToShape: flag("clipToShape", false) } as const);
    case "glass":
      return finish({ type, visible, lightAngle: num("lightAngle", -45), lightIntensity: num("lightIntensity", .8),
        refraction: num("refraction", .8), depth: num("depth", 20), dispersion: num("dispersion", .5),
        frost: num("frost", 4), splay: num("splay", 0) } as const);
    default: return invalid("type");
  }
}

export type Effect = ReturnType<typeof readEffect>;
export function readEffects(value: unknown, input: EffectInput): readonly Effect[] {
  if (!Array.isArray(value)) throw new Error("Effects must be an array");
  return Object.freeze(value.map(effect => readEffect(effect, input)));
}
export function wireEffect(effect: Effect) {
  return Object.fromEntries(Object.entries(effect).map(([key, value]) => [snake(key), value]));
}
export function withEffects<T extends { readonly effects?: readonly Effect[] }>(node: T, effects: readonly Effect[]): T {
  const before = node.effects ?? [];
  if (before === effects || before.length === effects.length && before.every((effect, i) =>
    effect === effects[i] || JSON.stringify(effect) === JSON.stringify(effects[i]))) return node;
  const { effects: previous, ...rest } = node;
  return Object.freeze({ ...rest, ...(effects.length && { effects }) }) as T;
}

/** Native Scale tool changes document lengths, including hidden effects. */
export function scaleEffect(effect: Effect, factor: number): Effect {
  const scale = (value: number) => finite(value * factor, "scaled length");
  switch (effect.type) {
    case "dropShadow": case "innerShadow":
      return Object.freeze({ ...effect, offset: Object.freeze([scale(effect.offset[0]), scale(effect.offset[1])] as const),
        radius: scale(effect.radius), spread: scale(effect.spread) });
    case "layerBlur": case "backgroundBlur":
      return Object.freeze({ ...effect, radius: scale(effect.radius), startRadius: scale(effect.startRadius) });
    case "texture": case "noise":
      return Object.freeze({ ...effect, size: scale(effect.size), ...(effect.sizeY !== undefined && { sizeY: scale(effect.sizeY) }),
        ...(effect.type === "texture" && { radius: scale(effect.radius) }) });
    case "glass":
      return Object.freeze({ ...effect, depth: scale(effect.depth), frost: Math.min(100, Math.max(0, Math.min(100, effect.frost)) * factor) });
  }
}
