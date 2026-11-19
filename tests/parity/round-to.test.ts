import { describe, expect, it } from "vitest";
import { roundTo } from "../../src/engine/affine";
import { EditorEngine } from "../../src/engine/editor";

// Native crates/geom/src/transform.rs::round_to and its tests at bad07e44 (upstream #2309 for huge values).
describe("native display rounding", () => {
  it("leaves finite values finite at a large precision", () => {
    expect(roundTo(1.25, 400)).toBe(1.25);
    expect(roundTo(-1.25, 400)).toBe(-1.25);
    expect(roundTo(1.23456, 2)).toBe(1.23);
  });
  it("keeps huge finite values finite", () => {
    expect(roundTo(1e307, 2)).toBe(1e307);
    expect(roundTo(-1e307, 2)).toBe(-1e307);
    expect(roundTo(Number.MAX_VALUE, 3)).toBe(Number.MAX_VALUE);
  });
  it("rounds halves away from zero, never returns negative zero and passes non-finite values through", () => {
    expect(roundTo(0.125, 2)).toBe(0.13);
    expect(roundTo(-0.125, 2)).toBe(-0.13);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(Object.is(roundTo(-0.001, 2), 0)).toBe(true);
    expect(Object.is(roundTo(-0, 2), 0)).toBe(true);
    expect(roundTo(Infinity, 2)).toBe(Infinity);
    expect(roundTo(-Infinity, 2)).toBe(-Infinity);
    expect(roundTo(NaN, 2)).toBeNaN();
    expect(roundTo(1234.5678, -2)).toBe(1200);
  });
  it("node.get reports a tiny negative offset as zero, not negative zero", () => {
    const engine = new EditorEngine();
    const { id } = engine.execute("shape.rectangle", { x: -0.001, y: 0.004, width: 10.006, height: 10 }) as { id: string };
    const got = engine.execute("node.get", { id, fields: ["x", "y", "width", "height"] }) as Record<string, number>;
    expect(Object.is(got.x, 0)).toBe(true);
    expect(got).toMatchObject({ y: 0, width: 10.01, height: 10 });
  });
  it("node.get keeps a huge finite position and size finite", () => {
    const engine = new EditorEngine();
    const far = engine.execute("shape.rectangle", { x: 1e307, y: -1e307, width: 10, height: 10 }) as { id: string };
    expect(engine.execute("node.get", { id: far.id, fields: ["x", "y"] })).toMatchObject({ x: 1e307, y: -1e307 });
    const wide = engine.execute("shape.rectangle", { x: 0, y: 0, width: 1e307, height: 10 }) as { id: string };
    expect(engine.execute("node.get", { id: wide.id, fields: ["width", "height"] })).toMatchObject({ width: 1e307, height: 10 });
  });
});
