/** Browser-independent ports of color::hsx and color::lch. */
import { colour, type Colour } from "./colour";

export interface Hsl { readonly h: number; readonly s: number; readonly l: number }
export interface Hsb { readonly h: number; readonly s: number; readonly b: number }
export interface Lch { readonly l: number; readonly c: number; readonly h: number }
export interface Oklch { readonly l: number; readonly c: number; readonly h: number }

const f32 = Math.fround;
const c01 = (value: number): number => { const v = f32(value); return Number.isFinite(v) ? f32(Math.max(0, Math.min(1, v))) : 0; };
const wrapHue = (value: number): number => {
  const v = f32(value);
  if (!Number.isFinite(v)) return 0;
  const h = f32(v % 360);
  return h < 0 ? f32(h + 360) : h;
};

function hue(r: number, g: number, b: number, max: number, delta: number): number {
  if (delta <= 0) return 0;
  let h: number;
  if (Math.abs(max - r) < 1.1920928955078125e-7) h = 60 * (((g - b) / delta) % 6);
  else if (Math.abs(max - g) < 1.1920928955078125e-7) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return wrapHue(h);
}

function sector(h: number, c: number, x: number): readonly [number, number, number] {
  switch (Math.trunc(h / 60)) {
    case 0: return [c, x, 0];
    case 1: return [x, c, 0];
    case 2: return [0, c, x];
    case 3: return [0, x, c];
    case 4: return [x, 0, c];
    default: return [c, 0, x];
  }
}

export function colourToHsb(value: Colour): Hsb {
  const { r, g, b } = value;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = f32(max - min);
  return { h: hue(r, g, b, max, delta), s: max <= 0 ? 0 : f32(delta / max), b: max };
}

export function hsbToColour(value: Hsb): Colour {
  const h = wrapHue(value.h), s = c01(value.s), v = c01(value.b);
  const c = f32(v * s), x = f32(c * (1 - Math.abs((h / 60) % 2 - 1))), m = f32(v - c);
  const [r, g, b] = sector(h, c, x);
  return colour(f32(r + m), f32(g + m), f32(b + m));
}

export function colourToHsl(value: Colour): Hsl {
  const { r, g, b } = value;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = f32(max - min);
  const l = f32(f32(max + min) / 2);
  const s = delta <= 0 ? 0 : f32(delta / Math.max(f32(1 - Math.abs(f32(2 * l - 1))), 1e-6));
  return { h: hue(r, g, b, max, delta), s: c01(s), l };
}

export function hslToColour(value: Hsl): Colour {
  const h = wrapHue(value.h), s = c01(value.s), l = c01(value.l);
  const c = f32(f32(1 - Math.abs(f32(2 * l - 1))) * s);
  const x = f32(c * (1 - Math.abs((h / 60) % 2 - 1))), m = f32(l - c / 2);
  const [r, g, b] = sector(h, c, x);
  return colour(f32(r + m), f32(g + m), f32(b + m));
}

type V3 = readonly [number, number, number];
type Mat3 = readonly [V3, V3, V3];
const mul = (matrix: Mat3, v: V3): V3 => matrix.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as unknown as V3;
const decode = (value: number): number => {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, f32(value))) : 0;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const encode = (linear: number): number => {
  const v = Number.isFinite(linear) ? Math.max(0, Math.min(1, linear)) : 0;
  return f32(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
};
const linearRgb = (value: Colour): V3 => [decode(value.r), decode(value.g), decode(value.b)];

const SRGB_TO_XYZ: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const P3_TO_XYZ: Mat3 = [
  [0.4865709486482162, 0.2656676931690931, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.0451133818589026, 1.043944368900976],
];
const XYZ_TO_P3: Mat3 = [
  [2.493496911941425, -0.931383617919124, -0.402710784450717],
  [-0.829488969561575, 1.762664060318346, 0.023624685841944],
  [0.035845830243784, -0.076172389268041, 0.956884524007687],
];
export type ColourProfile = "srgb" | "displayP3";

export function parseColourProfile(name: string): ColourProfile | undefined {
  switch (name.toLowerCase().replace(/[ _-]/g, "")) {
    case "srgb": return "srgb";
    case "displayp3": case "p3": return "displayP3";
  }
}

function compose(left: Mat3, right: Mat3): Mat3 {
  const row = (i: number): V3 => [0, 1, 2].map(j =>
    left[i][0] * right[0][j] + left[i][1] * right[1][j] + left[i][2] * right[2][j]) as unknown as V3;
  return [row(0), row(1), row(2)];
}
const toP3 = compose(XYZ_TO_P3, SRGB_TO_XYZ);
const toSrgb = compose(XYZ_TO_SRGB, P3_TO_XYZ);

export function convertColour(value: Colour, from: ColourProfile, to: ColourProfile): Colour {
  if (from === to) return value;
  const [r, g, b] = mul(to === "displayP3" ? toP3 : toSrgb, linearRgb(value));
  return colour(encode(r), encode(g), encode(b), value.a);
}

// Canvas ImageData exposes straight channels. The rasteriser has already undone premultiplication.
const decoded8 = Float32Array.from({ length: 256 }, (_, i) => decode(i / 255));
const encoded8 = Uint8Array.from({ length: 4097 }, (_, i) => Math.round(encode(i / 4096) * 255));
const encodedByte = (linear: number) => encoded8[Math.round(Math.max(0, Math.min(1, linear)) * 4096)];

// Native soft proof tolerates at most two encoded 8-bit steps beyond the destination gamut.
const minimumLinear = -(2 / 255) / 12.92;
const maximumLinear = ((1 + 2 / 255 + .055) / 1.055) ** 2.4;
const outside = (v: number) => v < minimumLinear || v > maximumLinear;
export function outsideSrgb(value: Colour, from: ColourProfile): boolean {
  return from === "displayP3" && mul(toSrgb, linearRgb(value)).some(outside);
}

export function convertColourPixels(pixels: Uint8ClampedArray, from: ColourProfile, to: ColourProfile, proof?: {width:number; y:number}): void {
  if (from === to) return;
  const [red, green, blue] = to === "displayP3" ? toP3 : toSrgb;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const r = decoded8[pixels[i]], g = decoded8[pixels[i + 1]], b = decoded8[pixels[i + 2]];
    const rr = red[0] * r + red[1] * g + red[2] * b;
    const gg = green[0] * r + green[1] * g + green[2] * b;
    const bb = blue[0] * r + blue[1] * g + blue[2] * b;
    if (proof && (outside(rr) || outside(gg) || outside(bb))) {
      const index = i / 4;
      if ((index % proof.width + Math.floor(index / proof.width) + proof.y) % 8 < 4) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 128;
        pixels[i + 3] = 255;
        continue;
      }
    }
    pixels[i] = encodedByte(rr);
    pixels[i + 1] = encodedByte(gg);
    pixels[i + 2] = encodedByte(bb);
  }
}

const D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const D50_WHITE: V3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const KAPPA = 24389 / 27, EPSILON = 216 / 24389;
const SRGB_TO_LMS: Mat3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_OKLAB: Mat3 = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
];
const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.2914855480],
];
const LMS_TO_SRGB: Mat3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.7076147010],
];

function labFromColour(value: Colour): V3 {
  const xyz = mul(D65_TO_D50, mul(SRGB_TO_XYZ, linearRgb(value)));
  const f = (v: number) => v > EPSILON ? Math.cbrt(v) : (KAPPA * v + 16) / 116;
  const [fx, fy, fz] = [f(xyz[0] / D50_WHITE[0]), f(xyz[1] / D50_WHITE[1]), f(xyz[2] / D50_WHITE[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function linearFromLab([l, a, b]: V3): V3 {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (f: number) => f ** 3 > EPSILON ? f ** 3 : (116 * f - 16) / KAPPA;
  const y = l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA;
  return mul(XYZ_TO_SRGB, mul(D50_TO_D65, [inv(fx) * D50_WHITE[0], y * D50_WHITE[1], inv(fz) * D50_WHITE[2]]));
}

function oklabFromColour(value: Colour): V3 {
  const lms = mul(SRGB_TO_LMS, linearRgb(value));
  return mul(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
}

function linearFromOklab(lab: V3): V3 {
  const lms = mul(OKLAB_TO_LMS, lab);
  return mul(LMS_TO_SRGB, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}

function polar([l, a, b]: V3, grey: number): Lch {
  const c = Math.hypot(a, b);
  return { l: f32(l), c: f32(c), h: c < grey ? 0 : f32(((Math.atan2(b, a) * 180 / Math.PI) % 360 + 360) % 360) };
}

const finite = (value: number): number => { const v = f32(value); return Number.isFinite(v) ? v : 0; };
const bounded = (value: number, max: number): number => Math.max(0, Math.min(max, finite(value)));
const inGamut = (rgb: V3): boolean => rgb.every(value => value >= -1e-6 && value <= 1 + 1e-6);

function mapToSrgb(l: number, c: number, h: number, toLinearRgb: (lab: V3) => V3): Colour {
  const radians = h * Math.PI / 180, sin = Math.sin(radians), cos = Math.cos(radians);
  const lab = (chroma: number): V3 => [l, chroma * cos, chroma * sin];
  let rgb = toLinearRgb(lab(c));
  if (!inGamut(rgb)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toLinearRgb(lab(mid)))) lo = mid;
      else hi = mid;
    }
    rgb = toLinearRgb(lab(lo));
  }
  return colour(encode(rgb[0]), encode(rgb[1]), encode(rgb[2]));
}

export function colourToLch(value: Colour): Lch { return polar(labFromColour(value), 0.02); }
export function lchToColour(value: Lch): Colour {
  return mapToSrgb(bounded(value.l, 100), bounded(value.c, 230), ((finite(value.h) % 360) + 360) % 360, linearFromLab);
}
export function colourToOklch(value: Colour): Oklch { return polar(oklabFromColour(value), 0.0002); }
export function oklchToColour(value: Oklch): Colour {
  return mapToSrgb(bounded(value.l, 1), bounded(value.c, 0.5), ((finite(value.h) % 360) + 360) % 360, linearFromOklab);
}
