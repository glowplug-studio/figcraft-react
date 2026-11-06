import { colour, fromRgba8, withAlpha, type Colour } from "./colour";
import { hslToColour, lchToColour, oklchToColour } from "./colour-spaces";
import { lookupNamedColour } from "./colour-names";

/** Native Color::from_hex accepts exactly these six digit counts, with one optional hash. */
export function parseHexColour(text: string): Colour | undefined {
  const hex = text.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-fA-F]{1}|[0-9a-fA-F]{2}|[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) return undefined;
  const nibble = (index: number) => parseInt(hex[index], 16);
  const pair = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  switch (hex.length) {
    case 1: { const channel = nibble(0) * 17; return fromRgba8(channel, channel, channel); }
    case 2: { const channel = pair(0); return fromRgba8(channel, channel, channel); }
    case 3: return fromRgba8(nibble(0) * 17, nibble(1) * 17, nibble(2) * 17);
    case 4: return fromRgba8(nibble(0) * 17, nibble(1) * 17, nibble(2) * 17, nibble(3) * 17);
    case 6: return fromRgba8(pair(0), pair(2), pair(4));
    case 8: return fromRgba8(pair(0), pair(2), pair(4), pair(6));
  }
}

/** Rust f32 parsing, including finite overflow to infinity before colour clamping. */
function parseF32(text: string): number | undefined {
  if (/^[+-]?(?:inf|infinity)$/i.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(text)) return NaN;
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(text)) return undefined;
  return Math.fround(Number(text));
}

/** Mirrors css_args: commas and slashes separate nonempty whitespace-delimited groups. */
function cssArgs(inner: string): string[] | undefined {
  const result: string[] = [];
  for (const segment of inner.replaceAll("/", ",").split(",")) {
    const parts = segment.trim().split(/\s+/u).filter(Boolean);
    if (parts.length === 0) return undefined;
    result.push(...parts);
  }
  return result;
}

function alpha(text: string): number | undefined {
  const percent = text.endsWith("%");
  const value = parseF32(percent ? text.slice(0, -1) : text);
  if (value === undefined) return undefined;
  const result = percent ? Math.fround(value / 100) : value;
  return Number.isFinite(result) ? result : undefined;
}

function polarNumber(text: string, full: number): number | undefined {
  if (text === "none") return 0;
  const percent = text.endsWith("%");
  const value = parseF32(percent ? text.slice(0, -1).trim() : text);
  if (value === undefined) return undefined;
  const result = percent ? Math.fround(Math.fround(value / 100) * full) : value;
  return Number.isFinite(result) ? result : undefined;
}

function polarHue(text: string): number | undefined {
  if (text === "none") return 0;
  const unit = (["grad", "turn", "rad", "deg"] as const).find(candidate => text.endsWith(candidate));
  const value = parseF32(unit ? text.slice(0, -unit.length) : text);
  if (value === undefined) return undefined;
  const divisor = unit === "grad" ? Math.fround(400 / 360)
    : unit === "turn" ? Math.fround(1 / 360)
      : unit === "rad" ? Math.fround(Math.fround(Math.PI) / 180) : 1;
  const result = Math.fround(value / divisor);
  return Number.isFinite(result) ? result : undefined;
}

function polar(inner: string, lFull: number, cFull: number): { l: number; c: number; h: number; a: number } | undefined {
  const parts = cssArgs(inner);
  if (!parts || parts.length < 3 || parts.length > 4) return undefined;
  const l = polarNumber(parts[0], lFull);
  const c = polarNumber(parts[1], cFull);
  const h = polarHue(parts[2]);
  const a = parts[3] === undefined || parts[3] === "none" ? 1 : alpha(parts[3]);
  if (l === undefined || c === undefined || h === undefined || a === undefined) return undefined;
  return { l, c, h, a };
}

function hexOrName(text: string): Colour | undefined {
  const hex = parseHexColour(text);
  if (hex) return hex;
  const rgb = lookupNamedColour(text);
  return rgb ? fromRgba8(...rgb) : undefined;
}

/** Port of Color::parse_css; numeric intermediates use f32 at Rust arithmetic boundaries. */
export function parseCssColour(text: string): Colour | undefined {
  const value = text.trim().toLowerCase();
  if (value.startsWith("#")) return parseHexColour(value);
  const functionMatch = /^(rgba?|hsla?|oklch|lch)\((.*)\)$/s.exec(value);
  if (functionMatch) {
    const [, kind, inner] = functionMatch;
    if (kind === "rgb" || kind === "rgba") {
      const parts = cssArgs(inner);
      if (!parts || parts.length < 3 || parts.length > 4) return undefined;
      const channel = (part: string): number | undefined => {
        const percent = part.endsWith("%");
        const parsed = parseF32(percent ? part.slice(0, -1).trim() : part);
        return parsed === undefined ? undefined : Math.fround(parsed / (percent ? 100 : 255));
      };
      const channels = parts.slice(0, 3).map(channel);
      const a = parts[3] === undefined ? 1 : alpha(parts[3]);
      if (channels.some(part => part === undefined) || a === undefined) return undefined;
      return colour(channels[0]!, channels[1]!, channels[2]!, a);
    }
    if (kind === "hsl" || kind === "hsla") {
      const parts = cssArgs(inner);
      if (!parts || parts.length < 3 || parts.length > 4) return undefined;
      const h = parseF32(parts[0].replace(/(?:deg)+$/u, ""));
      const sValue = parseF32(parts[1].replace(/%+$/u, ""));
      const lValue = parseF32(parts[2].replace(/%+$/u, ""));
      const a = parts[3] === undefined ? 1 : alpha(parts[3]);
      if (h === undefined || sValue === undefined || lValue === undefined || a === undefined) return undefined;
      const s = Math.fround(sValue / 100), l = Math.fround(lValue / 100);
      if (![h, s, l].every(Number.isFinite)) return undefined;
      return withAlpha(hslToColour({ h, s, l }), a);
    }
    const args = polar(inner, kind === "lch" ? 100 : 1, kind === "lch" ? 150 : 0.4);
    if (!args) return undefined;
    const result = kind === "lch" ? lchToColour(args) : oklchToColour(args);
    return withAlpha(result, args.a);
  }
  if (value === "transparent") return colour(0, 0, 0, 0);
  return hexOrName(value);
}

/** Native ColorRepr: CSS text, 3–4 f32 channels, or a colour object. */
export function parseColour(value: unknown): Colour | undefined {
  if (typeof value === "string") return parseCssColour(value);
  if (Array.isArray(value)) {
    if ((value.length !== 3 && value.length !== 4) || !value.every(channel => typeof channel === "number" && Number.isFinite(channel))) return undefined;
    return colour(value[0], value[1], value[2], value.length === 4 ? value[3] : 1);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.r !== "number" || !Number.isFinite(record.r)
      || typeof record.g !== "number" || !Number.isFinite(record.g)
      || typeof record.b !== "number" || !Number.isFinite(record.b)
      || (record.a !== undefined && (typeof record.a !== "number" || !Number.isFinite(record.a)))) return undefined;
    return colour(record.r, record.g, record.b, record.a === undefined ? 1 : record.a);
  }
  return undefined;
}
