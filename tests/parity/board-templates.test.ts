import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints } from "../../src/engine/document";
import native from "../fixtures/native-board-templates.json" with { type: "json" };

// Board templates and the board grid against native at bad07e44 (tests/fixtures/native-board-templates.provenance.md). Text heights, and
// what follows from them (a sticky's height, a shape's text centring, a label's size), are left out: native's headless engine measures no text.
function near(a: unknown, b: unknown, path = ""): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length ${a.length} ≠ ${b.length}` : a.map((x, i) => near(x, b[i], `${path}/${i}`)).find(Boolean);
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`)).find(Boolean);
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}
type Node = Record<string, unknown> & { kind: string; name: string; board?: { type: string } };
const templates = native.templates as unknown as Record<string, { receipt: { receipt: unknown }; document: unknown }>;

describe("board templates and the grid, as native has them", () => {
  for (const [name, t] of Object.entries(templates)) {
    it(`places the ${name} template as native does`, async () => {
      const e = EditorEngine.newTab(undefined, {}, "board");
      expect(await e.executeAsync("board.template", { name, x: 0, y: 0 })).toEqual(t.receipt.receipt);
      const want = (await decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(t.document)) }))).document, got = e.getSnapshot().document;
      const problems: string[] = [];
      for (const [id, w] of Object.entries(want.nodes) as unknown as [string, Node][]) {
        const g = got.nodes[id] as unknown as Node | undefined;
        if (!g) { problems.push(`node ${id} missing`); continue; }
        if (w.kind === "page") continue;
        const keys = w.kind === "text" ? ["name", "parent"] : w.board?.type === "connector" ? ["name", "parent", "board"] : w.board?.type === "label" ? ["name", "parent", "board"]
          : ["name", "parent", "children", "board", "x", "width", ...(w.board?.type === "sticky" ? ["y"] : ["y", "height"])];
        for (const k of keys) { const why = near(g[k], w[k], `node ${id} (${w.name})/${k}`); if (why) problems.push(why); }
        if (w.kind !== "text") { const why = near(rectanglePaints(g as never), rectanglePaints(w as never), `node ${id} (${w.name})/fills`); if (why) problems.push(why); }
      }
      for (const id of Object.keys(got.nodes)) if (!want.nodes[id]) problems.push(`node ${id} is extra`);
      expect(problems).toEqual([]);
    });
  }

  it("lists the templates, finds one by name, refuses others, and keeps the grid as native does", async () => {
    const { commands, results } = native.misc as unknown as { commands: [string, Record<string, unknown>][]; results: ({ receipt: unknown } | { error: string })[] };
    const e = EditorEngine.newTab(undefined, {}, "board");
    for (const [i, [c, p]] of commands.slice(1).entries()) {
      const want = results[i + 1];
      if ("error" in want) await expect(e.executeAsync(c, p), c).rejects.toThrow(want.error);
      else expect(await e.executeAsync(c, p), `${c} ${JSON.stringify(p)}`).toEqual(want.receipt);
    }
  });
});
