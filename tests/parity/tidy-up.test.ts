import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-tidy-up.json";
import { EditorEngine } from "../../src/engine/editor";
import { canTidy } from "../../src/engine/tidy";

// Tidy up keeps the order and the sizes, keeps the first layer where it is and evens one gap per axis, observed
// through the native engine at bad07e44 (upstream cfd6bf52, d3f7ae90, a7a9e627, 1a68ded5;
// tests/fixtures/native-tidy-up.provenance.md). The layouts restate crates/engine/src/tidy_tests.rs.

const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: (Record<string, unknown> | null)[] }[];
function replay(name: string, upTo?: string) {
  const c = cases.find(x => x.name === name)!, engine = new EditorEngine();
  for (const [command, params] of c.commands) { if (command === upTo) break; engine.execute(command, params); }
  return engine;
}

describe("native Tidy up", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if (expected && "error" in expected) {
        const before = engine.getSnapshot();
        expect(() => engine.execute(command, params), why).toThrow(/spacing out of range/i);
        expect(engine.getSnapshot(), why).toBe(before);
      } else if (command === "node.get" && expected === null) expect(engine.getSnapshot().document.nodes[String(params.id)], why).toBeUndefined();
      else {
        const actual = engine.execute(command, params);
        if (command === "node.get") expect(actual, why).toEqual(expected);
      }
    }
  });

  // crates/engine/src/tidy_tests.rs: `can` beside each layout.
  it("is offered for a row, a column, a chain and a grid, and not otherwise", () => {
    const can = (name: string) => { const engine = replay(name, "arrange.tidy"); return canTidy(engine.getSnapshot().document, Object.keys(engine.getSnapshot().document.nodes).filter(id => id !== "1")); };
    for (const name of ["a row keeps its order, sizes and Y and evens the gaps", "a column keeps X and evens the vertical gaps", "a tidy that moves nothing", "an overlapping pair's negative gap counts",
      "a row whose layers overlap in a chain", "a grid is tidied by columns", "a transposed grid is tidied by rows", "a two by two grid"]) expect(can(name), name).toBe(true);
    for (const name of ["two layers are left alone", "an overlapping triple is left alone", "layers on a diagonal are left alone", "a grid with an empty place is left alone",
      "an irregular selection is left alone", "spacing takes two layers"]) expect(can(name), name).toBe(false);
  });

  it("is not offered for layers in an auto layout flow until they are absolute", () => {
    const engine = replay("layers in an auto layout flow are left alone until they are absolute", "arrange.tidy");
    expect(canTidy(engine.getSnapshot().document, ["3", "4", "5"])).toBe(false);
    for (const id of [3, 4, 5]) engine.execute("node.set", { id, props: { absolute: true } });
    [0, 60, 160].forEach((x, i) => engine.execute("node.set", { id: 3 + i, props: { x, y: 0 } }));
    expect(canTidy(engine.getSnapshot().document, ["3", "4", "5"])).toBe(true);
  });
});
