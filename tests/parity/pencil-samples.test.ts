import { describe, expect, it } from "vitest";
import { pencilPressureProfile, shouldSamplePencil } from "../../src/engine/pencil-samples";

const point = (x: number, y = 0) => ({ x, y });
describe("native Pencil samples and pressure", () => {
  it("matches brush_tests::pressure_becomes_a_width_profile", () => {
    const points = Array.from({ length: 11 }, (_, i) => point(i * 10));
    expect(pencilPressureProfile(points, points.map(() => undefined))).toBeUndefined();
    const profile = pencilPressureProfile(points, points.map((_, i) => i / 10))!;
    expect(profile).toHaveLength(11); expect(profile[0]).toEqual([0, .1]); expect(profile[5]).toEqual([.5, 1]); expect(profile[10]).toEqual([1, 2]);
    expect(pencilPressureProfile([point(0), point(0)], [.5, .5])).toBeUndefined();
  });
  it("interpolates pressure by length rather than the sample index", () => {
    const profile = pencilPressureProfile([point(0), point(10), point(100)], [0, 1, 0])!;
    expect(profile[1][0]).toBe(.5); expect(profile[1][1]).toBeCloseTo(10 / 9, 14);
  });
  it("limits long strokes to32 equal-length positions without changing endpoint pressure", () => {
    const points = Array.from({ length: 1001 }, (_, i) => point(i));
    const profile = pencilPressureProfile(points, points.map((_, i) => i / 1000))!;
    expect(profile).toHaveLength(32); expect(profile[0]).toEqual([0, .1]); expect(profile.at(-1)).toEqual([1, 2]);
    profile.forEach(([t, scale], i) => { expect(t).toBe(i / 31); expect(scale).toBeCloseTo(Math.max(.1, 2 * t), 6); });
  });
  it("uses medium pressure for absent or non-finite samples once any pressure is present", () => {
    const points = [point(0), point(10), point(20), point(30)];
    expect(pencilPressureProfile(points, [undefined, NaN, Infinity, -Infinity])).toEqual([[0, 1], [1 / 3, 1], [2 / 3, 1], [1, 1]]);
    expect(pencilPressureProfile([point(0), point(10)], [.25])).toEqual([[0, .5], [1, 1]]);
  });
  it("rounds device pressure to f32 before clamping and resampling", () => {
    expect(pencilPressureProfile([point(0), point(10)], [.2, .8])).toEqual([[0, Math.fround(.2) * 2], [1, Math.fround(.8) * 2]]);
    expect(pencilPressureProfile([point(0), point(10)], [-1, 3])).toEqual([[0, .1], [1, 2]]);
    expect(pencilPressureProfile([point(0), point(10)], [Number.MAX_VALUE, .5])).toEqual([[0, 1], [1, 1]]);
  });
  it("preserves first-at-or-above ties at duplicate sample positions", () => {
    const profile = pencilPressureProfile([point(0), point(0), point(10), point(10)], [0, 1, .5, 0])!;
    expect(profile[0]).toEqual([0, .1]); expect(profile[3]).toEqual([1, 1]);
    expect(profile[1][1]).toBeCloseTo(5 / 3, 14); expect(profile[2][1]).toBeCloseTo(4 / 3, 14);
  });
  it("omits profiles for insufficient length or overflowing geometry", () => {
    for (const points of [[], [point(1)], [point(1), point(1)], [point(-1e308), point(1e308)], [point(0), point(NaN)]]) expect(pencilPressureProfile(points, [.5])).toBeUndefined();
  });
  it("owns immutable output without retaining mutable sample arrays", () => {
    const points = [point(0), point(10)], pressure = [0, 1], profile = pencilPressureProfile(points, pressure)!;
    points[1].x = 0; pressure[1] = 0;
    expect(profile).toEqual([[0, .1], [1, 2]]); expect(Object.isFrozen(profile)).toBe(true); expect(profile.every(Object.isFrozen)).toBe(true);
  });
  it("accepts the first sample and applies a strict half-screen-pixel distance", () => {
    expect(shouldSamplePencil(undefined, point(0), 1)).toBe(true);
    expect(shouldSamplePencil(point(0), point(.5), 1)).toBe(false); expect(shouldSamplePencil(point(0), point(.5000001), 1)).toBe(true);
    expect(shouldSamplePencil(point(0), point(.3, .4), 1)).toBe(false); expect(shouldSamplePencil(point(0), point(.3, .400001), 1)).toBe(true);
    expect(shouldSamplePencil(point(0), point(.25), 2)).toBe(false); expect(shouldSamplePencil(point(0), point(.2500001), 2)).toBe(true);
  });
  it("uses the native zoom floor for move and release samples", () => {
    for (const zoom of [0, -1, 1e-8, 1e-6]) {
      expect(shouldSamplePencil(point(0), point(500_000), zoom)).toBe(false);
      expect(shouldSamplePencil(point(0), point(500_001), zoom)).toBe(true);
    }
  });
  it("rejects non-finite public sample geometry without changing the previous sample", () => {
    const previous = point(1, 2);
    expect(() => shouldSamplePencil(previous, point(Infinity), 1)).toThrow(/finite/);
    expect(() => shouldSamplePencil(previous, point(2), NaN)).toThrow(/finite/); expect(previous).toEqual(point(1, 2));
  });
});
