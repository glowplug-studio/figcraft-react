import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { inverse, multiply, rotationDegrees, transformPoint } from "../../src/engine/affine";
import { layerTransform, type LayerNode } from "../../src/engine/document";
import { worldTransform } from "../../src/engine/hierarchy";
import { boundsOf } from "../../src/engine/viewport";
import { localOrigin, originBoxPoints, selectionFrame, snappedOrigin } from "../../src/engine/rotation";
import { decodeFigcraft } from "../../src/engine/file-format";

const make = (engine: EditorEngine, params: Record<string, unknown> = {}) => String(engine.execute("shape.rectangle", params).id);
const layer = (engine: EditorEngine, id: string) => engine.getSnapshot().document.nodes[id] as LayerNode;
function near(actual: { x: number; y: number } | undefined, expected: { x: number; y: number }) {
  expect(actual?.x).toBeCloseTo(expected.x, 8); expect(actual?.y).toBeCloseTo(expected.y, 8);
}

describe("native rotation origins and transforms", () => {
  it("keeps origin editing outside document history and root subscriptions", () => {
    const engine = new EditorEngine(); make(engine); engine.execute("file.markSaved");
    const before = engine.getSnapshot(); let roots = 0, origins = 0;
    engine.subscribe(() => roots++); engine.subscribeOrigin(() => origins++);
    expect(engine.execute("transform.rotationOrigin")).toEqual({ editing: true, moved: false, x: 50, y: 50 });
    engine.dragRotationOrigin({ x: 3, y: 2 }, 1);
    expect(engine.getRotationOrigin()).toMatchObject({ moved: true, point: { x: 0, y: 0 } });
    expect(engine.getSnapshot()).toBe(before); expect(roots).toBe(0); expect(origins).toBe(2);
    expect(engine.endOriginEdit()).toBe(true); expect(engine.endOriginEdit()).toBe(false);
    expect(engine.getSnapshot().dirty).toBe(false);
  });

  it("follows movement and undo until the ordered selection changes", () => {
    const engine = new EditorEngine(), id = make(engine);
    engine.execute("transform.rotationOrigin", { on: true }); engine.execute("transform.setRotationOrigin", { x: 0, y: 0 });
    engine.execute("transform.move", { dx: 10, dy: 20 }); near(engine.getRotationOrigin().point, { x: 10, y: 20 });
    engine.execute("edit.undo"); near(engine.getRotationOrigin().point, { x: 0, y: 0 });
    engine.execute("select.set", { ids: [id] }); expect(engine.getRotationOrigin().moved).toBe(true);
    engine.execute("select.set", { ids: [] }); engine.execute("select.set", { ids: [id] });
    expect(engine.getRotationOrigin()).toMatchObject({ editing: false, moved: false, point: { x: 50, y: 50 } });
    const other = make(engine, { x: 200 }); engine.execute("select.set", { ids: [id, other] });
    engine.execute("transform.setRotationOrigin", { x: 0, y: 0 }); engine.execute("select.set", { ids: [other, id] });
    expect(engine.getRotationOrigin().moved).toBe(false);
  });

  it("pins the native bottom-right fixture through rotation field, left90 and15 degrees", () => {
    const engine = new EditorEngine(), id = make(engine);
    engine.execute("transform.setRotationOrigin", { x: 100, y: 100 });
    engine.execute("node.set", { props: { rotation: 30 } });
    near(transformPoint(worldTransform(engine.getSnapshot().document, id), { x: 100, y: 100 }), { x: 100, y: 100 });
    engine.execute("object.rotateLeft"); engine.execute("transform.rotate", { degrees: 15 });
    near(transformPoint(worldTransform(engine.getSnapshot().document, id), { x: 100, y: 100 }), { x: 100, y: 100 });
    expect(rotationDegrees(layerTransform(layer(engine, id)))).toBeCloseTo(135);
    expect(engine.execute("transform.setRotationOrigin", { reset: true }).moved).toBe(false);
  });

  it("does not apply the selection origin to other targets or explicit x/y fields", () => {
    const engine = new EditorEngine(), a = make(engine), b = make(engine, { x: 300 });
    engine.execute("select.set", { ids: [a] }); engine.execute("transform.setRotationOrigin", { x: 0, y: 0 });
    engine.execute("node.set", { id: b, props: { rotation: 45 } });
    near(transformPoint(worldTransform(engine.getSnapshot().document, b), { x: 50, y: 50 }), { x: 350, y: 50 });
    engine.execute("object.rotateRight", { id: b });
    near(transformPoint(worldTransform(engine.getSnapshot().document, b), { x: 50, y: 50 }), { x: 350, y: 50 });
    engine.execute("node.set", { props: { rotation: 90, x: 20 } });
    expect(layer(engine, a).x).toBe(20);
  });

  it.each([["object.rotateLeft", 90], ["object.rotateRight", -90], ["object.rotate180", 180]] as const)("%s uses the native signed angle and one undo step", (command, degrees) => {
    const engine = new EditorEngine(), id = make(engine, { x: 20, y: 30, width: 80, height: 40 });
    const before = engine.getSnapshot(); engine.execute(command);
    expect(rotationDegrees(layerTransform(layer(engine, id)))).toBeCloseTo(degrees);
    near(transformPoint(worldTransform(engine.getSnapshot().document, id), { x: 40, y: 20 }), { x: 60, y: 50 });
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before.document);
  });

  it("uses independently optional page pivot coordinates and caller target ordering", () => {
    const engine = new EditorEngine(), a = make(engine), b = make(engine, { x: 200 });
    engine.execute("select.set", { ids: [a, b] }); engine.execute("transform.setRotationOrigin", { x: 0, y: 0 });
    engine.execute("transform.rotate", { degrees: 90, cx: 10 });
    near(transformPoint(worldTransform(engine.getSnapshot().document, a), { x: 0, y: 0 }), { x: 10, y: 10 });
    engine.execute("edit.undo");
    engine.execute("object.rotate180", { ids: [b, a] });
    near(transformPoint(worldTransform(engine.getSnapshot().document, a), { x: 50, y: 50 }), { x: 250, y: 50 });
  });

  it.each(["object.flipH", "object.flipV"])("%s reflects about page bounds and ignores moved origin", command => {
    const engine = new EditorEngine(), a = make(engine, { x: 20, y: 40, width: 30, height: 20 }), b = make(engine, { x: 120, y: 140, width: 50, height: 40 });
    engine.execute("select.set", { ids: [a, b] }); engine.execute("transform.setRotationOrigin", { x: -1000, y: -1000 });
    const before = engine.getSnapshot().document, box = boundsOf(before, [a, b])!;
    engine.execute(command);
    expect(boundsOf(engine.getSnapshot().document, [a, b])!.x).toBeCloseTo(box.x);
    expect(boundsOf(engine.getSnapshot().document, [a, b])!.y).toBeCloseTo(box.y);
    const centre = transformPoint(worldTransform(engine.getSnapshot().document, a), { x: 15, y: 10 });
    near(centre, command.endsWith("H") ? { x: 155, y: 50 } : { x: 35, y: 170 });
    engine.execute(command); near(transformPoint(worldTransform(engine.getSnapshot().document, a), { x: 0, y: 0 }), { x: 20, y: 40 });
  });

  it("rotates nested roots in world space without double-transforming selected descendants", () => {
    const engine = new EditorEngine(), frame = String(engine.execute("frame.create", { x: 200, y: 100, width: 200, height: 100, props: { rotation: 30 } }).id);
    const child = make(engine, { parent: frame, x: 20, y: 10, width: 50, height: 30 });
    engine.execute("select.set", { ids: [frame, child] }); engine.execute("transform.setRotationOrigin", { x: 100, y: 50 });
    const local = layerTransform(layer(engine, child)); engine.execute("object.rotateRight");
    expect(layerTransform(layer(engine, child))).toEqual(local);
    near(engine.getRotationOrigin().point, { x: 100, y: 50 });
    engine.execute("node.set", { props: { rotation: 60 } }); near(engine.getRotationOrigin().point, { x: 100, y: 50 });
  });

  it("snaps to nine oriented box points in screen pixels and centre resets", () => {
    const engine = new EditorEngine(), id = make(engine, { x: 100, y: 100, props: { rotation: 30 } });
    const doc = engine.getSnapshot().document, points = originBoxPoints(doc, [id])!;
    points.forEach((point, index) => {
      const snapped = snappedOrigin(doc, [id], { x: point.x + 2, y: point.y + 1 }, 2);
      if (index === 8) expect(snapped).toBeUndefined(); else near(snapped, point);
    });
    const outside = { x: points[0].x + 3, y: points[0].y };
    expect(snappedOrigin(doc, [id], outside, 2)).toBe(outside);
  });

  it("uses shared rotated selection axes including flipped layers, otherwise page axes", () => {
    const engine = new EditorEngine(), a = make(engine, { props: { rotation: 30 } }), b = make(engine, { x: 200, props: { rotation: 30 } });
    const doc = engine.getSnapshot().document, frame = selectionFrame(doc, [a, b])!;
    expect(rotationDegrees(frame.matrix)).toBeCloseTo(30);
    for (const id of [a, b]) {
      const local = multiply(inverse(frame.matrix), worldTransform(doc, id));
      expect(local[4]).toBeGreaterThanOrEqual(-1e-8); expect(local[5]).toBeGreaterThanOrEqual(-1e-8);
    }
    engine.execute("node.set", { id: b, props: { rotation: -150 } });
    expect(rotationDegrees(selectionFrame(engine.getSnapshot().document, [a, b])!.matrix)).toBeCloseTo(30);
    engine.execute("node.set", { id: b, props: { rotation: 60 } });
    expect(rotationDegrees(selectionFrame(engine.getSnapshot().document, [a, b])!.matrix)).toBe(0);
  });

  it("refuses invalid commands atomically and clears editing on lost edit access", () => {
    const engine = new EditorEngine(); expect(() => engine.execute("transform.rotationOrigin")).toThrow();
    make(engine); engine.execute("transform.setRotationOrigin", { x: 0, y: 0 });
    const before = engine.getSnapshot(), origin = engine.getRotationOrigin();
    for (const params of [{ x: 1 }, { x: Infinity, y: 0 }, { x: 0, y: 0, unknown: true }]) {
      expect(() => engine.execute("transform.setRotationOrigin", params)).toThrow(); expect(engine.getRotationOrigin()).toBe(origin);
    }
    expect(() => engine.execute("transform.rotate", { degrees: Infinity })).toThrow();
    expect(() => engine.execute("transform.rotate", { degrees: 90, cx: 1e308, cy: 1e308 })).toThrow();
    expect(engine.getSnapshot()).toBe(before);
    engine.execute("transform.rotationOrigin", { on: true }); engine.setEditable(false);
    expect(engine.getRotationOrigin()).toMatchObject({ editing: false, moved: false });
  });

  it("falls back to the default origin for singular transforms", () => {
    const engine = new EditorEngine(), id = make(engine), doc = engine.getSnapshot().document;
    const singular = { ...doc, nodes: { ...doc.nodes, [id]: { ...layer(engine, id), transform: [0, 0, 0, 0, 20, 30] as const } } };
    expect(localOrigin(singular, id, { x: 10, y: 20 })).toBeUndefined();
  });

  it("round-trips rotated and flipped geometry without persisting the origin", async () => {
    const engine = new EditorEngine(), id = make(engine);
    engine.execute("transform.rotationOrigin"); engine.execute("transform.setRotationOrigin", { x: 100, y: 100 }); engine.execute("object.rotateLeft"); engine.execute("object.flipH");
    const bytes = await engine.nativeSnapshot(), decoded = await decodeFigcraft(bytes);
    expect(worldTransform(decoded.document, id)).toEqual(worldTransform(engine.getSnapshot().document, id));
    const fresh = new EditorEngine(); await fresh.executeAsync("file.open", { data: Buffer.from(bytes).toString("base64") });
    fresh.execute("select.set", { ids: [id] }); expect(fresh.getRotationOrigin()).toMatchObject({ editing: false, moved: false });
  });
});
