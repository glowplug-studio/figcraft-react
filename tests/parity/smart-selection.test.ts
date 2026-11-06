import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { boundsOf } from "../../src/engine/viewport";
import { reorderLayout, selectionSpacing } from "../../src/engine/smart-selection";
import { decodeFigcraft } from "../../src/engine/file-format";
import { pageOf, type LayerNode } from "../../src/engine/document";

const rect = (e: EditorEngine, x = 0, y = 0, width = 50, height = 40, parent?: string) => String(e.execute("shape.rectangle", { x, y, width, height, ...(parent ? { parent } : {}) }).id);
const box = (e: EditorEngine, id: string) => boundsOf(e.getRenderDocument(), [id])!;
const row = (e: EditorEngine) => [rect(e), rect(e, 70), rect(e, 140)];

describe("native smart-selection tracks and interaction transactions", () => {
  it("keeps unequal grid tracks and sizes while setting both gaps", () => {
    const e = new EditorEngine(), ids = [rect(e, 100, 100, 50, 40), rect(e, 180, 100, 80, 40), rect(e, 100, 160, 30, 60), rect(e, 180, 160, 40, 60)];
    const layout = selectionSpacing(e.getSnapshot().document, ids);
    expect(layout.horizontal?.value).toBe(30); expect(layout.vertical?.value).toBe(20);
    e.execute("arrange.spacing", { ids, horizontal: 12, vertical: 25 });
    expect(ids.map(id => [box(e, id).x, box(e, id).y])).toEqual([[100, 100], [162, 100], [100, 165], [162, 165]]);
    expect(box(e, ids[3]).width).toBe(40); e.execute("edit.undo"); expect(box(e, ids[3])).toMatchObject({ x: 180, y: 160 });
  });
  it("normalises mixed gaps and supports negative fractional gaps", () => {
    const e = new EditorEngine(), ids = [rect(e), rect(e, 70), rect(e, 160)];
    expect(selectionSpacing(e.getSnapshot().document, ids).horizontal?.value).toBeUndefined();
    e.execute("arrange.spacing", { ids, horizontal: -5.5 });
    expect(ids.map(id => box(e, id).x)).toEqual([0, 44.5, 89]);
    expect(selectionSpacing(e.getSnapshot().document, ids).horizontal?.value).toBe(-5.5);
  });
  it("uses original track anchors rather than growing union bounds", () => {
    const e = new EditorEngine(), a = rect(e, 0, 0, 100, 40), b = rect(e, 10, 0, 80, 40), c = rect(e, 10, 0, 100, 40);
    const tracks = selectionSpacing(e.getSnapshot().document, [c, b, a]).horizontal?.tracks;
    expect(tracks?.map(track => track.ids)).toEqual([[a, b], [c]]);
  });
  it.each([false, true])("inserts unequal sizes in visual order, vertical=%s", vertical => {
    const e = new EditorEngine(), ids = [[0, 40], [50, 60], [120, 20]].map(([at, size]) => rect(e, vertical ? 0 : at, vertical ? at : 0, vertical ? 30 : size, vertical ? size : 30));
    const before = e.getSnapshot().document;
    e.execute("arrange.reorder", { ids: [ids[2], ids[0], ids[1]], source: ids[0], target: ids[2] });
    expect(ids.map(id => vertical ? box(e, id).y : box(e, id).x)).toEqual([100, 0, 70]);
    expect(pageOf(e.getSnapshot().document).children).toEqual(pageOf(before).children);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
    e.execute("edit.redo"); expect(vertical ? box(e, ids[0]).y : box(e, ids[0]).x).toBe(100);
  });
  it("inserts across grid rows and swaps only the chosen entries", () => {
    const e = new EditorEngine(), ids = Array.from({ length: 6 }, (_, i) => rect(e, i % 3 * 70, Math.floor(i / 3) * 60));
    e.execute("arrange.reorder", { ids, source: ids[0], target: ids[4] });
    expect(box(e, ids[0])).toMatchObject({ x: 70, y: 60 }); expect(box(e, ids[3])).toMatchObject({ x: 140, y: 0 });
    e.execute("edit.undo"); const before = e.getSnapshot().document;
    e.execute("arrange.reorder", { ids, source: ids[0], target: ids[4], swap: true });
    expect(box(e, ids[4])).toMatchObject({ x: 0, y: 0 });
    for (const i of [1, 2, 3, 5]) expect(e.getSnapshot().document.nodes[ids[i]]).toBe(before.nodes[ids[i]]);
  });
  it("reflows unequal grid dimensions using each new column and row maximum", () => {
    const e = new EditorEngine(), ids = [rect(e, 0, 0, 40, 30), rect(e, 50, 0, 60, 30), rect(e, 0, 50, 40, 50), rect(e, 50, 50, 60, 50)];
    e.execute("arrange.reorder", { ids, source: ids[0], target: ids[3] });
    expect(ids.map(id => [box(e, id).x, box(e, id).y])).toEqual([[70, 70], [0, 0], [70, 0], [0, 70]]);
  });
  it("keeps previews out of root snapshots, history and native saves until one commit", async () => {
    const e = new EditorEngine(), ids = row(e); e.execute("select.set", { ids }); e.execute("file.markSaved");
    const before = e.getSnapshot(); let roots = 0, canvases = 0;
    e.subscribe(() => roots++); e.subscribeCanvas(() => canvases++); e.beginInteraction();
    for (const horizontal of [-100, 0, 30]) e.execute("arrange.spacing", { ids, horizontal, fromGesture: true });
    expect(e.getSnapshot()).toBe(before); expect(roots).toBe(0); expect(canvases).toBe(3);
    expect(box(e, ids[2]).x).toBe(160);
    const saved = await decodeFigcraft(await e.nativeSnapshot()); expect((saved.document.nodes[ids[2]] as LayerNode).x).toBe(140);
    expect(e.commitInteraction()).toBe(true); expect(roots).toBe(1); expect(e.getSnapshot().dirty).toBe(true);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before.document);
  });
  it("preserves a previously changed unrequested axis during absolute previews", () => {
    const e = new EditorEngine(), ids = [rect(e), rect(e, 70), rect(e, 0, 60), rect(e, 70, 60)];
    e.beginInteraction(); e.execute("arrange.spacing", { ids, horizontal: 30, fromGesture: true });
    e.execute("arrange.spacing", { ids, vertical: 35, fromGesture: true });
    expect(box(e, ids[3])).toMatchObject({ x: 80, y: 75 });
    e.cancelInteraction(); expect(box(e, ids[3])).toMatchObject({ x: 70, y: 60 });
  });
  it("returning to the source slot adds no undo entry", () => {
    const e = new EditorEngine(), ids = row(e); e.execute("select.set", { ids });
    const before = e.getSnapshot(); e.beginInteraction();
    for (const target of [ids[2], ids[1], ids[0]]) e.execute("arrange.reorder", { ids, source: ids[0], target, fromGesture: true });
    expect(e.commitInteraction()).toBe(false); expect(e.getSnapshot()).toBe(before);
  });
  it("cancels on selection, page, access and file changes; undo first cancels a live gesture", async () => {
    const e = new EditorEngine(), ids = row(e); e.execute("select.set", { ids }); const before = e.getSnapshot().document;
    const start = () => { e.beginInteraction(); e.execute("arrange.reorder", { ids, source: ids[0], target: ids[2], fromGesture: true }); };
    start(); e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); expect(e.interacting).toBe(false);
    start(); e.execute("select.set", { ids: [ids[1]] }); expect(e.getSnapshot().document).toBe(before); expect(e.getSnapshot().selection).toEqual([ids[1]]);
    start(); e.execute("page.add"); expect(e.interacting).toBe(false); expect((e.getSnapshot().document.nodes[ids[0]] as LayerNode).x).toBe(0);
    e.execute("edit.undo"); start(); e.setEditable(false); expect(e.interacting).toBe(false); expect(e.getRenderDocument()).toBe(e.getSnapshot().document);
    e.setEditable(true); const bytes = await e.nativeSnapshot(); start(); await e.executeAsync("file.open", { data: Buffer.from(bytes).toString("base64") });
    expect(e.interacting).toBe(false); expect((e.getSnapshot().document.nodes[ids[0]] as LayerNode).x).toBe(0);
  });
  it("refuses unsafe targets, incomplete grids, mixed-gap reorder and invalid spacing atomically", () => {
    const e = new EditorEngine(), ids = [rect(e), rect(e, 70), rect(e, 160)], before = e.getSnapshot();
    for (const params of [{ ids, horizontal: 5, vertical: 5 }, { ids, vertical: 5 }, { ids, horizontal: 'bad' }, { ids, horizontal: 1e300 }, { ids }]) {
      expect(() => e.execute("arrange.spacing", params)).toThrow(); expect(e.getSnapshot()).toBe(before);
    }
    for (const params of [{ ids, source: ids[0], target: ids[1] }, { ids: ids.slice(0, 2), source: ids[2], target: ids[0] }, { ids: [ids[0], ids[0], ids[1]], source: ids[0], target: ids[1] }]) {
      expect(() => e.execute("arrange.reorder", params)).toThrow(); expect(e.getSnapshot()).toBe(before);
    }
    for (const props of [{ locked: true }, { visible: false }]) {
      e.execute("node.set", { id: ids[1], props }); expect(selectionSpacing(e.getSnapshot().document, ids).horizontal).toBeUndefined();
      e.execute("edit.undo");
    }
    const lower = rect(e, 0, 70); expect(reorderLayout(e.getSnapshot().document, [ids[0], ids[1], lower])).toBeUndefined();
    expect(selectionSpacing(e.getSnapshot().document, [ids[1], lower]).horizontal).toBeUndefined();
  });
  it("uses page-space gaps under a rotated frame and guards hidden/locked ancestry", () => {
    const e = new EditorEngine(), frame = String(e.execute("frame.create", { x: 100, y: 100, width: 300, height: 200, props: { rotation: 90 } }).id);
    const ids = [rect(e, 0, 0, 50, 40, frame), rect(e, 70, 0, 50, 40, frame)];
    e.execute("arrange.spacing", { ids, vertical: 40 }); expect(Math.abs(box(e, ids[1]).y - box(e, ids[0]).y)).toBeCloseTo(90);
    e.execute("node.set", { id: frame, props: { locked: true } }); expect(selectionSpacing(e.getSnapshot().document, ids).vertical).toBeUndefined();
  });
  it("rounds local translation ties away from zero, retains non-zero dimensions and ignores constraints", () => {
    const e = new EditorEngine(), frame = String(e.execute("frame.create", { x: -1.5, y: 2.5, width: 100.6, height: .2 }).id);
    const child = rect(e, 10.2, 0, .1, 0, frame); e.execute("node.set", { id: child, props: { constraints: { horizontal: "scale" } } });
    e.execute("arrange.roundToPixels", { ids: [frame] });
    expect(e.getSnapshot().document.nodes[frame]).toMatchObject({ x: -2, y: 3, width: 101, height: 1 });
    expect(e.getSnapshot().document.nodes[child]).toMatchObject({ x: 10.2, width: .1, height: 0 });
    e.execute("arrange.roundToPixels", { ids: [child] }); expect(e.getSnapshot().document.nodes[child]).toMatchObject({ x: 10, width: 1, height: 0 });
    const before = e.getSnapshot(); e.execute("arrange.roundToPixels", { ids: [child] }); expect(e.getSnapshot()).toBe(before);
  });
});
