import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints } from "../../src/engine/document";
import native from "../fixtures/native-board-stamps.json" with { type: "json" };

// Stamps and ink against native at bad07e44 (tests/fixtures/native-board-stamps.provenance.md): the six stamps and their marks, a stamp on
// nothing, ink and a highlighter stroke, and stamps carried by the sticky they sit on.
function near(a: unknown, b: unknown, path = ""): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length ${a.length} ≠ ${b.length}` : a.map((x, i) => near(x, b[i], `${path}/${i}`)).find(Boolean);
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`)).find(Boolean);
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}
type Node = Record<string, unknown> & { board?: { type: string }; kind: string; parent?: string };

describe("stamps and ink, as native makes them", () => {
  it("replays native's run", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const cs = native.commands as unknown as [string, Record<string, unknown>][], rs = native.results as unknown as ({ receipt: unknown } | { error: string })[];
    for (const [i, [c, p]] of cs.slice(1).entries()) {
      const want = rs[i + 1];
      if ("error" in want) await expect(e.executeAsync(c, p), c).rejects.toThrow(want.error);
      else { const got = await e.executeAsync(c, p); if (c !== "node.set") expect(got, `${c} ${JSON.stringify(p)}`).toEqual(want.receipt); }
    }
    const want = (await decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(native.document)) }))).document, got = e.getSnapshot().document;
    const problems: string[] = [];
    for (const [id, w] of Object.entries(want.nodes) as unknown as [string, Node][]) {
      const g = got.nodes[id] as unknown as Node | undefined;
      if (!g) { problems.push(`node ${id} missing`); continue; }
      const stamp = w.board?.type === "stamp", ink = w.board?.type === "ink", mark = w.parent !== undefined && (want.nodes[w.parent] as unknown as Node)?.board?.type === "stamp";
      const keys = stamp ? ["board", "name", "x", "y", "width", "height", "corners", "effects", "clip"] : ink ? ["board", "name", "network", "x", "y", "width", "height", "opacity", "blend", "stroke", "strokes"] : mark ? ["name", "network", "stroke", "strokes", "width", "height"] : [];
      for (const k of keys) { const why = near(g[k], w[k], `node ${id}/${k}`); if (why) problems.push(why); }
      if (stamp || mark) { const why = near(rectanglePaints(g as never), rectanglePaints(w as never), `node ${id}/fills`); if (why) problems.push(why); }
    }
    expect(problems).toEqual([]);
  });

  it("sits a stamp moved by itself on what is under it, and on nothing when its object goes", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const a = (await e.executeAsync("board.sticky", { x: 0, y: 0, text: "A" }) as { id: number }).id;
    const b = (await e.executeAsync("board.sticky", { x: 400, y: 0, text: "B" }) as { id: number }).id;
    const s = (await e.executeAsync("board.stamp", { x: 100, y: 100, stamp: "star" }) as { id: number }).id;
    const on = () => (e.getSnapshot().document.nodes[String(s)] as unknown as { board: { on?: string } }).board.on;
    expect(on()).toBe(String(a));
    await e.executeAsync("node.set", { id: s, props: { x: 480, y: 80 } });
    expect(on()).toBe(String(b));
    await e.executeAsync("edit.delete", { ids: [b] });
    expect(on()).toBeUndefined();
  });
});
