import { inverse, type Affine } from "./affine";
import type { GlassGeometry } from "./glass-lens";

export function glassOwnFrame(xf: Affine) {
  const quantise = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * 65536);
  const x = quantise(xf[4]), y = quantise(xf[5]);
  if (!(Math.abs(x) < 1e15 && Math.abs(y) < 1e15)) return;
  const shiftX = Math.floor(x / 65536), shiftY = Math.floor(y / 65536);
  const matrix: Affine = [xf[0], xf[1], xf[2], xf[3], x / 65536 - shiftX, y / 65536 - shiftY];
  return { matrix, shiftX, shiftY };
}

interface Gradient { x: number; y: number }
function roundedDistance(x: number, y: number, hw: number, hh: number, radius: number, gradient: Gradient) {
  const kx = Math.abs(x) - hw + radius, ky = Math.abs(y) - hh + radius;
  const sx = x < 0 ? -1 : 1, sy = y < 0 ? -1 : 1;
  if (kx > 0 && ky > 0) {
    const len = Math.sqrt(kx * kx + ky * ky);
    gradient.x = sx * kx / len; gradient.y = sy * ky / len;
    return len - radius;
  }
  gradient.x = kx > ky ? sx : 0;
  gradient.y = kx > ky ? 0 : sy;
  return Math.max(kx, ky) - radius;
}

/** Native similarity-transform shortcut for a rectangle with circular corners. */
export function glassRectangle(xf: Affine, width: number, height: number, radii: readonly number[],
  bevel: number, reach: number): GlassGeometry | undefined {
  const own = glassOwnFrame(xf);
  if (!own || width <= 0 || height <= 0) return;
  const [a, b, c, d] = own.matrix;
  const sq = a * a + b * b, scale = Math.sqrt(sq);
  if (scale <= 1e-9 || Math.abs(sq - (c * c + d * d)) > 1e-9 * sq || Math.abs(a * c + b * d) > 1e-9 * sq) return;
  const inv = inverse(own.matrix), hw = width / 2, hh = height / 2, most = Math.min(hw, hh);
  const corners = radii.map(r => Number.isFinite(r) ? Math.min(most, Math.max(0, r)) : 0);
  const bevels = corners.map(r => Math.min(most, Math.max(r, bevel / scale)));
  const rounds = corners.map(r => Math.min(most, Math.max(r, reach / scale)));
  const normal = { x: 0, y: 0 };
  return (x, y, field) => {
    const px = x - own.shiftX + .5, py = y - own.shiftY + .5;
    const qx = inv[0] * px + inv[2] * py + inv[4] - hw, qy = inv[1] * px + inv[3] * py + inv[5] - hh;
    const corner = qy < 0 ? Number(qx >= 0) : (qx < 0 ? 3 : 2);
    const sd = scale * roundedDistance(qx, qy, hw, hh, corners[corner], normal);
    field.coverage = Math.min(1, Math.max(0, .5 - sd));
    if (!field.coverage) return;
    field.distance = Math.max(0, -sd);
    roundedDistance(qx, qy, hw, hh, bevels[corner], normal);
    field.normalX = -(a * normal.x + c * normal.y) / scale;
    field.normalY = -(b * normal.x + d * normal.y) / scale;
    roundedDistance(qx, qy, hw, hh, rounds[corner], normal);
    field.bendX = -(a * normal.x + c * normal.y) / scale;
    field.bendY = -(b * normal.x + d * normal.y) / scale;
  };
}
