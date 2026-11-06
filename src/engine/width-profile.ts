import { parseNumber } from "./parameters";

export interface WidthPoint { readonly t: number; readonly scale: number; readonly bias: number }
export interface WidthProfile { readonly points: readonly WidthPoint[] }
export const widthPresetIds = ["uniform", "wedge", "taper", "eye", "rounded", "pinch"] as const;
export type WidthPreset = typeof widthPresetIds[number];
export const widthPresetLabels = ["Uniform", "Wedge", "Taper both ends", "Eye", "Rounded", "Pinch"] as const;
const clamp = (n: number, lo: number, hi: number): number => n < lo ? lo : n > hi ? hi : n;
const freeze = (points: readonly WidthPoint[]): WidthProfile => Object.freeze({ points: Object.freeze(points.map(p => Object.freeze({ ...p }))) });
export function widthPointSides(point: WidthPoint): readonly [number, number] { return [point.scale * (1 - point.bias), point.scale * (1 + point.bias)]; }
export function widthPointFromSides(t: number, left: number, right: number): WidthPoint {
  const clean = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0, l = clean(left), r = clean(right), sum = l + r;
  return { t, scale: sum / 2, bias: sum > 1e-12 ? clamp((r - l) / sum, -1, 1) : 0 };
}
export function sanitiseWidthProfile(profile: WidthProfile): WidthProfile {
  const points: WidthPoint[] = [];
  for (const p of profile.points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.scale)) continue;
    points.push({ t: clamp(p.t, 0, 1), scale: clamp(p.scale, 0, 1000), bias: Number.isFinite(p.bias) ? clamp(p.bias, -1, 1) : 0 });
    if (points.length === 64) break;
  }
  points.sort((a, b) => a.t - b.t || (Object.is(a.t, -0) ? Object.is(b.t, -0) ? 0 : -1 : Object.is(b.t, -0) ? 1 : 0));
  return freeze(points);
}
const presets: Readonly<Record<Exclude<WidthPreset, "uniform">, readonly (readonly [number, number])[]>> = {
  wedge: [[0, 1], [1, 0]], taper: [[0, 0], [.2, 1], [.8, 1], [1, 0]], eye: [[0, 0], [.5, 1], [1, 0]],
  rounded: [[0, .3], [.05, .8], [.15, 1], [.85, 1], [.95, .8], [1, .3]], pinch: [[0, 1], [.5, .25], [1, 1]],
};
export function widthPresetProfile(id: WidthPreset): WidthProfile | undefined {
  return id === "uniform" ? undefined : freeze(presets[id].map(([t, scale]) => ({ t, scale, bias: 0 })));
}
export function widthPresetFromId(value: string): WidthPreset | undefined {
  const key = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return key === "bulge" ? "eye" : widthPresetIds.find((id, i) => id === key || widthPresetLabels[i].replaceAll(" ", "").toLowerCase() === key);
}
export function widthProfilePreset(profile: WidthProfile): WidthPreset | undefined {
  return widthPresetIds.find(id => {
    const preset = widthPresetProfile(id);
    return preset?.points.length === profile.points.length && preset.points.every((p, i) => p.t === profile.points[i].t && p.scale === profile.points[i].scale && p.bias === profile.points[i].bias);
  });
}
/** Raw native serde values are kept; only commands and rendering sanitise. */
export function readWidthProfile(value: unknown): WidthProfile | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Width profile must be an object");
  const raw = value as Record<string, unknown>, points = raw.points === undefined ? [] : raw.points;
  if (!Array.isArray(points)) throw new Error("Width profile points must be an array");
  const number = (n: unknown) => { if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("Width profile numbers must be finite"); return n; };
  return freeze(Array.from(points, point => {
    if (!point || typeof point !== "object" || Array.isArray(point)) throw new Error("Width point must be an object");
    const p = point as Record<string, unknown>;
    return { t: number(p.t), scale: number(p.scale), bias: p.bias === undefined ? 0 : number(p.bias) };
  }));
}
export function wireWidthProfile(profile: WidthProfile): Record<string, unknown> {
  return { points: profile.points.map(p => ({ t: p.t, scale: p.scale, ...(p.bias === 0 ? {} : { bias: p.bias }) })) };
}
/** Native command forms. Optional invalid third array values fall back to a symmetric point. */
export function parseWidthProfile(input: unknown): WidthProfile | undefined {
  let value = input;
  const num = (v: unknown): number | undefined => { try { return parseNumber(v, "widthProfile"); } catch { return undefined; } };
  for (let depth = 0; depth < 128; depth++) {
    if (value === null) return undefined;
    if (typeof value === "string") {
      const preset = widthPresetFromId(value); if (!preset) throw new Error("Unknown width profile preset"); return widthPresetProfile(preset);
    }
    if (Array.isArray(value)) {
      const points = Array.from(value, raw => {
        let t: number | undefined, scale: number | undefined, left: number | undefined, right: number | undefined;
        if (Array.isArray(raw)) { t = num(raw[0]); scale = left = num(raw[1]); right = num(raw[2]); }
        else if (raw && typeof raw === "object") {
          const p = raw as Record<string, unknown>; t = num(p.t); left = num(p.left); right = num(p.right); scale = num(Object.hasOwn(p, "scale") ? p.scale : p.width);
        }
        if (t === undefined) throw new Error("Width point requires a numeric position");
        if (left !== undefined && right !== undefined) return widthPointFromSides(t, left, right);
        if (scale === undefined) throw new Error("Width point requires a scale or both sides");
        return { t, scale, bias: 0 };
      });
      const profile = sanitiseWidthProfile({ points }); return profile.points.length ? profile : undefined;
    }
    if (value && typeof value === "object") {
      const raw = value as Record<string, unknown>; value = Object.hasOwn(raw, "points") ? raw.points : raw.preset; continue;
    }
    throw new Error("Invalid width profile");
  }
  throw new Error("Width profile nesting is too deep");
}
export function widthProfilePoints(profile: WidthProfile): readonly (readonly number[])[] {
  return profile.points.map(p => p.bias === 0 ? [p.t, p.scale] : [p.t, ...widthPointSides(p)]);
}
export function widthProfileSidesAt(profile: WidthProfile, t: number): readonly [number, number] {
  const points = profile.points;
  const interpolate = (value: (p: WidthPoint) => number): number => {
    const first = points[0], last = points.at(-1); if (!first || !last) return 1;
    if (!Number.isFinite(t) || t <= first.t) return value(first);
    if (t >= last.t) return value(last);
    const secant = (i: number): number => { const a = points[i], b = points[i + 1]; return a && b && b.t - a.t > 1e-12 ? (value(b) - value(a)) / (b.t - a.t) : 0; };
    const tangent = (i: number): number => {
      if (i === 0) return secant(0); if (i >= points.length - 1) return secant(Math.max(0, points.length - 2));
      const d0 = secant(i - 1), d1 = secant(i); return d0 * d1 <= 0 ? 0 : 2 * d0 * d1 / (d0 + d1);
    };
    let lo = 0, hi = points.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].t <= t) lo = mid + 1; else hi = mid; }
    const k = Math.max(0, lo - 1), a = points[k], b = points[k + 1]; if (!a || !b) return value(last);
    const h = b.t - a.t; if (h <= 1e-12) return value(b);
    const u = (t - a.t) / h, u2 = u * u, u3 = u2 * u;
    return Math.max(0, (2 * u3 - 3 * u2 + 1) * value(a) + (u3 - 2 * u2 + u) * h * tangent(k) + (3 * u2 - 2 * u3) * value(b) + (u3 - u2) * h * tangent(k + 1));
  };
  if (points.every(p => p.bias === 0)) { const scale = interpolate(p => p.scale); return [scale, scale]; }
  return [interpolate(p => widthPointSides(p)[0]), interpolate(p => widthPointSides(p)[1])];
}
export function widthProfileMaxScale(profile: WidthProfile): number {
  return profile.points.reduce((max, p) => Math.max(max, ...widthPointSides(p).filter(n => !Number.isNaN(n))), 0);
}
