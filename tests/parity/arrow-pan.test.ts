import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-arrow-pan.json";
import { EditorEngine } from "../../src/engine/editor";

// With nothing selected an arrow key pans the view 64 screen pixels, and 320 with Shift; it was 20 and 200. Observed
// through the native engine at bad07e44 (upstream 75f54e0a, d036eb2f, 9f51517f;
// tests/fixtures/native-arrow-pan.provenance.md). The sequences restate the tests in crates/engine/src/cmd/view.rs.

const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: Record<string, unknown>[] }[];

describe("native arrow-key pan", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const actual = engine.execute(command, params), why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if (command === "view.pan") {
        expect(actual, why).toEqual(c.receipts[i]);
        expect({ cx: engine.getView().cx, cy: engine.getView().cy }, `${why}: the view moved`).toEqual(c.receipts[i]);
      }
    }
  });
});
