import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { defaultViewport, fitView, pageToScreen, screenToPage, scrollView, viewOrigin, zoomAt } from "../../src/engine/viewport";
import { framePresets } from "../../src/engine/frame-presets";

// Source-derived numeric fixtures: view_behaviour_tests.rs and ViewState at upstream0b97f3f.
describe("native viewport navigation", () => {
  it.each([
    ["view.zoomIn", 1, 2], ["view.zoomOut", 1, 0.5], ["view.zoomIn", 1.5, 2], ["view.zoomOut", 0.25, 0.13],
    ["view.zoomIn", 256, 256], ["view.zoomOut", 0.02, 0.02], ["view.zoom100", 3, 1], ["view.zoom50", 3, 0.5], ["view.zoom200", 0.3, 2],
  ] as const)("%s from %s gives %s and keeps centre", (command, before, after) => {
    const engine = new EditorEngine(); engine.execute("view.set", { zoom: before, cx: 100, cy: 50 }); engine.execute(command);
    expect(engine.getView()).toMatchObject({ zoom: after, cx: 100, cy: 50 });
  });

  it("keeps pointer anchors fixed, clamps zoom, and reverses screen/page conversion", () => {
    const before = pageToScreen(defaultViewport, { x: 300, y: -40 });
    const next = zoomAt(defaultViewport, 3.7, { x: 300, y: -40 });
    const after = pageToScreen(next, { x: 300, y: -40 });
    expect(after.x).toBeCloseTo(before.x, 10); expect(after.y).toBeCloseTo(before.y, 10);
    expect(screenToPage(next, after).x).toBeCloseTo(300, 10);
    expect(screenToPage(next, after).y).toBeCloseTo(-40, 10);
    expect(zoomAt(next, 1e9, { x: 0, y: 0 }).zoom).toBe(256);
    expect(zoomAt(next, NaN, { x: 0, y: 0 }).zoom).toBe(3.7);
  });

  it("fits an area with64px margins, including zero-width and zero-size boxes", () => {
    expect(fitView(defaultViewport, { x: 0, y: 0, width: 300, height: 200 })).toMatchObject({ zoom: 3.36, cx: 150, cy: 100 });
    expect(fitView(defaultViewport, { x: 20, y: 30, width: 0, height: 100 })).toMatchObject({ zoom: 6.72, cx: 20, cy: 80 });
    expect(fitView(defaultViewport, { x: 20, y: 30, width: 0, height: 0 })).toMatchObject({ zoom: 1, cx: 20, cy: 30 });
  });

  it("pans in screen units with shift sideways and native keyboard step limits", () => {
    const view = { ...defaultViewport, zoom: 2 };
    expect(scrollView(view, 0, 80, true)).toMatchObject({ cx: -40, cy: 0 });
    expect(scrollView(view, 20, 80, true)).toMatchObject({ cx: -10, cy: -40 });
    expect(scrollView(view, NaN, 2)).toBe(view);
    const engine = new EditorEngine(); engine.execute("view.set", { cx: 0, cy: 0, zoom: 2 });
    engine.execute("view.pan", { dx: 1, dy: -1 }); expect(engine.getView()).toMatchObject({ cx: 10, cy: -10 });
    engine.execute("view.pan", { dx: 1000, big: true }); expect(engine.getView().cx).toBe(10010);
  });

  it("fits all content and selection, and traverses frames in reading order with wrap", () => {
    const engine = new EditorEngine();
    const frame = (x: number, y: number, width: number, height: number) => String(engine.execute("frame.create", { x, y, width, height }).id);
    const f3 = frame(0, 500, 100, 100), f2 = frame(600, 0, 200, 200), f1 = frame(0, 0, 400, 300);
    const rect = String(engine.execute("shape.rectangle", { x: 900, y: 0, width: 40, height: 40 }).id);
    engine.execute("view.zoomFit"); expect(engine.getView()).toMatchObject({ cx: 470, cy: 300, zoom: 1.12 });
    engine.execute("view.zoomSelection"); expect(engine.getView()).toMatchObject({ cx: 920, cy: 20, zoom: 16.8 });
    engine.execute("select.none"); engine.execute("view.nextFrame"); expect(engine.getSnapshot().selection).toEqual([f1]);
    engine.execute("view.nextFrame"); expect(engine.getSnapshot().selection).toEqual([f2]);
    engine.execute("view.nextFrame"); expect(engine.getSnapshot().selection).toEqual([f3]);
    engine.execute("view.nextFrame"); expect(engine.getSnapshot().selection).toEqual([f1]);
    engine.execute("view.prevFrame"); expect(engine.getSnapshot().selection).toEqual([f3]);
    engine.execute("select.set", { ids: [rect] }); engine.execute("view.prevFrame"); expect(engine.getSnapshot().selection).toEqual([f1]);
    engine.execute("select.none"); const before = engine.getView(); engine.execute("view.zoomSelection"); expect(engine.getView()).toBe(before);
  });

  it("skips page dividers, does not wrap, and fits newly selected pages", () => {
    const engine = new EditorEngine(); engine.execute("page.add", { name: "---" });
    const second = String(engine.execute("page.add", { name: "Second" }).id);
    engine.execute("shape.rectangle", { x: 20, y: 30, width: 100, height: 80 });
    engine.execute("view.prevPage"); expect(engine.getSnapshot().document.currentPage).toBe("1");
    expect(viewOrigin(engine.getView())).toEqual({ x: -100, y: -100 });
    engine.execute("view.prevPage"); expect(engine.getSnapshot().document.currentPage).toBe("1");
    engine.execute("view.nextPage"); expect(engine.getSnapshot().document.currentPage).toBe(second);
    expect(engine.getView()).toMatchObject({ zoom: 1, cx: 70, cy: 70 });
    engine.execute("view.nextPage"); expect(engine.getSnapshot().document.currentPage).toBe(second);
  });

  it("keeps viewport changes outside document history and root subscribers", () => {
    const engine = new EditorEngine(); engine.execute("shape.rectangle"); engine.execute("file.markSaved");
    const before = engine.getSnapshot(); let root = 0, views = 0;
    const stopRoot = engine.subscribe(() => root++), stopView = engine.subscribeView(() => views++);
    for (let i = 0; i < 100; i++) engine.updateView(scrollView(engine.getView(), 1, -1));
    engine.execute("view.zoom200");
    expect(root).toBe(0); expect(views).toBe(101); expect(engine.getSnapshot()).toBe(before); expect(before.dirty).toBe(false);
    engine.execute("edit.undo"); expect(Object.keys(engine.getSnapshot().document.nodes)).toHaveLength(1);
    stopRoot(); stopView();
  });

  it("accepts native lenient booleans for keyboard pan and zoom direction", () => {
    const engine = new EditorEngine(); engine.execute("view.set", { cx: 0, cy: 0 });
    engine.execute("view.pan", { dx: 1, big: "YES" }); expect(engine.getView().cx).toBe(200);
    engine.execute("view.zoomAt", { x: 0, y: 0, out: 1 }); expect(engine.getView().zoom).toBe(0.5);
    engine.execute("view.zoomAt", { x: 0, y: 0, out: "off" }); expect(engine.getView().zoom).toBe(1);
  });

  it("clamps declared viewport dimensions and ignores invalid optional numbers", () => {
    const engine = new EditorEngine(); engine.execute("view.set", { zoom: -1, vw: 0, vh: 50000, cx: "bad" });
    expect(engine.getView()).toMatchObject({ zoom: 0.02, vw: 10, vh: 20000, cx: 500 });
    const before = engine.getView(); expect(() => engine.execute("view.zoomAt", { x: "bad", y: 0 })).toThrow(); expect(engine.getView()).toBe(before);
    expect(() => engine.updateView({ ...before, zoom: Infinity })).toThrow(); expect(engine.getView()).toBe(before);
  });
});

describe("native frame presets", () => {
  it("exposes all39 source presets and honours explicit size/name overrides", () => {
    const engine = new EditorEngine(); expect(engine.execute("frame.presets")).toEqual(framePresets); expect(framePresets).toHaveLength(39);
    const id = String(engine.execute("frame.create", { preset: "a4", width: 200, name: "Custom", x: 10, y: 20 }).id);
    expect(engine.getSnapshot().document.nodes[id]).toMatchObject({ name: "Custom", width: 200, height: 842, x: 10, y: 20 });
    const before = engine.getSnapshot(); expect(() => engine.execute("frame.create", { preset: "unknown" })).toThrow(); expect(engine.getSnapshot()).toBe(before);
  });
  it("places presets at view centre or100px right of the rightmost layer", () => {
    const engine = new EditorEngine(); engine.execute("view.set", { cx: 0, cy: 0 });
    const id = String(engine.execute("frame.create", { preset: "A4" }).id);
    expect(engine.getSnapshot().document.nodes[id]).toMatchObject({ x: -298, y: -421, width: 595, height: 842 });
    const next = String(engine.execute("frame.create", { preset: "A5" }).id);
    expect(engine.getSnapshot().document.nodes[next]).toMatchObject({ x: 397, y: -421 });
    const nested = String(engine.execute("frame.create", { preset: "A6", parent: id }).id);
    expect(engine.getSnapshot().document.nodes[nested]).toMatchObject({ x: 0, y: 0, parent: id });
  });
});
