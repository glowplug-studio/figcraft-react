import { describe, expect, it } from "vitest";
import { layerTransform, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { readVectorNetwork, wireVectorNetwork } from "../../src/engine/vector-codec";
import { networkBounds } from "../../src/engine/vector-path";

const vector = (engine: EditorEngine, params: Record<string, unknown> = {}) => String(engine.execute("vector.create", params).id);
const node = (engine: EditorEngine, id: string) => engine.getSnapshot().document.nodes[id] as VectorNode;
describe("native vector creation and path replacement", () => {
  it("creates SVG, point and empty networks with native names, offsets and defaults", () => {
    const engine = new EditorEngine(), id = vector(engine, { path: "M5 5 L15 25", x: 10, y: 20, width: 20 });
    expect(node(engine, id)).toMatchObject({ kind: "vector", name: "Vector", x: 15, y: 25, width: 20, height: 40, fill: "#d9d9d9", stroke: { align: "center" } }); expect(node(engine, id).strokes).toBeUndefined();
    const alias = String(engine.execute("node.create", { type: "path", points: [[5, 5], [15, 5], [15, 25], ["10px", "20"]], closed: true }).id);
    expect(node(engine, alias).network.vertices).toHaveLength(4); expect(node(engine, alias).network.regions).toHaveLength(1);
    const open = vector(engine, { path: "M0 0 L20 0 L20 20Z", closed: false }); expect(node(engine, open).network.regions).toEqual([]); expect(node(engine, open).network.segments).toHaveLength(3);
    const empty = vector(engine, { select: false }); expect(node(engine, empty)).toMatchObject({ width: 100, height: 100, network: { vertices: [], segments: [], regions: [] } }); expect(engine.getSnapshot().selection).toEqual([open]);
  });
  it("matches all six upstream path replacement frame rows", () => {
    const rows: [Record<string, unknown>, readonly number[]][] = [[{}, [100, 50, 10, 20]], [{ width: 30, height: 10 }, [100, 50, 30, 10]], [{ w: 20 }, [100, 50, 20, 40]], [{ x: 0, y: 0 }, [5, 5, 10, 20]], [{ x: 10, height: 10 }, [15, 50, 5, 10]], [{ x: 10, y: 20, width: 20, height: 10 }, [15, 25, 20, 10]]];
    for (const [props, frame] of rows) {
      const engine = new EditorEngine(), id = vector(engine, { path: "M0 0 L1 1", x: 100, y: 50 });
      engine.execute("node.set", { props: { path: "M5 5 L15 5 L15 25 Z", ...props } }); const n = node(engine, id);
      expect([n.x, n.y, n.width, n.height]).toEqual(frame); expect(n.network.vertices).toHaveLength(3);
    }
  });
  it("retains identity, order, paints, transforms and constraints, with atomic undo", () => {
    const engine = new EditorEngine(); vector(engine, { path: "M0 0 L5 5" });
    const id = vector(engine, { name: "Chart line", path: "M0 0 L10 10", x: 40, y: 30, props: { stroke: "#00ff00", strokeWeight: 3, opacity: .5, rotation: 90, constraints: { horizontal: "right", vertical: "bottom" } } });
    vector(engine, { path: "M0 0 L5 5" }); const before = engine.getSnapshot().document, original = node(engine, id);
    engine.execute("node.set", { id, props: { path: "M0 0 L20 0 L20 8Z" } }); const next = engine.getSnapshot().document, n = node(engine, id);
    expect(n).toMatchObject({ id, name: "Chart line", width: 20, height: 8, stroke: original.stroke, strokes: original.strokes, opacity: .5, constraints: original.constraints }); expect(layerTransform(n)).toEqual(layerTransform(original));
    expect(next.nodes["1"]).toEqual(before.nodes["1"]);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before); engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(next);
  });
  it("rejects invalid data without partial changes and reports non-vector mixed targets", () => {
    const engine = new EditorEngine(), id = vector(engine, { path: "M0 0 L10 10" }), before = engine.getSnapshot();
    for (const props of [{ path: "not a path" }, { path: "M0 0 L10" }, { path: "" }, { path: "M5 5" }, { path: 5 }, { path: null }, { path: "M0 0 L10 10", width: 0 }, { path: "M0 0 L10 10", name: "renamed", height: -1 }, { path: "M0 0 L10 0", height: 5 }]) {
      expect(() => engine.execute("node.set", { id, props })).toThrow(); expect(engine.getSnapshot()).toBe(before);
    }
    const box = String(engine.execute("shape.rectangle", { name: "Box" }).id);
    expect(() => engine.execute("node.set", { id: box, props: { path: "M0 0 L5 5" } })).toThrow(/Box.*vector/);
    const result = engine.execute("node.set", { ids: [box, id], props: { path: "M0 0 L30 0", opacity: .5 } });
    expect(result.warnings).toEqual([expect.stringContaining("`path` skipped on")]); expect(result.warnings).toEqual([expect.stringContaining("Box")]); expect(node(engine, box)).toMatchObject({ width: 100, opacity: .5 }); expect(node(engine, id)).toMatchObject({ width: 30, height: 0, opacity: .5 });
    engine.execute("node.set", { id, props: { path: "M0 0 L10 10", width: 20, w: "ignored" } }); expect(node(engine, id).width).toBe(20);
  });
  it("rescales networks through properties, anchored sizing, frame constraints and Scale", () => {
    const engine = new EditorEngine(), frame = String(engine.execute("frame.create", { width: 100, height: 100 }).id);
    const id = vector(engine, { parent: frame, path: "M0 0 L100 0 L100 100 L0 100Z", props: { cornerRadius: 20, constraints: { horizontal: "scale", vertical: "scale" } } });
    engine.execute("node.set", { id, props: { width: 200 } }); expect(node(engine, id).network.vertices[1].x).toBe(200); expect(node(engine, id).network.vertices[0].radius).toBe(20);
    engine.execute("transform.resize", { ids: [id], width: 100, height: 50, anchor: "br" }); expect(networkBounds(node(engine, id).network)).toMatchObject({ width: 100, height: 50 });
    engine.execute("transform.resize", { ids: [frame], width: 200, height: 200 }); expect(node(engine, id).network.vertices[1].x).toBe(200);
    engine.execute("transform.scale", { ids: [id], factor: 2 }); expect(node(engine, id).network.vertices[1].x).toBe(400); expect(node(engine, id).network.vertices[0].radius).toBe(40);
  });
  it("round-trips the current native vector model through real archive encoding", async () => {
    const engine = new EditorEngine(); vector(engine, { path: "M0 0 C10 0 20 10 20 20", props: { stroke: "red", brush: "dots", widthProfile: "eye" } });
    const document = engine.getSnapshot().document; expect((await decodeFigcraft(await encodeFigcraft(document))).document).toEqual(document);
  });
  it("applies dimension aliases sequentially, retaining the native zero-axis resize behaviour", () => {
    const engine = new EditorEngine(), id = vector(engine, { path: "M0 0L100 100" });
    engine.execute("node.set", { id, props: { w: 0, width: 100 } });
    expect(node(engine, id).width).toBe(100); expect(node(engine, id).network.vertices[1]).toMatchObject({ x: 0, y: 100 });
  });
});
describe("raw native VectorNetwork metadata", () => {
  it("retains point overrides, explicit empty region paint and invalid frames/references", () => {
    const raw = { vertices: [{ x: 0, y: 0, radius: -2, mirror: "angle", cap: "lineArrow", join: "round" }], segments: [{ a: 0, b: 9, ta: [2, 3], tb: [0, 0] }], regions: [{ loops: [[0, 99]], winding: "evenOdd", fills: [], paint_space: { width: -1, height: 0, transform: [0, 0, 0, 0, 1, 2] } }] };
    expect(wireVectorNetwork(readVectorNetwork(raw))).toEqual(raw);
    expect(readVectorNetwork({ vertices: [{ x: 0, y: 0 }], segments: [{ a: 0, b: 0 }] })).toEqual({ vertices: [{ x: 0, y: 0, radius: 0 }], segments: [{ a: 0, b: 0, ta: [0, 0], tb: [0, 0] }], regions: [] });
  });
  it("refuses malformed serde numbers, arrays, indices and styles", () => {
    for (const raw of [{}, { vertices: [], segments: null }, { vertices: [{ x: "0", y: 0 }], segments: [] }, { vertices: [{ x: 0, y: 0, radius: null }], segments: [] }, { vertices: [], segments: [{ a: -.5, b: 0 }] }, { vertices: [], segments: [{ a: 0, b: 0, ta: [0] }] }, { vertices: [{ x: 0, y: 0, mirror: "smooth" }], segments: [] }, { vertices: [], segments: [], regions: [{ loops: [], winding: null }] }]) expect(() => readVectorNetwork(raw)).toThrow();
  });
});
