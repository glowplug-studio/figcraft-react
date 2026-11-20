import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-paste-placement.json";
import { EditorEngine } from "../../src/engine/editor";

// Paste over a selection puts the copies just above the selected layer, and paste lands in place, at the view's
// centre or in a selected frame's centre, observed through the native engine at bad07e44 (upstream c74bcd0b,
// 476daeab; tests/fixtures/native-paste-placement.provenance.md). The sequences restate
// crates/engine/src/tests.rs::paste_over_puts_the_copies_just_above_the_selected_layer and the placement cases of
// crates/engine/src/design_paste_tests.rs.

const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: (Record<string, unknown> | null)[] }[];
const ids = (value: unknown) => (value as unknown[]).map(Number);

describe("native paste placement and stacking", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    // The native session starts with a 1,280 by 720 view centred on the origin's quadrant, as `view.set` leaves it.
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      const actual = engine.execute(command, params) as Record<string, unknown>;
      if (command === "node.get") expect(actual, why).toEqual(expected);
      else if (command.startsWith("edit.paste")) {
        // Native returns layer ids as numbers; the port's receipts return strings (final audit).
        expect(ids(actual.ids), why).toEqual(ids(expected!.ids));
        expect(engine.getSnapshot().selection.map(Number), `${why}: the copies are selected`).toEqual(ids(expected!.ids));
      }
    }
  });
});
