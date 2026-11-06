import type { Point, Rectangle } from "./geometry";

/** Kurbo coefficients: x′ = ax + cy + e, y′ = bx + dy + f. */
export type Affine = readonly [number, number, number, number, number, number];

export const identity: Affine = Object.freeze([1, 0, 0, 1, 0, 0]);

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Affine geometry must be finite");
  return value;
}

function matrix(a: number, b: number, c: number, d: number, e: number, f: number): Affine {
  return Object.freeze([finite(a), finite(b), finite(c), finite(d), finite(e), finite(f)]);
}

function checked(transform: Affine): Affine {
  if (transform.length !== 6) throw new Error("Affine geometry needs six coefficients");
  transform.forEach(finite);
  return transform;
}

/** A * B applies B first. */
export function multiply(a: Affine, b: Affine): Affine {
  checked(a);
  checked(b);
  return matrix(
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  );
}

export function inverse(transform: Affine): Affine {
  const [a, b, c, d, e, f] = checked(transform);
  const determinant = finite(a * d - b * c);
  if (determinant === 0) throw new Error("Affine transform is singular");
  return matrix(
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  );
}

export function transformPoint(transform: Affine, point: Point): Point {
  const [a, b, c, d, e, f] = checked(transform);
  const x = finite(point.x), y = finite(point.y);
  return { x: finite(a * x + c * y + e), y: finite(b * x + d * y + f) };
}

export function transformBounds(transform: Affine, width: number, height: number): Rectangle {
  finite(width);
  finite(height);
  const [a, b, c, d, e, f] = checked(transform);
  // Four corners without temporary point/array allocation in the render loop.
  const xw = finite(a * width + e), yw = finite(b * width + f);
  const xh = finite(c * height + e), yh = finite(d * height + f);
  const xwh = finite(a * width + c * height + e), ywh = finite(b * width + d * height + f);
  const x0 = Math.min(e, xw, xh, xwh), x1 = Math.max(e, xw, xh, xwh);
  const y0 = Math.min(f, yw, yh, ywh), y1 = Math.max(f, yw, yh, ywh);
  return { x: finite(x0), y: finite(y0), width: finite(x1 - x0), height: finite(y1 - y0) };
}

/** Positive degrees turn counter-clockwise on a y-down screen. */
export function fromPositionRotation(x: number, y: number, degrees: number): Affine {
  finite(x);
  finite(y);
  const radians = -finite(degrees) * (Math.PI / 180);
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return matrix(cosine, sine, -sine, cosine, x, y);
}

export function rotationDegrees(transform: Affine): number {
  const [a, b] = checked(transform);
  let degrees = -Math.atan2(b, a) * 180 / Math.PI;
  if (Math.abs(degrees) < 1e-9) degrees = 0;
  return degrees <= -180 ? degrees + 360 : degrees;
}

export function withTranslation(transform: Affine, point: Point): Affine {
  const [a, b, c, d] = checked(transform);
  return matrix(a, b, c, d, point.x, point.y);
}

/** Reset scale and skew while preserving the box centre and determinant sign. */
export function setRotationAboutCenter(transform: Affine, width: number, height: number, degrees: number): Affine {
  const [a, b, c, d] = checked(transform);
  const centreLocal = { x: finite(width) / 2, y: finite(height) / 2 };
  const centre = transformPoint(transform, centreLocal);
  const rotation = fromPositionRotation(0, 0, degrees);
  const linear = a * d - b * c < 0 ? multiply(rotation, [1, 0, 0, -1, 0, 0]) : rotation;
  const mapped = transformPoint(linear, centreLocal);
  return withTranslation(linear, { x: finite(centre.x - mapped.x), y: finite(centre.y - mapped.y) });
}

/** Pivot is in parent space. */
export function rotateAbout(transform: Affine, pivot: Point, degrees: number): Affine {
  const x = finite(pivot.x), y = finite(pivot.y);
  return multiply(
    multiply(fromPositionRotation(x, y, degrees), fromPositionRotation(-x, -y, 0)),
    transform,
  );
}
