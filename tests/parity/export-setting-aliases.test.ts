import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-export-setting-aliases.json";
import { EditorEngine } from "../../src/engine/editor";

// node.set takes back the export settings node.get returns, and the snake_case spellings of their two-word fields.
// Observed through the native engine at bad07e44 (upstream 6c3ac0c5, 3f39154a;
// tests/fixtures/native-export-setting-aliases.provenance.md).

type Params = Record<string, unknown>;
const cases = fixture.cases as unknown as { name: string; commands: [string, Params][]; exports: (unknown[] | null)[] }[];

describe("export settings read and written back", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const why = `${command} ${JSON.stringify(params)} (step ${i})`;
      const receipt = await engine.executeAsync(command, params).catch((error: unknown) => { throw new Error(`${why}: ${String(error)}`); }) as Params;
      if (command === "node.get") expect(receipt.exports ?? [], why).toEqual(c.exports[i]);
    }
  });
});
