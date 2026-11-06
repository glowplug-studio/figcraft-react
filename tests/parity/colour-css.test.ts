import { describe, expect, it } from "vitest";
import { parseColour, parseCssColour, parseHexColour } from "../../src/engine/colour-css";
import { lookupNamedColour } from "../../src/engine/colour-names";
import { toCssHex, toRgba8 } from "../../src/engine/colour";

const hex = (text: string) => toCssHex(parseCssColour(text)!);
const rgba = (text: string) => toRgba8(parseCssColour(text)!);

describe("native colour CSS parsing", () => {
  it("reads each supported hex width and one optional hash", () => {
    for (const [source, expected] of [
      ["f", "#FFFFFF"], ["ab", "#ABABAB"], ["abc", "#AABBCC"],
      ["abcd", "#AABBCCDD"], ["#0D99FF", "#0D99FF"], ["FF000080", "#FF000080"],
    ]) expect(toCssHex(parseHexColour(source)!)).toBe(expected);
    expect(toCssHex(parseHexColour(" 12 ")!)).toBe("#121212");
    for (const invalid of ["", "#", "##ff0000", "###fff", "12345", "xyz", "1 2"]) {
      expect(parseHexColour(invalid)).toBeUndefined();
    }
  });

  it("looks up the native 148-name table with field normalisation", () => {
    expect(lookupNamedColour("Red")).toEqual([255, 0, 0]);
    expect(hex(" Cornflower Blue ")).toBe("#6495ED");
    expect(hex("light-goldenrod_yellow")).toBe("#FAFAD2");
    expect(hex("RebeccaPurple")).toBe("#663399");
    expect(hex("abc")).toBe("#AABBCC"); // Hex takes precedence.
    expect(parseCssColour("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    for (const invalid of ["reddish", "rédé", "x".repeat(10_000)]) expect(parseCssColour(invalid)).toBeUndefined();
  });

  it("reads RGB and HSL comma, whitespace and slash forms", () => {
    expect(hex("rgb(255, 0, 0)")).toBe("#FF0000");
    expect(rgba("rgba(0 0 255 / 50%)")).toEqual([0, 0, 255, 128]);
    expect(hex("hsl(120, 100%, 50%)")).toBe("#00FF00");
    expect(hex("hsl(120deg 50% 50%)")).toBe("#40BF40");
    expect(parseCssColour("rgb(1e40, 0, 0)")?.r).toBe(1);
    expect(parseCssColour("rgba(1,2,3,0.5)")?.a).toBe(0.5);
    for (const invalid of [
      "rgb(255,,0,0)", "rgb(,1,2,3)", "rgb(1,2,3,)", "rgb(1,2,3,4,5)",
      "hsl(10,,50%,50%)", "rgb(1,2,,)", "rgba(0,0,0,abc)",
      "hsla(0,0%,0%,abc)", "hsl(0,0%,0%,0.5,1)",
      "hsl(nan,50%,50%)", "hsl(inf,50%,50%)", "hsl(0,inf%,50%)",
      "hsl(0,50%,infinity%)", "hsla(120,50%,50%,nan)",
    ]) expect(parseCssColour(invalid)).toBeUndefined();
  });

  it("reads native LCH/OKLCH examples, hue units and none", () => {
    expect(hex("oklch(62.8% 0.2577 29.23)")).toBe("#FF0000");
    expect(rgba("oklch(0.628 0.2577 29.23deg / 50%)")).toEqual([255, 0, 0, 128]);
    expect(hex("lch(54.29 106.84 40.85)")).toBe("#FF0000");
    expect(hex("LCH(100% 0 0)")).toBe("#FFFFFF");
    const blue = hex("oklch(0.6 0.2 260)");
    for (const hue of ["260deg", "0.7222222turn", "288.8888grad", "4.537856rad"])
      expect(hex(`oklch(0.6 0.2 ${hue})`)).toBe(blue);
    expect(hex("lch(50 none none)")).toBe(hex("lch(50 0 0)"));
    expect(rgba("oklch(none 0 0 / none)")).toEqual([0, 0, 0, 255]);
    for (const invalid of ["oklch()", "oklch(,,)", "lch(50)", "lch(1 2 3 4 5)",
      "oklch(0.5 0.1 1e40)", "lch(inf 0 0)", "oklch(0.5 0.1 deg)",
      "lch(50 50 50 / / /)", "oklch(🟥 0 0)"])
      expect(parseCssColour(invalid)).toBeUndefined();
  });

  it("reads native object, array and CSS representations without byte quantisation", () => {
    expect(parseColour("#FF0000")).toEqual(parseColour({ r: 1, g: 0, b: 0 }));
    expect(parseColour([1, 0, 0, 1])).toEqual(parseColour("#FF0000"));
    expect(parseColour([0.123456789, 0, 0, 0.25])).toEqual({ r: Math.fround(0.123456789), g: 0, b: 0, a: 0.25 });
    expect(parseColour({ r: -1, g: 2, b: 0.25, a: 0.5 })).toEqual({ r: 0, g: 1, b: 0.25, a: 0.5 });
    for (const invalid of [null, 42, true, [], [1, 2], [1, 2, 3, 4, 5], [1, "0", 0],
      { r: 1, g: 0 }, { r: 1, g: 0, b: 0, a: "1" }, { r: Infinity, g: 0, b: 0 }, "nope"])
      expect(parseColour(invalid)).toBeUndefined();
  });
});
