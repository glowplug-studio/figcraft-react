import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { mindGapX, mindGapY, mindLayout, mindMaxNodes, type MindBox } from "../../src/engine/board-mindmap";
import { boundsOf } from "../../src/engine/viewport";
import native from "../fixtures/native-board-mindmap.json" with { type: "json" };

// Mind maps: native's layout tests restated from doc/src/board_mindmap_tests.rs, and a native run at bad07e44
// (tests/fixtures/native-board-mindmap.provenance.md). Native's headless engine measures no text, so its nodes are their least width;
// the run is compared by its receipts and its tree, and the port's own layout is checked against native's layout rule.
const root = (): MindBox => ({ id: "1", rect: { x0: 0, y0: 0, x1: 200, y1: 36 }, left: false });
const node = (id: number, parent: number, [w, h]: readonly [number, number], y: number, left = false): MindBox => ({ id: String(id), rect: { x0: 0, y0: y, x1: w, y1: y + h }, parent, left });
const at = (placed: [string, { x: number; y: number }][], id: number) => { const p = placed.find(([n]) => n === String(id)); if (!p) throw new Error(`node ${id} not placed`); return [p[1].x, p[1].y]; };
const three = (middle: readonly [number, number]) => [root(), node(2, 0, [100, 24], 0), node(3, 0, middle, 22 - middle[1] / 2), node(4, 0, [80, 24], 20)];
const six = () => [root(), node(2, 0, [100, 24], 0), node(3, 0, [60, 24], 10), node(4, 1, [40, 24], 0), node(5, 1, [40, 24], 10), node(6, 2, [40, 24], 0)];

describe("mind map layout, as native's tests pin it", () => {
  it("stands three children 88 right of the root, 72 apart, centred on it", () => {
    expect([mindGapX, mindGapY]).toEqual([88, 48]);
    const placed = mindLayout(three([60, 24]));
    expect([at(placed, 2), at(placed, 3), at(placed, 4)]).toEqual([[288, -66], [288, 6], [288, 78]]);
    expect(placed.some(([n]) => n === "1")).toBe(false);
  });
  it("lets a taller node push its neighbours half its growth each way", () => {
    const placed = mindLayout(three([60, 72]));
    expect([at(placed, 2), at(placed, 3), at(placed, 4)]).toEqual([[288, -90], [288, -18], [288, 102]]);
  });
  it("puts grandchildren in a column past the widest sibling, and parents make room", () => {
    const placed = mindLayout(six());
    expect([2, 3, 4, 5, 6].map(i => at(placed, i))).toEqual([[288, -30], [288, 78], [476, -66], [476, 6], [476, 78]]);
  });
  it("mirrors left children", () => {
    const placed = mindLayout([root(), node(2, 0, [80, 24], 0, true), node(3, 1, [50, 24], 0)]);
    expect([at(placed, 2), at(placed, 3)]).toEqual([[-168, 6], [-306, 6]]);
  });
  it("is a fixed point, breaks ties by id and skips junk", () => {
    const nodes = six(), placed = mindLayout(nodes);
    const again = nodes.map(b => { const p = placed.find(([n]) => n === b.id)?.[1] ?? { x: b.rect.x0, y: b.rect.y0 }; return { ...b, rect: { x0: p.x, y0: p.y, x1: p.x + b.rect.x1 - b.rect.x0, y1: p.y + b.rect.y1 - b.rect.y0 } }; });
    expect(mindLayout(again)).toEqual(placed);
    const tied = mindLayout([root(), node(9, 0, [10, 24], 5), node(7, 0, [10, 24], 5)]);
    expect(at(tied, 7)[1]).toBeLessThan(at(tied, 9)[1]);
    expect(mindLayout([])).toEqual([]);
    const nan = three([60, 24]); nan[2] = { ...nan[2], rect: { x0: NaN, y0: 0, x1: 1, y1: 1 } };
    expect(mindLayout(nan)).toEqual([]);
    const orphan = [...three([60, 24]), node(8, 9, [10, 24], 0)];
    expect(mindLayout(orphan).some(([n]) => n === "8")).toBe(false);
    const huge = [root(), ...Array.from({ length: mindMaxNodes }, (_, i) => node(i + 2, 0, [10, 24], i))];
    expect(mindLayout(huge)).toEqual([]);
  });
});

describe("mind maps, as native makes them", () => {
  it("replays native's run: receipts, nodes, branches and the tree", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const cs = native.commands as unknown as [string, Record<string, unknown>][], rs = native.results as unknown as ({ receipt: unknown } | { error: string })[];
    for (const [i, [c, p]] of cs.slice(1).entries()) {
      const want = rs[i + 1];
      if ("error" in want) await expect(e.executeAsync(c, p), c).rejects.toThrow(want.error);
      else expect(await e.executeAsync(c, p), `${c} ${JSON.stringify(p)}`).toEqual(want.receipt);
    }
    const want = (await decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(native.document)) }))).document, got = e.getSnapshot().document;
    expect(Object.keys(got.nodes).sort()).toEqual(Object.keys(want.nodes).sort());
    for (const id of Object.keys(want.nodes)) {
      const w = want.nodes[id] as unknown as Record<string, unknown>, g = got.nodes[id] as unknown as Record<string, unknown>;
      for (const k of ["name", "parent", "board", "kind"]) expect(g[k], `node ${id}/${k}`).toEqual(w[k]);
      if (w.kind === "text") for (const k of ["fontStyle", "fontSize", "lineHeight", "letterSpacing"]) expect((g.text as { style: Record<string, unknown> }).style[k], `node ${id}/${k}`).toEqual((w.text as { style: Record<string, unknown> }).style[k]);
      if ((w.board as { type?: string } | undefined)?.type === "connector") for (const k of ["stroke", "strokes"]) expect(g[k], `node ${id}/${k}`).toEqual(w[k]);
    }
    // The port's map is laid out by native's rule: each child sits as mindLayout puts it from the boxes now.
    const d = got, b = (id: string) => { const r = boundsOf(d, [id])!; return { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }; };
    const boxes: MindBox[] = [{ id: "2", rect: b("2"), left: false }, ...["7", "10", "13", "19"].map(id => ({ id, rect: b(id), parent: 0, left: false }))];
    for (const [id, p] of mindLayout(boxes)) { expect(b(id).x0).toBeCloseTo(p.x, 6); expect(b(id).y0).toBeCloseTo(p.y, 6); }
  });
});
