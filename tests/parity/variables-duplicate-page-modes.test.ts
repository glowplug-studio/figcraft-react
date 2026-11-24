import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import native from "../fixtures/native-variables-duplicate-page-modes.json" with { type: "json" };

// Native variables_editor_tests.rs `duplicate_by_id_copies_that_variable_even_when_an_earlier_one_is_named_like_its_id` (815cbf9f)
// and the page mode a60cb1a6 sets with nothing selected, both observed natively at bad07e44.
it("variable.duplicate matches an exact id before a name, as native", () => {
  const e = new EditorEngine();
  let duplicated: unknown;
  for (const [command, params] of native.duplicate.commands as [string, Record<string, unknown>][]) {
    const r = e.execute(command, params) as { id?: string };
    if (command === "variable.duplicate") duplicated = r.id;
  }
  expect(duplicated).toBe(native.duplicate.duplicated);
  expect(e.execute("variable.list").variables.map(v => v.name)).toEqual(native.duplicate.names);
});

it("a mode set with no layers, nothing selected, goes to the page, as native", () => {
  const e = new EditorEngine();
  for (const [command, params] of native.pageModes.commands as [string, Record<string, unknown>][]) e.execute(command, params);
  const doc = e.getSnapshot().document;
  expect(doc.nodes[doc.currentPage].variableModes).toEqual(native.pageModes.variableModes);
});
