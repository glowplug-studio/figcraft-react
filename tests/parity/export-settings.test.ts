import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft, decodeFigcraft } from "../../src/engine/file-format";
import cases from "../fixtures/native-export-settings.json";

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
