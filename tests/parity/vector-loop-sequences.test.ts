import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-vector-loop-sequences.json";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { networkMirroring } from "../../src/engine/vector-network";

// Editor sequences for loops that close through a bridge, Flatten baking a vector's point radii, and mirror modes
// smoothing a sharp point, observed through the native engine at bad07e44 (upstream #1951, #2195, #2110;
// tests/fixtures/native-vector-loop-ops.provenance.md). The sequences restate
// crates/engine/src/canvas/vectoredit/tests.rs and crates/engine/src/vector_behaviour_tests.rs.

type Wire = { vertices: { x: number; y: number; radius: number; mirror?: string }[]; segments: { a: number; b: number; ta: number[]; tb: number[] }[]; regions: { loops: number[][]; winding: string }[] };
const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: (Record<string, unknown> | null)[] }[];

describe("native vector editing sequences", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const engine = new EditorEngine();
    let editing = "";
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} (step ${i})`;
      if (command === "vector.edit.state") {
        const node = engine.getSnapshot().document.nodes[editing] as VectorNode, wire = expected!.network as Wire;
        expect(node.network.regions.map(r => r.loops), `${why}: loops`).toEqual(wire.regions.map(r => r.loops));
        expect(node.network.regions.map(r => r.winding), `${why}: winding`).toEqual(wire.regions.map(r => r.winding));
        expect(node.network.segments.map(s => [s.a, s.b]), `${why}: segment ends`).toEqual(wire.segments.map(s => [s.a, s.b]));
        node.network.segments.forEach((s, k) => [...s.ta, ...s.tb].forEach((value, j) => expect(value, `${why}: handle ${j} of segment ${k}`).toBeCloseTo([...wire.segments[k].ta, ...wire.segments[k].tb][j], 7)));
        expect(node.network.vertices.length, `${why}: points`).toBe(wire.vertices.length);
        node.network.vertices.forEach((v, k) => {
          expect(v.x, `${why}: x of point ${k}`).toBeCloseTo(wire.vertices[k].x, 7); expect(v.y, `${why}: y of point ${k}`).toBeCloseTo(wire.vertices[k].y, 7);
          expect(v.radius, `${why}: radius of point ${k}`).toBe(wire.vertices[k].radius);
        });
        expect(node.network.vertices.map((_, k) => networkMirroring(node.network, k)), `${why}: mirroring`).toEqual(expected!.mirroring);
        continue;
      }
      if (command === "vector.edit.begin") editing = String(params.id);
      if (command === "file.exportSvg") {
        const svg = Buffer.from(String((await engine.executeAsync(command, params)).data), "base64").toString("utf8");
        expect(svg, why).toBe(expected!.svg);
        continue;
      }
      if (command === "node.get" && expected === null) { expect(engine.getSnapshot().document.nodes[String(params.id)], why).toBeUndefined(); continue; }
      const actual = engine.execute(command, params) as Record<string, unknown>;
      if (command === "node.get") expect(actual, why).toEqual(expected);
      // Native returns a new layer's id as a number; the port's creation receipts return a string (final audit).
      else if (expected && typeof expected.id === "number") expect(Number(actual.id), why).toBe(expected.id);
    }
  });
});
