import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { rasterExportPlan } from "../../src/engine/export-area";
import cases from "../fixtures/native-png-exports.json";

it.each(cases)("matches native raster sizing or error for $name", ({ commands, width, height, error }) => {
  const engine = new EditorEngine();
  for (const entry of commands.slice(0, -1)) engine.execute(String(entry[0]), entry[1]);
  const {document, selection} = engine.getSnapshot();
  const plan = () => rasterExportPlan(document, selection, commands.at(-1)![1] as Record<string, unknown>);
  if (error) {
    const message = error.replace(/^invalid parameters for .+?: /, "").replace(/^command .+?right now: /, "");
    expect(plan).toThrow(message);
  } else expect(plan()).toMatchObject({ width, height });
});
