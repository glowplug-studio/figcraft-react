import type { Affine } from "./affine";
import { clampChannel, colour, withAlpha, type Colour } from "./colour";
import { parseColour } from "./colour-css";

export type GradientKind = "linear" | "radial" | "angular" | "diamond";
export type GradientHandle = readonly [number, number];
export interface ColourStop {
  readonly position: number;
  readonly color: Colour;
}
export interface Gradient {
  readonly kind: GradientKind;
  readonly stops: readonly ColourStop[];
  readonly from: GradientHandle;
  readonly to: GradientHandle;
  readonly width: GradientHandle;
}

const black = colour(0, 0, 0);
const handle = (x: number, y: number): GradientHandle => Object.freeze([x, y]);
const stop = (position: number, color: Colour): ColourStop => Object.freeze({ position, color });

function handles(kind: GradientKind) {
  return kind === "linear"
    ? { from: handle(0.5, 0), to: handle(0.5, 1), width: handle(-0.5, 0) }
    : { from: handle(0.5, 0.5), to: handle(0.5, 1), width: handle(1, 0.5) };
}

export function defaultGradient(kind: GradientKind, base: Colour): Gradient {
  return Object.freeze({ kind, ...handles(kind),
    stops: Object.freeze([stop(0, withAlpha(base, 1)), stop(1, withAlpha(base, 0))]) });
}

/** A perpendicular axis in displayed units can be oblique in a non-square unit box. */
export function squareLinearWidth(from: GradientHandle, to: GradientHandle, w: number, h: number): GradientHandle {
  if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) w = h = 1;
  return handle(from[0] - (to[1] - from[1]) * h / w, from[1] + (to[0] - from[0]) * w / h);
}

function readHandle(value: unknown): GradientHandle {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("Gradient handle requires two finite coordinates");
  }
  return handle(value[0], value[1]);
}

/** Native files carry the full record. Only commands supply shorthand handles or evenly spaced CSS colours. */
export function readGradient(p: Record<string, unknown>, command = false): Gradient {
  const shorthand = command && typeof p.type === "string" ? /^(linear|radial|angular|diamond)gradient$/i.exec(p.type) : null;
  if (!shorthand && p.type !== "gradient") throw new Error("Invalid gradient type");
  const kind = p.kind === undefined && command ? shorthand?.[1].toLowerCase() ?? "linear" : p.kind;
  if (kind !== "linear" && kind !== "radial" && kind !== "angular" && kind !== "diamond") throw new Error("Invalid gradient kind");
  const defaults = handles(kind);
  const from = command && p.from === undefined ? defaults.from : readHandle(p.from);
  const to = command && p.to === undefined ? defaults.to : readHandle(p.to);
  const width = command && p.width === undefined
    ? kind === "linear" ? squareLinearWidth(from, to, 1, 1) : defaults.width
    : readHandle(p.width);
  if (!Array.isArray(p.stops)) throw new Error("Gradient stops must be an array");
  const stops = p.stops.map((value: unknown, i, all) => {
    if (command && typeof value === "string") {
      const color = parseColour(value);
      if (color) return stop(all.length > 1 ? Math.fround(i / (all.length - 1)) : 0, color);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid gradient stop");
    const { position, color } = value as Record<string, unknown>;
    const parsed = parseColour(color);
    if (typeof position !== "number" || !Number.isFinite(Math.fround(position)) || !parsed) throw new Error("Invalid gradient stop");
    return stop(Math.fround(position), parsed);
  });
  return Object.freeze({ kind, from, to, width, stops: Object.freeze(stops) });
}

export function sortedStops(stops: readonly ColourStop[]): readonly ColourStop[] {
  const result = stops.filter(s => Number.isFinite(s.position))
    .map(s => stop(clampChannel(s.position), colour(s.color.r, s.color.g, s.color.b, s.color.a)))
    .sort((a, b) => a.position - b.position);
  if (!result.length) result.push(stop(0, black));
  return Object.freeze(result);
}

export function sampleSorted(stops: readonly ColourStop[], value: number): Colour {
  const t = clampChannel(value), first = stops[0];
  if (!first) return black;
  if (t <= first.position) return first.color;
  let lo = 1, hi = stops.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (stops[mid].position < t) lo = mid + 1;
    else hi = mid;
  }
  const next = stops[lo], prior = stops[lo - 1];
  if (!next) return prior.color;
  const span = Math.fround(next.position - prior.position);
  const mix = span > 1e-6 ? Math.fround(Math.fround(t - prior.position) / span) : 1;
  const channel = (key: keyof Colour) => prior.color[key] + Math.fround(Math.fround(next.color[key] - prior.color[key]) * mix);
  return colour(channel("r"), channel("g"), channel("b"), channel("a"));
}

export function gradientFrame(g: Gradient, width: number, height: number): Affine {
  const w = Math.max(1e-6, width), h = Math.max(1e-6, height);
  const x = g.from[0] * w, y = g.from[1] * h;
  return [Math.fround(g.to[0]*w-x), Math.fround(g.to[1]*h-y), Math.fround(g.width[0]*w-x),
    Math.fround(g.width[1]*h-y), Math.fround(x), Math.fround(y)];
}
