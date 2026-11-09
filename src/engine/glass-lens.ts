import type { Effect } from "./effects";

type Glass = Extract<Effect, { type: "glass" }>;
export interface GlassField {
  coverage: number;
  distance: number;
  normalX: number;
  normalY: number;
  bendX: number;
  bendY: number;
}
export type GlassGeometry = (x: number, y: number, field: GlassField) => void;

const unit = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (a: number, b: number, v: number) => unit((v - a) / Math.max(.00001, b - a));
function smooth(a: number, b: number, v: number) {
  const t = ramp(a, b, v);
  return t * t * (3 - 2 * t);
}

export function glassBend(distance: number, depth: number, bevel: number, refraction: number) {
  if (distance >= Math.max(depth, .0001) + bevel) return 0;
  const t = ramp(-depth - bevel, -bevel, -distance);
  const most = .999 * depth;
  const core = Math.min(most, t ** 3.5 * depth * refraction);
  return core + (refraction * .2 * most - core) * ramp(-bevel - .0001, -.3 * bevel, -distance);
}

interface Raster { data: Uint8Array; width: number; height: number }
function sample(p: Raster, x: number, y: number, dest: Float32Array) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const i = 4 * (y0 * p.width + x0), stride = 4 * p.width;
  const left = x0 >= 0 && x0 < p.width, right = x0 >= -1 && x0 < p.width - 1;
  const top = y0 >= 0 && y0 < p.height, bottom = y0 >= -1 && y0 < p.height - 1;
  for (let c = 0; c < 4; c++) {
    const a = left && top ? p.data[i + c] : 0, b = right && top ? p.data[i + 4 + c] : 0;
    const d = left && bottom ? p.data[i + stride + c] : 0, e = right && bottom ? p.data[i + stride + 4 + c] : 0;
    const u = a + (b - a) * tx, v = d + (e - d) * tx;
    dest[c] = u + (v - u) * ty;
  }
}

// Coordinates are zero at the first pixel centre. The outer two triangular
// weights are zero, leaving six contributions per channel.
function dispersed(p: Raster, x: number, y: number, dx: number, dy: number, k: number,
  base: Float32Array, scratch: Float32Array) {
  if (k < .001 || (dx * dx + dy * dy) * k * k < 1 / 65536) {
    sample(p, x + dx, y + dy, base);
    return;
  }
  base.fill(0);
  let sum = 0;
  for (let i = 1; i < 7; i++) {
    const t = i / 7 - .5, weight = 1 - Math.abs(2 * t);
    let alpha = 0;
    for (let c = 0; c < 3; c++) {
      const s = 1 + (t + .5 * (1 - c)) * k;
      sample(p, x + dx * s, y + dy * s, scratch);
      base[c] += scratch[c] * weight;
      alpha = Math.max(alpha, scratch[3]);
    }
    base[3] += alpha * weight;
    sum += weight;
  }
  for (let c = 0; c < 4; c++) base[c] /= sum;
}

export function glassDepth(g: Glass, scale: number) {
  return Math.max(1, Math.min(1024, Math.max(1, Math.min(1000, g.depth)) * scale));
}

export function glassLensPixels(back: Raster, width: number, height: number, pad: number,
  g: Glass, scale: number, centreX: number, centreY: number, geometry: GlassGeometry) {
  const depth = glassDepth(g, scale);
  const bevel = Math.min(1024, scale), splay = unit(g.splay), intensity = unit(g.lightIntensity);
  const angle = (Math.max(-3600, Math.min(3600, g.lightAngle)) % 360) * Math.PI / 180, lightX = Math.sin(angle), lightY = -Math.cos(angle);
  const refraction = unit(g.refraction), dispersion = .16 * unit(g.dispersion);
  const field: GlassField = { coverage: 0, distance: 0, normalX: 0, normalY: 0, bendX: 0, bendY: 0 };
  const result = new Uint8Array(width * height * 4);
  const base = new Float32Array(4), scratch = new Float32Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      geometry(x, y, field);
      if (field.coverage <= 0) continue;
      let add = 0;
      const d = field.distance;
      if (d >= depth + bevel) {
        sample(back, x + pad, y + pad, base);
      } else {
        const px = x + .5 - centreX, py = y + .5 - centreY;
        const len = splay > 0 ? Math.hypot(px, py) : 0;
        const radial = len > 1e-6 ? splay / len : 0;
        const outX = -field.bendX * (1 - splay) + px * radial;
        const outY = -field.bendY * (1 - splay) + py * radial;
        const bend = glassBend(d, depth, bevel, refraction);
        dispersed(back, x + pad, y + pad, -outX * bend, -outY * bend, dispersion, base, scratch);
        const facing = -(field.normalX * lightX + field.normalY * lightY);
        const rim = smooth(-bevel - .001, -.2 * bevel, -d) * (smooth(.35, 1, facing) + .6 * smooth(.35, 1, -facing));
        const sheen = -(outX * lightX + outY * lightY) * ramp(-depth, -bevel + .0001, -d) ** 2 * .05;
        add = 255 * intensity * (rim + sheen);
      }
      const alpha = Math.min(255, Math.max(base[3], Math.max(base[0], base[1], base[2]) + add));
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) result[i + c] = Math.round(Math.max(0, Math.min(alpha, base[c] + add)) * field.coverage);
      result[i + 3] = Math.round(alpha * field.coverage);
    }
  }
  return result;
}
