import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { EditorWorkspace } from "../../src/engine/workspace";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { readBoardItem, remapBoardItem } from "../../src/engine/board-data";
import native from "../fixtures/native-board-document.json" with { type: "json" };

// The board data model against a board native saved at bad07e44 (tests/fixtures/native-board-document.provenance.md): the port opens it,
// keeps what every object is for and the board's timer and votes, and writes them back as native does.
type Raw = { nodes: Record<string, { board?: unknown; background?: unknown }>; [k: string]: unknown };
const doc = native.document as unknown as Raw;
const bytes = () => zipSync({ "document.json": strToU8(JSON.stringify(native.document)) });

describe("the board data model, as native saves it", () => {
  it("opens a native board with its kind, timer, vote, ballots and kept results", async () => {
    const d = (await decodeFigcraft(bytes())).document;
    expect(d.kind).toBe("board");
    expect(d.name).toBe("Retro");
    expect(d.timer).toEqual({ state: "paused", left: 300000 });
    expect(d.vote).toEqual({ perPerson: 2, scope: { type: "all" }, ended: false });
    expect(d.votes).toEqual({ Bo: ["4"] });
    expect(d.voteHistory).toEqual([{ vote: { perPerson: 3, scope: { type: "stickies" }, ended: true }, ballots: { Ana: ["2"] }, ended: (doc.vote_history as { ended: number }[])[0].ended }]);
  });

  it("keeps what each object is for", async () => {
    const d = (await decodeFigcraft(bytes())).document;
    const item = (id: string) => (d.nodes[id] as { board?: unknown }).board;
    expect(item("2")).toEqual({ type: "sticky", author: "Ana" });
    expect(item("5")).toEqual({ type: "shape", shape: "diamond" });
    expect(item("8")).toEqual({ type: "connector", from: { node: "2", side: "auto" }, to: { node: "4", side: "auto" }, routing: "elbow" });
    expect(item("9")).toEqual({ type: "label", connector: "8" });
    expect(item("11")).toEqual({ type: "connector", from: { x: 0, y: 400 }, to: { node: "4", side: "bottom", at: [0.25, 1] }, routing: "curved", path: { bow: { x: 121, y: (doc.nodes["11"].board as { path: { bow: { y: number } } }).path.bow.y } } });
    expect(item("12")).toEqual({ type: "stamp", stamp: "heart", on: "2" });
    expect([item("14"), item("15"), item("27")]).toEqual([{ type: "ink" }, { type: "table" }, { type: "mindNode" }]);
    expect(item("31")).toEqual({ type: "connector", from: { node: "27", side: "right" }, to: { node: "29", side: "left" }, routing: "curved", branch: true });
    expect(item("3")).toBeUndefined();
  });

  it("writes it back as native does", async () => {
    const saved = JSON.parse(strFromU8(unzipSync(await encodeFigcraft((await decodeFigcraft(bytes())).document))["document.json"])) as Raw;
    for (const key of ["kind", "timer", "vote", "votes", "vote_history"]) expect(saved[key], key).toEqual(doc[key]);
    for (const [id, n] of Object.entries(doc.nodes)) expect(saved.nodes[id].board, `node ${id}`).toEqual(n.board);
  });

  it("refuses what native would not read, and leaves design files without board fields", async () => {
    expect(() => readBoardItem({ type: "sticky", colour: "pink" })).toThrow(/not supported/);
    expect(() => readBoardItem({ type: "shape", shape: "blob" })).toThrow(/unknown blob/);
    expect(() => readBoardItem({ type: "connector", from: { x: 1, y: 1 }, to: { x: 0, y: 0 }, routing: "zigzag" })).toThrow(/unknown zigzag/);
    expect(() => readBoardItem({ type: "whiteboard" })).toThrow(/unknown board object/);
    const e = new EditorEngine();
    e.execute("frame.create", { x: 0, y: 0, width: 10, height: 10 });
    const saved = JSON.parse(strFromU8(unzipSync(await encodeFigcraft(e.getSnapshot().document))["document.json"])) as Raw;
    for (const key of ["kind", "timer", "vote", "votes", "vote_history"]) expect(saved[key], key).toBeUndefined();
    expect(Object.values(saved.nodes).some(n => "board" in n)).toBe(false);
  });

  it("points a copied connector's ends and a label's connector at their copies", () => {
    const map = (id: string) => ({ "2": "102", "8": "108" } as Record<string, string>)[id];
    expect(remapBoardItem({ type: "connector", from: { node: "2", side: "auto" }, to: { x: 1, y: 2 }, routing: "straight" }, map))
      .toEqual({ type: "connector", from: { node: "102", side: "auto" }, to: { x: 1, y: 2 }, routing: "straight" });
    expect(remapBoardItem({ type: "label", connector: "8" }, map)).toEqual({ type: "label", connector: "108" });
  });

  it("makes a new board on the light board page, named as native names it", async () => {
    const ws = new EditorWorkspace();
    expect(ws.execute("file.newBoard", {})).toMatchObject({ kind: "board" });
    const board = EditorEngine.newTab(undefined, {}, "board").getSnapshot().document;
    expect([board.kind, board.name]).toEqual(["board", "Untitled board"]);
    const saved = JSON.parse(strFromU8(unzipSync(await encodeFigcraft(board))["document.json"])) as Raw;
    expect(saved.kind).toBe("board");
    // The same 32-bit colour, whatever digits print it.
    const f32 = (c: unknown) => Object.values(c as Record<string, number>).map(Math.fround);
    expect(f32(saved.nodes["1"].background)).toEqual(f32(doc.nodes["1"].background));
    expect(EditorEngine.newTab(undefined, {}).getSnapshot().document.kind).toBeUndefined();
  });
});
