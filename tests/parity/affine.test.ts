import { describe, expect, it } from "vitest";
import {
  fromPositionRotation, identity, inverse, multiply, rotateAbout, rotationDegrees,
  setRotationAboutCenter, transformBounds, transformPoint, withTranslation,
  type Affine,
} from "../../src/engine/affine";

const closePoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

describe("upstream geom transform parity", () => {
  it("round-trips position and rotation", () => {
    for (const degrees of [0, 30, -45, 90, 179]) {
      const transform = fromPositionRotation(10, 20, degrees);
      expect(rotationDegrees(transform)).toBeCloseTo(degrees, 9);
      expect(transform[4]).toBe(10);
      expect(transform[5]).toBe(20);
    }
  });

  it("sets rotation about the centre, preserving either flip", () => {
    const transform = fromPositionRotation(10, 20, 0);
    const centre = { x: 50, y: 25 };
    const rotated = setRotationAboutCenter(transform, 100, 50, 90);
    closePoint(transformPoint(rotated, centre), transformPoint(transform, centre));
    expect(rotationDegrees(rotated)).toBeCloseTo(90, 9);

    for (const flip of [[-1, 0, 0, 1, 0, 0], [1, 0, 0, -1, 0, 0]] as const) {
      const flipped = multiply(transform, flip);
      for (const degrees of [0, 30, -120]) {
        const result = setRotationAboutCenter(flipped, 100, 50, degrees);
        expect(result[0] * result[3] - result[1] * result[2]).toBeLessThan(0);
        expect(rotationDegrees(result)).toBeCloseTo(degrees, 9);
        closePoint(transformPoint(result, centre), transformPoint(flipped, centre));
      }
    }
  });
});

describe("affine algebra", () => {
  it("composes right to left and leaves input tuples untouched", () => {
    const a: Affine = [2, 1, 3, 4, 5, 6];
    const b: Affine = [1, 2, -1, 3, 7, 8];
    const combined = multiply(a, b);
    closePoint(transformPoint(combined, { x: 2, y: 3 }), transformPoint(a, transformPoint(b, { x: 2, y: 3 })));
    expect(multiply(a, identity)).toEqual(a);
    expect(a).toEqual([2, 1, 3, 4, 5, 6]);
    expect(b).toEqual([1, 2, -1, 3, 7, 8]);
  });

  it("inverts a skewed reflection and replaces only translation", () => {
    const transform: Affine = [-2, 1, 3, 4, 5, -7];
    const point = { x: 8, y: -3 };
    closePoint(transformPoint(inverse(transform), transformPoint(transform, point)), point);
    const changed = withTranslation(transform, { x: 12, y: 13 });
    expect(changed).toEqual([-2, 1, 3, 4, 12, 13]);
    expect(transform).toEqual([-2, 1, 3, 4, 5, -7]);
  });

  it("includes all four corners in bounds", () => {
    const transform: Affine = [1, 2, -3, 1, 10, 20];
    expect(transformBounds(transform, 4, 5)).toEqual({ x: -5, y: 20, width: 19, height: 13 });
  });

  it("rotates about a parent-space pivot", () => {
    const pivot = { x: 30, y: 40 };
    const transform: Affine = [1, 0, 0, 1, 10, 20];
    const result = rotateAbout(transform, pivot, 90);
    closePoint(transformPoint(result, { x: 20, y: 20 }), pivot);
    closePoint(transformPoint(result, { x: 21, y: 20 }), { x: 30, y: 39 });
  });

  it("rejects exact singular and non-finite input or results", () => {
    expect(() => inverse([1, 2, 2, 4, 0, 0])).toThrow("singular");
    expect(() => inverse([1e-12, 0, 0, 1, 0, 0])).not.toThrow();
    expect(() => inverse([Infinity, 0, 0, 1, 0, 0])).toThrow("finite");
    expect(() => multiply([1e308, 0, 0, 1, 0, 0], [2, 0, 0, 1, 0, 0])).toThrow("finite");
    expect(() => transformPoint(identity, { x: NaN, y: 0 })).toThrow("finite");
    expect(() => transformBounds(identity, 1, Infinity)).toThrow("finite");
    expect(() => fromPositionRotation(0, 0, Infinity)).toThrow("finite");
    expect(() => fromPositionRotation(0, 0, 1e308)).not.toThrow();
    expect(Object.isFrozen(fromPositionRotation(0, 0, 30))).toBe(true);
    expect(() => setRotationAboutCenter(identity, Infinity, 1, 0)).toThrow("finite");
    expect(() => rotateAbout(identity, { x: 0, y: NaN }, 0)).toThrow("finite");
  });
});
