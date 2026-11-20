import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-command-refusals.json";
import { EditorEngine } from "../../src/engine/editor";
import type { LayerNode } from "../../src/engine/document";

// Commands refuse a malformed parameter where they used to fall back to a default or act on something else.
// Observed through the native engine at bad07e44 (upstream 04a6c76a, 0ff3a368, 82da8f51, 10d97e27, 6222fce8,
// db1bec08, 386c6c1d; tests/fixtures/native-command-refusals.provenance.md).

type Receipt = Record<string, unknown>;
const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: Receipt[] }[];
const compared = new Set(["node.get", "file.export", "image.savePreset"]);

describe("native command parameter refusals", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if ("error" in expected) {
        const before = engine.getSnapshot();
        await expect(engine.executeAsync(command, params), why).rejects.toThrow();
        expect(engine.getSnapshot().document, `${why}: a refused command changes nothing`).toBe(before.document);
      } else {
        const actual = await engine.executeAsync(command, params).catch((error: unknown) => { throw new Error(`${why}: ${String(error)}`); });
        if (compared.has(command)) expect(actual, why).toEqual(expected);
      }
    }
  });

  it("names what was wrong, as native does", async () => {
    const engine = new EditorEngine(), refused = (command: string, params: Record<string, unknown>) => expect(engine.executeAsync(command, params)).rejects;
    const frame = String(engine.execute("frame.create", { x: 0, y: 0, width: 300, height: 300 }).id);
    const rect = String(engine.execute("shape.rectangle", { x: 400, y: 0, width: 50, height: 50 }).id);
    await refused("node.set", { ids: [rect], props: { miterLimit: "abc" } }).toThrow(/miterLimit must be a number/);
    await refused("node.set", { ids: [rect], props: { cornerSmoothing: null } }).toThrow(/cornerSmoothing must be a number/);
    await refused("node.reparent", { ids: [rect], parent: frame, index: -1 }).toThrow(/index out of range/);
    await refused("node.reparent", { ids: [rect], parent: frame, index: "x" }).toThrow(/index must be a number/);
    await refused("export.add", { ids: [rect], setting: { size: "+2x" } }).toThrow(/size: 2x, 512w or 512h/);
    await refused("file.export", { ids: ["abc"], format: "svg" }).toThrow(/ids: every entry must be a node id \(got "abc"\)/);
    await refused("file.export", { id: "abc", format: "svg" }).toThrow(/id must be a node id \(got "abc"\)/);
    await refused("file.export", { ids: "2", format: "svg" }).toThrow(/ids must be an array \(got "2"\)/);
    await refused("file.exportLayers", { ids: [99] }).toThrow(/no such node 99/i);
  });

  // crates/engine/src/cmd/props.rs: an accepted paragraph value is kept at zero or above. Native has no `node.get`
  // field for the two, so the stored values restate the source, not an observation.
  it("keeps an accepted paragraph value at zero or above", async () => {
    const engine = new EditorEngine(), id = String((await engine.executeAsync("text.create", { text: "Hi", x: 0, y: 100 })).id);
    const text = () => (engine.getSnapshot().document.nodes[id] as LayerNode & { kind: "text" }).text;
    engine.execute("node.set", { ids: [id], props: { paragraphSpacing: "9", paragraphIndent: 4 } });
    expect([text().paragraphSpacing, text().paragraphIndent]).toEqual([9, 4]);
    engine.execute("node.set", { ids: [id], props: { paragraphIndent: -3 } });
    expect(text().paragraphIndent).toBe(0);
    expect(() => engine.execute("node.set", { ids: [id], props: { paragraphSpacing: "abc" } })).toThrow(/paragraphSpacing must be a number/);
    expect([text().paragraphSpacing, text().paragraphIndent]).toEqual([9, 0]);
  });
});
