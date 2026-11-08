import type { Paint, SolidPaint } from "../../src/engine/solid-paint";

export function expectSolid(paint: Paint | undefined): SolidPaint {
  if (paint?.type !== "solid") throw new Error("Expected a solid paint");
  return paint;
}
