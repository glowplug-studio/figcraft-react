import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";

describe("page commands in editor transactions", () => {
  it("page navigation is not a dirty content change or undo entry", () => {
    const engine = new EditorEngine();
    engine.execute("page.add", { name: "Second" });
    engine.execute("file.markSaved");
    engine.execute("page.select", { id: "1" });
    expect(engine.getSnapshot().dirty).toBe(false);
    expect(engine.execute("page.list").map(page => page.current)).toEqual([true, false]);
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document.pages).toEqual(["1"]);
    expect(engine.getSnapshot().dirty).toBe(true);
    engine.execute("edit.redo");
    expect(engine.getSnapshot().dirty).toBe(false);
  });
  it("restores page and selection with each undo/redo and never rewinds IDs", () => {
    const engine = new EditorEngine();
    const first = engine.execute("shape.rectangle").id;
    const secondPage = engine.execute("page.add").id;
    expect(engine.getSnapshot().selection).toEqual([]);
    const second = engine.execute("shape.rectangle").id;
    engine.execute("page.delete");
    expect(engine.getSnapshot().document.currentPage).toBe("1");
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document.currentPage).toBe(secondPage);
    expect(engine.getSnapshot().selection).toEqual([second]);
    engine.execute("edit.undo"); engine.execute("edit.undo");
    expect(engine.getSnapshot().selection).toEqual([first]);
    expect(engine.getSnapshot().document.currentPage).toBe("1");
    expect(engine.execute("page.add").id).toBe("5");
    expect(engine.getSnapshot().canRedo).toBe(false);
  });
  it("invalid page commands preserve snapshot, selection and redo history", () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle"); engine.execute("edit.undo");
    const before = engine.getSnapshot();
    for (const [command, params] of [["page.delete", {}], ["page.rename", { name: "-" }], ["page.select", { index: .5 }], ["page.duplicate", { id: "999" }]] as const) {
      expect(() => engine.execute(command, params)).toThrow();
      expect(engine.getSnapshot()).toBe(before);
    }
    expect(engine.execute("edit.redo")).toEqual({ redone: true });
  });
  it("round-trips multiple pages, divider order, duplicate content and current page through native files", async () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle", { x: 12, name: "Original" });
    engine.execute("page.add", { name: "- Divider" });
    engine.execute("page.duplicate", { id: "1" });
    const before = engine.getSnapshot().document;
    const saved = await engine.executeAsync("file.saveAs", { data: true });
    await engine.executeAsync("file.open", { data: saved.data });
    expect(engine.getSnapshot().document).toEqual(before);
    expect(engine.execute("page.list").map(page => page.divider)).toEqual([false, false, true]);
  });
  it("denies page mutation after host identity revocation", () => {
    const engine = new EditorEngine(); engine.setEditable(false);
    const before = engine.getSnapshot();
    expect(() => engine.execute("page.add")).toThrow("Sign in");
    expect(engine.getSnapshot()).toBe(before);
  });
});
