import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { rectanglePaints, type LayerNode } from "../../src/engine/document";
import { fromRgba8, toCssHex } from "../../src/engine/colour";
import { paintColour } from "../../src/engine/solid-paint";

// Native cmd/view.rs edit.pickColor and canvas/tools/click.rs eyedrop at bad07e44: the tool, what a pick does with the colour.
it("Pick color fills the selection with the picked colour, says so and returns to Move", () => {
  const e = new EditorEngine();
  const id = String((e.execute("shape.rectangle", { x: 0, y: 0, width: 40, height: 40 }) as { id: string }).id);
  e.execute("select.set", { ids: [id] });
  expect(e.execute("edit.pickColor")).toEqual({});
  expect(e.getSnapshot().tool).toBe("eyedropper");
  expect(e.pickColour(fromRgba8(0x3d, 0x44, 0x4d, 255))).toEqual({ message: "Picked #3D444D" });
  expect(e.getSnapshot().tool).toBe("move");
  const paint = rectanglePaints(e.getSnapshot().document.nodes[id] as LayerNode)[0];
  expect(paint.type === "solid" && toCssHex(paintColour(paint))).toBe("#3D444D");
  e.execute("edit.undo");
  expect(e.pickedColour()).toBeUndefined();
});

it("apply: false only samples, for a colour picker, and a pick outside the tool is refused", () => {
  const e = new EditorEngine();
  const id = String((e.execute("shape.rectangle", { x: 0, y: 0, width: 40, height: 40 }) as { id: string }).id);
  e.execute("select.set", { ids: [id] });
  const before = e.getSnapshot().document;
  expect(() => e.pickColour(fromRgba8(1, 2, 3, 255))).toThrow(/eyedropper/);
  e.execute("edit.pickColor", { apply: false });
  e.pickColour(fromRgba8(0x15, 0x1b, 0x23, 128));
  expect(e.getSnapshot().document).toBe(before);
  expect(e.pickedColour() && toCssHex(e.pickedColour()!)).toBe("#151B23");
  expect(() => e.execute("edit.pickColor", { colour: "red" })).toThrow(/apply/);
});
