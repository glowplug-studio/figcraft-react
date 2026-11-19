import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-vector-point-position.json";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { executeVectorEdit } from "../../src/engine/vector-edit-commands";
import { freezeNetwork } from "../../src/engine/vector-network";

// `vector.edit.position` with several points: a number sets every selected point's own coordinate and `{add}`,
// `{mul}`, `{div}` apply to each point's own, observed through the native engine at bad07e44 (upstream 6ac20c7d,
// 8edcc02a, dc841f85; tests/fixtures/native-vector-point-position.provenance.md). The sequences restate
// crates/engine/src/canvas/vectoredit/position_tests.rs.

type Wire = { vertices: { x: number; y: number; radius: number }[]; segments: { a: number; b: number; ta: number[]; tb: number[] }[]; regions: { loops: number[][] }[] };
const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: Record<string, unknown>[] }[];

describe("native point positions in vector edit mode", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if (command === "vector.edit.state") {
        const node = engine.getSnapshot().document.nodes["2"] as VectorNode, wire = expected.network as Wire;
        expect(node.network.vertices.length, why).toBe(wire.vertices.length);
        node.network.vertices.forEach((v, k) => { expect(v.x, `${why}: x of point ${k}`).toBeCloseTo(wire.vertices[k].x, 9); expect(v.y, `${why}: y of point ${k}`).toBeCloseTo(wire.vertices[k].y, 9); });
        node.network.segments.forEach((s, k) => [...s.ta, ...s.tb].forEach((value, j) => expect(value, `${why}: handle ${j} of segment ${k}`).toBeCloseTo([...wire.segments[k].ta, ...wire.segments[k].tb][j], 9)));
        expect(node.network.regions.map(r => r.loops), why).toEqual(wire.regions.map(r => r.loops));
        continue;
      }
      if ("error" in expected) {
        const before = engine.getSnapshot();
        expect(() => engine.execute(command, params), why).toThrow();
        expect(engine.getSnapshot(), `${why}: a refused edit changes nothing and leaves no undo step`).toBe(before);
        continue;
      }
      const actual = engine.execute(command, params) as Record<string, unknown>;
      if (command === "node.get") expect(actual, why).toEqual(expected);
    }
  });

  it("names what was wrong, as native does", () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100 }); engine.execute("vector.edit.begin", { id: 2 });
    expect(() => engine.execute("vector.edit.position", { x: 5 })).toThrow(/select points/i);
    engine.execute("vector.edit.select", { vertices: [0, 1] });
    expect(() => engine.execute("vector.edit.position", { x: { pow: 2 } })).toThrow(/`x` must be a number or \{add\|mul\|div: number\}/);
    expect(() => engine.execute("vector.edit.position", { x: 5, y: { div: 0 } })).toThrow(/`y` must be a number or \{add\|mul\|div: number\}/);
    expect(() => engine.execute("vector.edit.position", { x: { mul: 1e308 } })).toThrow(/the result is not a number/i);
  });

  // position_tests.rs::moving_every_point_by_one_offset_carries_the_regions_paint_frame, with the paint frame placed
  // on the region directly as the native test places it.
  it("carries the regions' paint frames when every point moves by one offset, and not when offsets differ", () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100 });
    const begun = executeVectorEdit("vector.edit.begin", engine.getSnapshot().document, ["2"], undefined, { id: 2 });
    const node = begun.document.nodes["2"] as VectorNode;
    const network = freezeNetwork({ ...node.network, regions: node.network.regions.map(r => ({ ...r, paintSpace: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] as const } })) });
    const document = { ...begun.document, nodes: { ...begun.document.nodes, "2": Object.freeze({ ...node, network }) } } as typeof begun.document;
    const frame = (doc: typeof document) => { const n = doc.nodes["2"] as VectorNode, t = n.network.regions[0].paintSpace!.transform; return [t[0], t[1], t[2], t[3], t[4] + n.x, t[5] + n.y]; };
    const all = executeVectorEdit("vector.edit.select", document, ["2"], begun.state, { vertices: [0, 1, 2, 3] }).state;
    const moved = executeVectorEdit("vector.edit.position", document, ["2"], all, { x: { add: 10 } });
    expect(frame(moved.document)).toEqual([1, 0, 0, 1, 10, 0]);
    expect(moved.recordHistory).toBe(true);
    // Two points set to one x move by different offsets: the frame stays where it was.
    const two = executeVectorEdit("vector.edit.select", document, ["2"], begun.state, { vertices: [0, 1] }).state;
    expect(frame(executeVectorEdit("vector.edit.position", document, ["2"], two, { x: -200 }).document)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
