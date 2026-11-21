import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-zoom-selection.json";
import { EditorEngine } from "../../src/engine/editor";

// Zoom to selection fits the selection into the canvas above the floating bottom toolbar with a 40 point margin on
// every side, centred in that area. Observed through the native engine at bad07e44 (upstream fceb6063, 5d529269,
// 53bf0a40; tests/fixtures/native-zoom-selection.provenance.md). The sequences restate
// crates/engine/src/view_behaviour_tests.rs.

type Receipt = Record<string, unknown>;
const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: Receipt[] }[];
const nine = (value: unknown) => Math.round(Number(value) * 1e9) / 1e9;
const placed = (view: Receipt) => ({ zoom: nine(view.zoom), cx: nine(view.cx), cy: nine(view.cy), vw: nine(view.vw), vh: nine(view.vh) });

describe("native zoom to selection", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    let zoomed = false;
    for (const [i, [command, params]] of c.commands.entries()) {
      const actual = engine.execute(command, params) as Receipt, expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if (command === "view.zoomSelection" || command === "view.zoomFit") { expect(nine(actual.zoom), why).toBe(nine(expected.zoom)); zoomed = true; }
      // A fresh view's centre differs between the two engines; the view is compared once a zoom command has placed it.
      else if (command === "view.get" && zoomed) expect(placed(actual), why).toEqual(placed(expected));
      if (command === "view.get") expect(Object.keys(actual), `${why}: the inset is not read back`).not.toContain("bottomInset");
    }
  });
});
