import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { MoveInteraction } from "../../src/engine/move-interaction";
import { TransformInteraction } from "../../src/engine/transform-interaction";
import { boundsOf } from "../../src/engine/viewport";
import { worldTransform } from "../../src/engine/hierarchy";
import { transformPoint } from "../../src/engine/affine";

const none = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const fail = (reason: string) => { throw new Error(reason); };
const point = (x: number, y: number) => ({ x, y });
function scene() {
  const e = new EditorEngine();
  e.execute("shape.rectangle", { x: 0, y: 0, width: 11, height: 11 });
  return e;
}

it("matches snapping_to_layers_wins_over_the_pixel_grid during move and resize", () => {
  const e = scene(), move = new MoveInteraction(e, fail), resize = new TransformInteraction(e, fail);
  const id = String(e.execute("shape.rectangle", { x: 200, y: 300, width: 100, height: 100 }).id);
  const box = () => boundsOf(e.getSnapshot().document, [id]);
  for (const [end, expected] of [[point(6, 352.4), point(-44.5, 302)], [point(260.3, 360.6), point(210, 311)]]) {
    expect(move.down(point(250, 350), none)).toBe(true); move.move(end, none); move.up(end, none);
    expect(box()).toMatchObject(expected); e.execute("edit.undo");
  }
  expect(resize.down(point(200, 350))).toBe(true); resize.move(point(6, 350), none); resize.up();
  expect(box()).toMatchObject({ x: 5.5, width: 294.5 }); e.execute("edit.undo");
  expect(resize.down(point(250, 400))).toBe(true); resize.move(point(250, 450.6), none); resize.up();
  expect(box()).toMatchObject({ width: 100, height: 151 });
});

for (const kind of ["rectangle", "ellipse", "polygon", "star", "arrow", "line"]) {
  it(`preserves the fractional target and rounds the free axis when drawing ${kind}`, () => {
    const e = scene(), draw = new DrawInteraction(e, fail);
    e.execute(`tool.${kind}`); expect(draw.down(point(30.4, 95.6))).toBe(true);
    const end = point(6.2, 60.4);
    for (const [mod, target] of [[none, 5.5], [{ ...none, ctrlKey: true }, 6], [{ ...none, metaKey: true }, 6]] as const) {
      draw.move(end, mod);
      const d = e.getRenderDocument(), id = e.getRenderSelection()[0], n = d.nodes[id];
      if (kind === "arrow" || kind === "line") {
        if (n.kind !== "line") throw new Error("Expected Line geometry");
        const matrix = worldTransform(d, id), b = transformPoint(matrix, point(n.width, 0));
        expect(b.x).toBeCloseTo(target); expect(b.y).toBeCloseTo(60);
        expect(transformPoint(matrix, point(0, 0))).toEqual(point(30, 96));
      } else expect(boundsOf(d, [id])).toMatchObject({ x: target, y: 60, width: 30 - target, height: 36 });
    }
    draw.cancel();
  });
}

it("tests the capture radius after rounding the pointer", () => {
  const e = new EditorEngine(), draw = new DrawInteraction(e, fail);
  e.execute("shape.rectangle", { x: 100.25, y: 100, width: 10, height: 10 });
  e.execute("tool.rectangle"); draw.down(point(20, 20));
  const end = point(95.3, 50.4);
  draw.move(end, none);
  // 95.3 lies within 5px of 100.25, but the rounded point (95) lies outside.
  expect(boundsOf(e.getRenderDocument(), e.getRenderSelection())).toMatchObject({ width: 75, height: 30 });
  draw.cancel(); e.execute("view.snapPixel", { on: false }); draw.down(point(20, 20)); draw.move(end, none);
  expect(boundsOf(e.getRenderDocument(), e.getRenderSelection())).toMatchObject({ width: 80.25, height: 30.4 });
  draw.cancel();
});
