import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft, decodeFigcraft } from "../../src/engine/file-format";
import recorded from "../fixtures/native-export-settings.json";
import aliases from "../fixtures/native-export-setting-aliases.json";

// node.set takes the camelCase keys of an export setting since upstream 6c3ac0c5, where the fixture's native revision
// dropped them. The one sequence that sets them is compared with its receipts and saved settings observed at bad07e44
// (tests/fixtures/native-export-setting-aliases.provenance.md).
const repinned = new Map(aliases.repinned.map(c => [c.name, c]));
const cases = recorded.map(entry => ({ ...entry, ...(repinned.get(entry.name) && { results: repinned.get(entry.name)!.results, wire: repinned.get(entry.name)!.wire }) }));

it.each(cases)("preserves native export settings, errors and archive fields for $name", async entry => {
  const engine = new EditorEngine();
  const results: Record<string, unknown> = entry.results;
  for (const [i, [command, input]] of entry.commands.entries()) {
    const expected = results[i], run = () => engine.execute(String(command), input);
    if (typeof expected === "object" && expected && "error" in expected) {
      const before = engine.getSnapshot().document;
      expect(run).toThrow(String(expected.error).replace(/^invalid parameters for .+?: /, ""));
      expect(engine.getSnapshot().document).toBe(before);
    } else if (expected !== undefined) expect(run()).toEqual(expected);
    else run();
  }
  const doc = engine.getSnapshot().document;
  const loaded = (await decodeFigcraft(await encodeFigcraft(doc))).document;
  for (const d of [doc, loaded]) {
    expect(d.nodes["2"].exports ?? []).toEqual(entry.wire);
    expect(d.nodes["1"].exports ?? []).toEqual(entry.pageWire);
  }
});
