import { describe, expect, it } from "vitest";
import { colour, fromRgba8, toRgba8 } from "../../src/engine/colour";
import {
  colourToHsb, colourToHsl, colourToLch, colourToOklch,
  hsbToColour, hslToColour, lchToColour, oklchToColour,
} from "../../src/engine/colour-spaces";

const fromHex = (hex: string) => fromRgba8(...[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]);
const rgbHex = (value: ReturnType<typeof colour>) => toRgba8(value).slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const close = (a: number, b: number, tolerance: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance);

describe("native HSX colour spaces", () => {
  it("round trips upstream byte fixtures", () => {
    for (const hex of ["0D99FF", "F24822", "14AE5C", "000000", "FFFFFF", "808080", "9747FF"]) {
      const c = fromHex(hex);
      expect(rgbHex(hsbToColour(colourToHsb(c))), `${hex} via HSB`).toBe(hex);
      expect(rgbHex(hslToColour(colourToHsl(c))), `${hex} via HSL`).toBe(hex);
    }
  });

  it("handles corners, grayscale, hue wrapping, and invalid inputs", () => {
    expect(colourToHsl(colour(0.5, 0.5, 0.5))).toEqual({ h: 0, s: 0, l: 0.5 });
    expect(colourToHsb(colour(0, 0, 0))).toEqual({ h: 0, s: 0, b: 0 });
    expect(colourToHsl(colour(1, 0, 0)).h).toBe(0);
    expect(colourToHsl(colour(0, 1, 0)).h).toBe(120);
    expect(colourToHsl(colour(0, 0, 1)).h).toBe(240);
    expect(hslToColour({ h: -240, s: 1, l: 0.5 })).toEqual(hslToColour({ h: 120, s: 1, l: 0.5 }));
    expect(hsbToColour({ h: 480, s: 1, b: 1 })).toEqual(hsbToColour({ h: 120, s: 1, b: 1 }));
    expect(hslToColour({ h: Infinity, s: NaN, l: -1 })).toEqual(colour(0, 0, 0));
    expect(hslToColour({ h: 1e100, s: 1e100, l: .5 })).toEqual(colour(.5, .5, .5));
    expect(hsbToColour({ h: 1e-10, s: 1, b: 1 }).g).toBeGreaterThan(0);
  });

  it("preserves fractional channels within 3e-7 and discards source alpha", () => {
    const c = colour(0.1234567, 0.3456789, 0.7890123, 0.25);
    for (const converted of [hsbToColour(colourToHsb(c)), hslToColour(colourToHsl(c))]) {
      for (const channel of ["r", "g", "b"] as const) close(converted[channel], c[channel], 3e-7);
      expect(converted.a).toBe(1);
    }
  });
});

describe("native perceptual colour spaces", () => {
  it("matches upstream CSS Color reference values", () => {
    const red = fromHex("FF0000");
    const lch = colourToLch(red), oklch = colourToOklch(red);
    close(lch.l, 54.29, 0.05); close(lch.c, 106.84, 0.1); close(lch.h, 40.85, 0.1);
    close(oklch.l, 0.628, 0.001); close(oklch.c, 0.2577, 0.001); close(oklch.h, 29.23, 0.1);
    close(colourToLch(colour(1, 1, 1)).l, 100, 0.01);
    expect(colourToLch(colour(1, 1, 1)).c).toBeLessThan(0.05);
    close(colourToOklch(colour(1, 1, 1)).l, 1, 0.001);
    expect(colourToOklch(colour(1, 1, 1)).h).toBe(0);
    expect(Math.round(colourToLch(colour(0, 0, 0)).l)).toBe(0);
  });

  it("round trips the upstream gamut fixtures at byte precision", () => {
    for (const hex of ["0D99FF", "FF0000", "00FF00", "0000FF", "FFFFFF", "000000", "808080", "663399", "F24E1E", "1ABC9C"]) {
      const c = fromHex(hex);
      expect(rgbHex(lchToColour(colourToLch(c))), `${hex} via LCH`).toBe(hex);
      expect(rgbHex(oklchToColour(colourToOklch(c))), `${hex} via OKLCH`).toBe(hex);
    }
  });

  it("reduces out of gamut chroma while retaining lightness and hue", () => {
    const ok = colourToOklch(oklchToColour({ l: 0.7, c: 0.45, h: 150 }));
    close(ok.l, 0.7, 0.01); close(ok.h, 150, 1.5); expect(ok.c).toBeLessThan(0.45);
    const lab = colourToLch(lchToColour({ l: 50, c: 200, h: 300 }));
    close(lab.l, 50, 1); close(lab.h, 300, 2); expect(lab.c).toBeLessThan(200);
  });

  it("normalises hue and sanitises nonfinite or negative inputs", () => {
    expect(oklchToColour({ l: 0.6, c: 0.2, h: -100 })).toEqual(oklchToColour({ l: 0.6, c: 0.2, h: 260 }));
    for (const v of [NaN, Infinity, -Infinity, -1e30, 1e30, -5, 0]) {
      for (const c of [lchToColour({ l: v, c: v, h: v }), oklchToColour({ l: v, c: v, h: v })]) {
        for (const channel of [c.r, c.g, c.b]) expect(channel).toBeGreaterThanOrEqual(0);
        for (const channel of [c.r, c.g, c.b]) expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("round trips fractional in-gamut channels within 2e-5", () => {
    for (const c of [colour(0.1234567, 0.3456789, 0.7890123, 0.4), colour(0.6, 0.4, 0.2)]) {
      for (const restored of [lchToColour(colourToLch(c)), oklchToColour(colourToOklch(c))]) {
        for (const channel of ["r", "g", "b"] as const) close(restored[channel], c[channel], 2e-5);
        expect(restored.a).toBe(1);
      }
    }
  });
});
