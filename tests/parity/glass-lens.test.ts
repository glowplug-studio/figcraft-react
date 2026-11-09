import { expect, test } from "vitest";
import { readEffect } from "../../src/engine/effects";
import { glassBend, glassLensPixels, type GlassField } from "../../src/engine/glass-lens";
import { glassRectangle } from "../../src/engine/glass-rectangle";

const effect = readEffect({ type: "glass" }, "archive");
if (effect.type !== "glass") throw new Error("expected native glass defaults");
const glass = { ...effect, lightIntensity: 0 };
const field = (): GlassField => ({coverage: 1, distance: 1, normalX: 1, normalY: 0, bendX: 1, bendY: 0});

test("glass refraction follows the native thick lens profile", () => {
  for (const [d, expected] of [[.1, 3.1968], [.5, 6.8543], [1, 15.9982], [4, 9.0591], [8, 3.5426], [16, .125], [20, .0004], [21, 0]]) {
    expect(Math.abs(glassBend(d, 20, 1, .8) - expected)).toBeLessThan(.001);
  }
});

test("dispersion separates channels along a calibrated ramp and light can raise transparent alpha", () => {
  const width = 100, data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) data.set([x * 2, x * 2, x * 2, 255], x * 4);
  // Single-row read at zero padding, constant bend near the bevel.
  const render = (dispersion: number) => glassLensPixels({ data, width, height: 1 }, width, 1, 0,
    { ...glass, dispersion }, 1, 50, .5, (_x, _y, f) => Object.assign(f, field()));
  expect(Array.from(render(0).subarray(80, 84))).toEqual([72, 72, 72, 255]);
  expect(Array.from(render(1).subarray(80, 84))).toEqual([75, 72, 69, 255]);
  const transparent = glassLensPixels({ data: new Uint8Array(4), width: 1, height: 1 }, 1, 1, 0,
    { ...glass, lightAngle: -90, lightIntensity: 1 }, 1, .5, .5, (_x, _y, f) => Object.assign(f, field(), {distance: 0, coverage: .5}));
  expect(Array.from(transparent)).toEqual([121, 121, 121, 121]);
});

test("rectangular glass tracks individual corner radii, rotation, reflection and quantised translation", () => {
  const radii = [0, 20, 5, 0];
  const geometry = glassRectangle([0, 2, 2, 0, -20.00000001, 10], 120, 80, radii, 1, 20)!;
  const f = field();
  geometry(60, 10, f);
  expect(f.coverage).toBe(1);
  expect(f.distance).toBeCloseTo(.5, 7);
  expect(f.normalY).toBeCloseTo(1, 7);
  geometry(-19, 248, f);
  expect(f.coverage).toBe(0);
  geometry(-19, 11, f);
  expect(f.coverage).toBe(1);
  expect(f.bendX).toBeCloseTo(Math.SQRT1_2, 6);
  expect(f.bendY).toBeCloseTo(Math.SQRT1_2, 6);
  expect(glassRectangle([1, .3, 0, 1, 0, 0], 120, 80, radii, 1, 20)).toBeUndefined();
});
