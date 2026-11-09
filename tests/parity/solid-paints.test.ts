import { describe, expect, it } from "vitest";
import { colour, fromRgba8 } from "../../src/engine/colour";
import { isLegacyPaint, paintColour, readSolidPaint, readSolidPaints, solidPaint } from "../../src/engine/solid-paint";

describe("native solid paints", () => {
  it("moves a typed colour's alpha into paint opacity and colorAlpha", () => {
    const paint = solidPaint(colour(0.125, 0.25, 0.5, 0.375));
    expect(paint).toEqual({ type: "solid", color: colour(0.125, 0.25, 0.5), opacity: 0.375, colorAlpha: 0.375, visible: true, blend: "normal" });
    expect(Object.isFrozen(paint)).toBe(true);
  });

  it("keeps independent paint opacity, typed colour alpha, visibility and stack order", () => {
    const paints = readSolidPaints([
      { type: "solid", color: [0.1, 0.2, 0.3, 0.4], opacity: 0.5, colorAlpha: 0.25, visible: false },
      { type: "solid", color: "#123456" },
    ]);
    expect(paints).toHaveLength(2);
    expect(paints[0]).toMatchObject({ color: colour(0.1, 0.2, 0.3, 0.4), opacity: 0.5, colorAlpha: 0.25, visible: false });
    expect(paints[1]).toMatchObject({ color: fromRgba8(0x12, 0x34, 0x56), opacity: 1, colorAlpha: 1, visible: true });
    expect(paintColour(paints[0]).a).toBe(Math.fround(Math.fround(0.4) * 0.5));
    expect(Object.isFrozen(paints)).toBe(true);
    expect(Object.isFrozen(paints[0])).toBe(true);
  });

  it("accepts a scalar CSS colour only through the command path", () => {
    expect(readSolidPaint("#ff000080", true)).toEqual(solidPaint(fromRgba8(255, 0, 0, 128)));
    expect(() => readSolidPaint("#ff000080")).toThrow();
    expect(() => readSolidPaints("#ff000080")).toThrow();
  });

  it("distinguishes byte-precise legacy fills from richer native paint records", () => {
    expect(isLegacyPaint(solidPaint(fromRgba8(17, 34, 51)))).toBe(true);
    expect(isLegacyPaint(solidPaint(colour(0.12345, 0.25, 0.5)))).toBe(false);
    expect(isLegacyPaint(readSolidPaint({ type: "solid", color: "#112233", visible: false }))).toBe(false);
    expect(isLegacyPaint(readSolidPaint({ type: "solid", color: "#112233", colorAlpha: 0.5 }))).toBe(false);
  });

  it("refuses unsupported paint kinds, blends and unknown properties", () => {
    expect(() => readSolidPaint({ type: "gradient", stops: [] })).toThrow();
    expect(() => readSolidPaint({ type: "solid", color: "red", blend: "unknownMode" })).toThrow();
    expect(() => readSolidPaint({ type: "solid", color: "red", future: true })).toThrow();
    expect(() => readSolidPaint({ type: "solid", color: "red", opacity: Infinity })).toThrow();
  });
});
