import { beforeAll, describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { prepareText } from "../../src/engine/text-node-layout";
import { hitRectangle } from "../../src/engine/selection";
import { labelOf, textOf } from "../../src/engine/board-commands";
import { boundsOf } from "../../src/engine/viewport";
import type { BoardItem } from "../../src/engine/board-data";
import native from "../fixtures/native-board-tools.json" with { type: "json" };

// The board tools: native's runs at bad07e44 (tests/fixtures/native-board-tools.provenance.md) and native's tool tests restated from
// engine/src/board_tools_tests.rs. Presses go through the engine's board tool and pencil interactions, as the canvas sends them.
type Json = Record<string, unknown>;
const board = () => EditorEngine.newTab(undefined, {}, "board");
const items = (e: EditorEngine, type: string) => Object.values(e.getSnapshot().document.nodes).filter(n => (n as { board?: BoardItem }).board?.type === type);
const click = (e: EditorEngine, x: number, y: number) => e.boardTools.down({ x, y });

describe("board tools, as native runs them", () => {
  it("replays native's runs: replies and refusals", async () => {
    for (const run of native.runs) {
      let e = EditorEngine.newTab();
      for (const [i, [c, p]] of (run.commands as [string, Json][]).entries()) {
        const want = run.results[i] as { receipt: Json } | { error: string };
        // A new board is the workspace's: the port opens it as a tab of its own.
        if (c === "file.newBoard") { e = board(); continue; }
        if ("error" in want) await expect(e.executeAsync(c, p), `${c} ${JSON.stringify(p)}`).rejects.toThrow(want.error);
        else expect(await e.executeAsync(c, p), `${c} ${JSON.stringify(p)}`).toEqual(want.receipt);
      }
    }
  });
  it("keeps each tool's choice for the next press", async () => {
    const e = board();
    await e.executeAsync("tool.highlighter", { color: "pink" });
    await e.executeAsync("tool.marker", { color: "#336699" });
    await e.executeAsync("tool.shape", { shape: "roundedRectangle" });
    await e.executeAsync("tool.stamp", { stamp: "QUESTION" });
    await e.executeAsync("tool.connector", { style: "curved" });
    expect([e.boardTool.shape, e.boardTool.stamp, e.boardTool.routing]).toEqual(["roundedRectangle", "question", "curved"]);
    expect([Math.round(e.boardTool.marker.r * 255), Math.round(e.boardTool.marker.g * 255), Math.round(e.boardTool.marker.b * 255)]).toEqual([0x33, 0x66, 0x99]);
    expect(e.getSnapshot().tool).toBe("connector");
  });
});

describe("pressing with the board tools", () => {
  beforeAll(() => prepareText());
  it("places a shape centred on the press and goes back to Move; stamps go on one after another", async () => {
    const e = board();
    await e.executeAsync("tool.shape", { shape: "roundedRectangle" });
    expect(click(e, 100, 100)).toEqual({ capture: false });
    const sh = e.getSnapshot().selection[0]!, doc = e.getSnapshot().document;
    expect((doc.nodes[sh] as { board?: BoardItem }).board).toEqual({ type: "shape", shape: "roundedRectangle" });
    expect(boundsOf(doc, [sh])).toMatchObject({ x: 20, y: 20, width: 160, height: 160 });
    expect(e.getSnapshot().tool).toBe("move");
    await e.executeAsync("tool.stamp", { stamp: "question" });
    click(e, 400, 100); click(e, 450, 100);
    expect(items(e, "stamp").length).toBe(2);
    expect(e.getSnapshot().tool).toBe("stamp");
  });
  it("places a sticky and types in it, a second sticky its own undo step", async () => {
    const e = board();
    await e.executeAsync("tool.sticky", { color: "blue" });
    const placed = click(e, 100, 100)!;
    const sticky = e.getSnapshot().selection[0]!;
    expect(placed.edit).toBe(textOf(e.getSnapshot().document, sticky));
    expect(boundsOf(e.getSnapshot().document, [sticky])).toMatchObject({ x: 0, y: 0, width: 200 });
    await e.executeAsync("tool.sticky");
    click(e, 500, 100);
    expect(items(e, "sticky").length).toBe(2);
    e.execute("edit.undo");
    expect(items(e, "sticky").length).toBe(1);
  });
  it("draws an ink stroke from the press to the release", async () => {
    const e = board();
    await e.executeAsync("tool.marker");
    expect(e.pencil.down({ x: 0, y: 0 })).toBe(true);
    e.pencil.up({ x: 150, y: 0 });
    const ink = items(e, "ink");
    expect(ink.length).toBe(1);
    const b = boundsOf(e.getSnapshot().document, [ink[0]!.id])!;
    expect(Math.abs(b.x) < 6 && Math.abs(b.x + b.width - 150) < 6).toBe(true);
    expect(e.getSnapshot().selection).toEqual([]);
    await e.executeAsync("tool.highlighter");
    e.pencil.down({ x: 0, y: 100 }); e.pencil.move({ x: 60, y: 120 }); e.pencil.up({ x: 120, y: 100 });
    expect(items(e, "ink").map(n => n.name)).toEqual(["Ink", "Highlight"]);
  });
  it("erases the strokes it touches in one undo step", async () => {
    const e = board();
    await e.executeAsync("board.ink", { path: "M 0 0 L 100 0", select: false });
    await e.executeAsync("board.ink", { path: "M 0 200 L 100 200", select: false });
    await e.executeAsync("board.sticky", { x: 300, y: 0 });
    await e.executeAsync("tool.eraser");
    expect(click(e, 50, 2)).toEqual({ capture: true });
    e.boardTools.move({ x: 50, y: 100 }); e.boardTools.move({ x: 50, y: 198 });
    e.boardTools.up({ x: 50, y: 198 });
    expect(items(e, "ink").length).toBe(0);
    expect(items(e, "sticky").length).toBe(1);
    e.execute("edit.undo");
    expect(items(e, "ink").length).toBe(2);
  });
});

describe("picking and double-clicking board objects", () => {
  it("picks a board object whole, unless a layer inside it is selected", async () => {
    const e = board();
    const s = await e.executeAsync("board.sticky", { x: 0, y: 0, text: "Note" }) as { id: number; text: number };
    const doc = e.getSnapshot().document;
    expect(hitRectangle(doc, { x: 30, y: 30 }, false, [], 2)).toBe(String(s.id));
    expect(hitRectangle(doc, { x: 30, y: 30 }, false, [String(s.text)], 2)).toBe(String(s.text));
  });
  it("types in a shape's text, and in a new label on a connector", async () => {
    const e = board();
    const a = await e.executeAsync("board.shape", { x: 0, y: 0 }) as { id: number; text: number };
    const b = await e.executeAsync("board.shape", { x: 400, y: 0 }) as { id: number };
    const c = await e.executeAsync("board.connector", { from: a.id, to: b.id, style: "straight" }) as { id: number };
    await e.executeAsync("select.none");
    expect(e.boardTools.doubleClick({ x: 80, y: 80 })).toBe(String(a.text));
    const t = e.boardTools.doubleClick({ x: 280, y: 80 });
    const label = labelOf(e.getSnapshot().document, String(c.id));
    expect(label).toBeDefined();
    expect(t).toBe(textOf(e.getSnapshot().document, label!));
    expect((e.getSnapshot().document.nodes[t!] as { text: { characters: string } }).text.characters).toBe("Label");
  });
});
