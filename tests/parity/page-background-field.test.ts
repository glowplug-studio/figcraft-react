import { expect, it } from "vitest";
import { parseHexColour } from "../../src/engine/colour-css";
import { canvasBackdrop, pageHex, pageOpacity, transparencyGrid, typedPageColour } from "../../src/engine/page-background-field";
import { EditorEngine } from "../../src/engine/editor";
import { pageColour, pageOf } from "../../src/engine/document";

// Restates native crates/ui-egui/src/field_tests.rs at bad07e44 (upstream a45d932a, 67c232ea):
// `page_background_shows_fractional_opacity_like_fill_and_keeps_it_when_opening_the_picker` and the typed-colour rule of page_section.
const hex = (s: string) => parseHexColour(s)!;

it("shows a page at #FF000080 as FF0000 at 50.2%, as Fill does", () => {
  const engine = new EditorEngine();
  engine.execute("page.setBackground", { color: "#FF000080" });
  const colour = pageColour(pageOf(engine.getSnapshot().document));
  expect(pageHex(colour)).toBe("FF0000");
  expect(pageOpacity(colour)).toBe(50.2);
  expect(pageHex(hex("#123ABC80"))).toBe("123ABC");
});

it("keeps the page's opacity for a typed colour unless it carries 4 or 8 hex digits", () => {
  const half = hex("#F5F5F580");
  expect(typedPageColour("00FF00", half)?.a).toBe(half.a);
  expect(typedPageColour("#0f0", half)?.a).toBe(half.a);
  expect(typedPageColour("lightblue", half)?.a).toBe(half.a);
  expect(typedPageColour("FF0000FF", half)?.a).toBe(1);
  expect(typedPageColour("F008", half)?.a).toBeCloseTo(0x88 / 255);
  expect(typedPageColour("rgba(0, 0, 0, 0)", half)?.a).toBe(0);
  expect(typedPageColour("not a colour", half)).toBeUndefined();
});

it("puts the checkerboard behind the canvas only for a page below full opacity", () => {
  // Native canvas/background.rs tests: an opaque page needs no grid; a translucent one draws it behind the render.
  expect(canvasBackdrop(hex("#F5F5F5"))).toBeUndefined();
  expect(canvasBackdrop(hex("#FF000080"))).toBe(transparencyGrid);
  expect(canvasBackdrop(hex("#00000000"))).toBe(transparencyGrid);
  expect(transparencyGrid).toContain("16px 16px");
});
