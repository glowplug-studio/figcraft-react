import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints } from "../../src/engine/document";
import { spreadsheetCells } from "../../src/engine/board-table";
import native from "../fixtures/native-board-tables.json" with { type: "json" };

// Tables against native at bad07e44 (tests/fixtures/native-board-tables.provenance.md), and native's spreadsheet paste and resize rules
// restated from board_table.rs and board_tables_tests.rs. Text heights are left out: native's headless engine measures none.
function near(a: unknown, b: unknown, path = ""): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length ${a.length} ≠ ${b.length}` : a.map((x, i) => near(x, b[i], `${path}/${i}`)).find(Boolean);
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`)).find(Boolean);
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}
type Node = Record<string, unknown> & { kind: string; name: string };

describe("tables, as native makes them", () => {
  it("replays native's run", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const cs = native.commands as unknown as [string, Record<string, unknown>][], rs = native.results as unknown as ({ receipt: unknown } | { error: string })[];
    for (const [i, [c, p]] of cs.slice(1).entries()) {
      const want = rs[i + 1];
      if ("error" in want) await expect(e.executeAsync(c, p), c).rejects.toThrow(want.error);
      else expect(await e.executeAsync(c, p), `${c} ${JSON.stringify(p)}`).toEqual(want.receipt);
    }
    const want = (await decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(native.document)) }))).document, got = e.getSnapshot().document;
    const problems: string[] = [];
    for (const [id, w] of Object.entries(want.nodes) as unknown as [string, Node][]) {
      const g = got.nodes[id] as unknown as Node | undefined;
      if (!g) { problems.push(`node ${id} missing`); continue; }
      if (w.kind === "page") continue;
      // Rows, cells and the table hug their texts: their heights and the places below them follow the measured text.
      const keys = w.kind === "text" ? ["name", "parent", "textSizing"] : w.name === "Column line" ? ["x", "width", "locked", "childLayout", "constraints", "parent"]
        : ["name", "parent", "children", "layout", "sizing", "childLayout", "stroke", "strokes", "corners", "clip", "board", "width", ...(w.name === "Table" ? ["x", "y"] : [])];
      for (const k of keys) { const why = near(g[k], w[k], `node ${id} (${w.name})/${k}`); if (why) problems.push(why); }
      const why = near(rectanglePaints(g as never), rectanglePaints(w as never), `node ${id} (${w.name})/fills`); if (why) problems.push(why);
    }
    for (const id of Object.keys(got.nodes)) if (!want.nodes[id]) problems.push(`node ${id} is extra`);
    expect(problems).toEqual([]);
  });

  it("reads cells copied from a spreadsheet as native does", () => {
    expect(spreadsheetCells("a\tb\nc\td\n")).toEqual([[["a", "b"], ["c", "d"]], false]);
    expect(spreadsheetCells("plain text")).toBeUndefined();
    expect(spreadsheetCells("one\ntwo")).toBeUndefined();
    expect(spreadsheetCells("\"x\ty\"\tz\r\n\"say \"\"hi\"\"\"\tw")).toEqual([[["x\ty", "z"], ["say \"hi\"", "w"]], false]);
    expect(spreadsheetCells("a\t\n")).toEqual([[["a", ""]], false]);
    const wide = Array(25).fill("x").join("\t");
    const [rows, more] = spreadsheetCells(wide)!;
    expect([rows[0].length, more]).toEqual([20, true]);
  });

  it("puts a height change into the last row and hugs the rows again", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const t = await e.executeAsync("board.table", { x: 0, y: 0, rows: 2, columns: 2 }) as { id: number };
    const before = (e.getSnapshot().document.nodes[String(t.id)] as unknown as { height: number }).height;
    await e.executeAsync("node.set", { id: t.id, props: { height: before + 60 } });
    const d = e.getSnapshot().document, table = d.nodes[String(t.id)] as unknown as { height: number; sizing: { vertical: string }; children: string[] };
    expect(table.sizing.vertical).toBe("hug");
    expect(table.height).toBeCloseTo(before + 60, 6);
    const rowCell = (r: number) => d.nodes[(d.nodes[table.children[r]] as unknown as { children: string[] }).children[0]] as unknown as { childLayout: { minHeight: number } };
    expect(rowCell(0).childLayout.minHeight).toBe(40);
    expect(rowCell(1).childLayout.minHeight).toBeGreaterThan(40);
  });
});
