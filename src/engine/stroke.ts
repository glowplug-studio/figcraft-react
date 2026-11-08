import type { LayerNode } from "./document";
import { parseColour } from "./colour-css";
import { parseNumber } from "./parameters";
import { readPaints, solidPaint } from "./solid-paint";
import { parseWidthProfile, readWidthProfile, wireWidthProfile, widthProfileMaxScale, type WidthProfile } from "./width-profile";
import { brushReachFactor, parseBrush, readBrush, wireBrush, type Brush } from "./brush";

export const strokeCaps = ["none", "round", "square", "lineArrow", "triangleArrow", "reversedTriangle", "circleFilled", "diamondFilled"] as const;
export type StrokeCap = typeof strokeCaps[number];
export type StrokeAlign = "inside" | "center" | "outside";
export type StrokeJoin = "miter" | "bevel" | "round";
export type StrokeSides = readonly [number, number, number, number];
export interface StrokeProps {
  readonly weight: number;
  readonly sides?: StrokeSides;
  readonly widthProfile?: WidthProfile;
  readonly brush?: Brush;
  readonly align: StrokeAlign;
  readonly capStart: StrokeCap;
  readonly capEnd: StrokeCap;
  readonly join: StrokeJoin;
  readonly miterLimit: number;
  readonly dashes: readonly number[];
  readonly dashCap: StrokeCap | null;
}
export const defaultStroke: StrokeProps = Object.freeze({ weight: 1, align: "inside", capStart: "none", capEnd: "none", join: "miter", miterLimit: 4, dashes: Object.freeze([]), dashCap: null });
export const isDefaultStroke = (p: StrokeProps): boolean => p.sides === undefined && p.widthProfile === undefined && p.brush === undefined && p.weight === 1 && p.align === "inside" && p.capStart === "none" && p.capEnd === "none" && p.join === "miter" && p.miterLimit === 4 && p.dashes.length === 0 && p.dashCap === null;
export const MAX_STROKE_WIDTH = 1e6;
export const hasVisibleStroke = (node: LayerNode): boolean => (node.stroke ?? defaultStroke).weight > 0 && Boolean(node.strokes?.some(p => p.visible));
export const strokeMaxWeight = (props: StrokeProps): number => props.weight * (props.widthProfile?.points.length ? widthProfileMaxScale(props.widthProfile) : 1) * (props.brush ? brushReachFactor(props.brush) : 1);
const aligns = ["inside", "center", "outside"] as const, joins = ["miter", "bevel", "round"] as const;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const miterAngle = (limit: number): number => 2 * Math.asin(1 / clamp(limit, 1, 100)) * 180 / Math.PI;
export const miterLimitFor = (angle: number): number => clamp(1 / Math.sin((Number.isFinite(angle) ? clamp(angle, 1, 180) : 28.955) * Math.PI / 360), 1, 100);

/** Native enum_of normalises command strings; file enums stay exact. */
export function strokeEnum<T extends string>(value: unknown, allowed: readonly T[], command = true): T {
  if (typeof value !== "string") throw new Error("A stroke enum must be a string");
  let normalised = value;
  if (command) {
    const noLowercase = !/\p{Ll}/u.test(value);
    let upper = false;
    normalised = [...value.trim()].map((ch, i) => {
      if (ch === "_" || ch === "-" || ch === " ") { upper = true; return ""; }
      if (i === 0) return ch.toLowerCase();
      if (upper) { upper = false; return ch.toUpperCase(); }
      return noLowercase ? ch.toLowerCase() : ch;
    }).join("");
  }
  const found = allowed.find(item => item === normalised);
  if (found === undefined) throw new Error(`Unsupported stroke value: ${value}`);
  return found;
}

/** Read native StrokeProps after the file adapter converts lossless float tokens. */
export function readStroke(value: unknown): StrokeProps {
  if (value === undefined) return defaultStroke;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stroke must be an object");
  const raw = value as Record<string, unknown>;
  const keys = ["weight", "align", "sides", "cap_start", "cap_end", "join", "miter_limit", "dashes", "dash_cap", "width_profile", "brush"];
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error("Unsupported stroke property");
  const brush = readBrush(raw.brush);
  const widthProfile = readWidthProfile(raw.width_profile);
  let sides: StrokeSides | undefined;
  if (raw.sides != null) {
    if (!Array.isArray(raw.sides) || raw.sides.length !== 4 || !Array.from(raw.sides).every(item => typeof item === "number" && Number.isFinite(item))) throw new Error("Stroke sides must contain four finite numbers");
    sides = Object.freeze([raw.sides[0], raw.sides[1], raw.sides[2], raw.sides[3]]);
  }
  const number = (value: unknown, fallback: number): number => {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Stroke numbers must be finite");
    return value;
  };
  if (raw.dashes !== undefined && !Array.isArray(raw.dashes)) throw new Error("Stroke dashes must be an array");
  return Object.freeze({
    weight: number(raw.weight, 1), align: raw.align === undefined ? "inside" : strokeEnum(raw.align, aligns, false),
    ...(sides === undefined ? {} : { sides }),
    ...(widthProfile === undefined ? {} : { widthProfile }),
    ...(brush === undefined ? {} : { brush }),
    capStart: raw.cap_start === undefined ? "none" : strokeEnum(raw.cap_start, strokeCaps, false),
    capEnd: raw.cap_end === undefined ? "none" : strokeEnum(raw.cap_end, strokeCaps, false),
    join: raw.join === undefined ? "miter" : strokeEnum(raw.join, joins, false), miterLimit: number(raw.miter_limit, 4),
    dashes: Object.freeze((raw.dashes as unknown[] | undefined ?? []).map(item => {
      if (item === undefined) throw new Error("Stroke dashes must be finite numbers");
      return number(item, 0);
    })),
    dashCap: raw.dash_cap == null ? null : strokeEnum(raw.dash_cap, strokeCaps, false),
  });
}
export function wireStroke(props: StrokeProps): Record<string, unknown> {
  return { weight: props.weight, align: props.align, sides: props.sides ? [...props.sides] : null, cap_start: props.capStart, cap_end: props.capEnd,
    join: props.join, miter_limit: props.miterLimit, dashes: [...props.dashes], ...(props.dashCap === null ? {} : { dash_cap: props.dashCap }), ...(props.widthProfile === undefined ? {} : { width_profile: wireWidthProfile(props.widthProfile) }), ...(props.brush === undefined ? {} : { brush: wireBrush(props.brush) }) };
}

export const strokeSideKeys = ["strokeTopWeight", "strokeRightWeight", "strokeBottomWeight", "strokeLeftWeight"] as const;
const strokeKeys = new Set(["stroke", "strokes", "strokeWeight", "strokeSides", ...strokeSideKeys, "widthProfile", "brush", "strokeBrush", "strokeAlign", "strokeCap", "startCap", "endCap", "strokeJoin", "miterLimit", "miterAngle", "dashes", "dashCap"]);
export const isStrokeKey = (key: string): boolean => strokeKeys.has(key);
export function setStrokeProperties(node: LayerNode, props: Record<string, unknown>): LayerNode {
  const keys = Object.keys(props).filter(isStrokeKey).sort();
  if (!keys.length) return node;
  let stroke = { ...(node.stroke ?? defaultStroke) }, strokes = node.strokes;
  for (const key of keys) {
    const value = props[key];
    switch (key) {
      case "stroke": {
        if (value === null || typeof value === "string" && value.toLowerCase() === "none") strokes = Object.freeze([]);
        else { const colour = parseColour(value); if (!colour) throw new Error("stroke must be a colour, none or null"); strokes = Object.freeze([solidPaint(colour)]); }
        break;
      }
      case "strokes": strokes = readPaints(value, true); break;
      case "strokeWeight": stroke.weight = Math.max(0, parseNumber(value, key)); break;
      case "widthProfile": {
        const profile = parseWidthProfile(value); if (profile) stroke.widthProfile = profile; else delete stroke.widthProfile; break;
      }
      case "brush": case "strokeBrush": {
        const brush = parseBrush(value); if (brush) stroke.brush = brush; else delete stroke.brush; break;
      }
      case "strokeSides": {
        if (value === null) { delete stroke.sides; break; }
        const values = Array.from(Array.isArray(value) ? value : [value], item => parseNumber(item, key));
        if (![1, 2, 4].includes(values.length)) throw new Error("strokeSides requires one, two or four values");
        stroke.sides = Object.freeze([values[0], values[1] ?? values[0], values[2] ?? values[0], values[3] ?? values[1] ?? values[0]]);
        break;
      }
      case "strokeTopWeight": case "strokeRightWeight": case "strokeBottomWeight": case "strokeLeftWeight": {
        const sides: [number, number, number, number] = [...(stroke.sides ?? [stroke.weight, stroke.weight, stroke.weight, stroke.weight])];
        sides[strokeSideKeys.indexOf(key)] = Math.max(0, parseNumber(value, key));
        stroke.sides = Object.freeze(sides); break;
      }
      case "strokeAlign": stroke.align = strokeEnum(value, aligns); break;
      case "strokeJoin": stroke.join = strokeEnum(value, joins); break;
      case "strokeCap": case "startCap": case "endCap": {
        let cap: StrokeCap;
        try { cap = strokeEnum(value, strokeCaps); }
        catch { throw new Error(`${key}: ${strokeCaps.join("|")}`); }
        if (key !== "endCap") stroke.capStart = cap;
        if (key !== "startCap") stroke.capEnd = cap;
        break;
      }
      case "miterAngle": stroke.miterLimit = miterLimitFor(parseNumber(value, key)); break;
      case "miterLimit": {
        let limit = 4; try { limit = parseNumber(value, key); } catch { /* Native malformed limit fallback. */ }
        stroke.miterLimit = clamp(limit, 1, 100); break;
      }
      case "dashes": {
        if (value !== null && !Array.isArray(value)) throw new Error("dashes must be an array");
        stroke.dashes = Object.freeze(((value ?? []) as unknown[]).map(item => {
          if (typeof item === "boolean") throw new Error("dashes must contain numbers");
          return Math.max(0, parseNumber(item, key));
        })); break;
      }
      case "dashCap": stroke.dashCap = value === null ? null : strokeEnum(value, ["none", "round", "square"] as const); break;
    }
  }
  return Object.freeze({ ...node, ...(strokes === undefined ? {} : { strokes }), stroke: Object.freeze(stroke) });
}

export const capShape = (cap: StrokeCap): "none" | "round" | "square" => cap === "round" || cap === "circleFilled" ? "round" : cap === "square" || cap === "diamondFilled" ? "square" : "none";
export const bandCaps = (props: StrokeProps): readonly [StrokeCap, StrokeCap] => props.dashes.length && props.dashCap !== null ? [props.dashCap, props.dashCap] : [props.capStart, props.capEnd];
export function dashPattern(dashes: readonly number[]): number[] | null {
  const pattern = dashes.filter(d => Number.isFinite(d) && d >= 0);
  if (!pattern.length || pattern.reduce((a, b) => a + b, 0) <= .01) return null;
  return pattern.length % 2 ? [...pattern, ...pattern] : pattern;
}
export function lineDashes(length: number, closed: boolean, pattern: readonly number[]): { pattern: number[]; offset: number } {
  const total = pattern.reduce((a, b) => a + b, 0);
  if (closed || !(length > 1e-9 && total > 0)) return { pattern: [...pattern], offset: 0 };
  const scale = length / (Math.max(Math.floor(length / total + .01), 1) * total), fitted = pattern.map(d => d * scale);
  return { pattern: fitted, offset: (fitted[0] ?? 0) / 2 };
}
/** One-subpath stroke budget, matching stroke_center before fitting open ends. */
export function renderDashes(length: number, closed: boolean, props: StrokeProps, subpaths = 1): { pattern: number[]; offset: number } | null {
  let pattern = dashPattern(props.dashes);
  if (!pattern) return null;
  if (bandCaps(props).some(cap => capShape(cap) === "round") || props.dashCap === "square") pattern = pattern.map(d => d === 0 ? .001 : d);
  const total = pattern.reduce((a, b) => a + b, 0);
  if (!((length + subpaths * total) / total * pattern.length < 20000)) return null;
  return lineDashes(length, closed, pattern);
}
