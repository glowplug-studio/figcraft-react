import { describe, expect, it } from "vitest";
import { EditorWorkspace } from "../../src/engine/workspace";
import native from "../fixtures/file-tabs.json";

describe("native file workspace", () => {
  it("replays the pinned Rust session, including unsaved refusal and moving across the active tab", () => {
    const workspace = new EditorWorkspace();
    const baseId = workspace.getSnapshot()[0].id - 1;
    for (const { command, params, expected } of native) {
      let result: unknown;
      try {
        if (command === "doc.list") {
          result = workspace.execute(command).map(tab => ({ ...tab, id: tab.id - baseId }));
        } else if (command === "file.rename") result = workspace.activeEngine!.execute(command, params);
        else result = workspace.execute(command as "file.new", params);
      } catch (error) { result = { error: (error as Error).message }; }
      expect(result, command).toEqual(expected);
    }
  });

  it("keeps each document's selection, viewport, allocator, download baseline and undo history", () => {
    const workspace = new EditorWorkspace(), first = workspace.activeEngine!;
    first.execute("shape.rectangle");
    first.execute("file.markSaved");
    const view = first.getView(), snapshot = first.getSnapshot();
    workspace.execute("file.new", { name: "Untitled" });
    const second = workspace.activeEngine!;
    expect(second.execute("shape.rectangle")).toEqual({ id: "2" });
    workspace.execute("doc.previousTab");
    expect(workspace.activeEngine).toBe(first);
    expect(first.getSnapshot()).toBe(snapshot);
    expect(first.getView()).toBe(view);
    expect(first.execute("shape.rectangle")).toEqual({ id: "3" });
    first.execute("edit.undo");
    expect(first.getSnapshot().dirty).toBe(false);
    expect(second.getSnapshot().dirty).toBe(true);
    workspace.execute("file.duplicate");
    const copy = workspace.activeEngine!;
    expect(copy.getSnapshot().document.name).toBe("Untitled (Copy)");
    expect(copy.getSnapshot()).toMatchObject({ canUndo: false, dirty: false, selection: [] });
    expect(copy.execute("shape.rectangle")).toEqual({ id: "4" });
    expect(first.getSnapshot().document.nodes["4"]).toBeUndefined();
  });

  it("supports the empty workspace and rejects invalid indices without changing state", () => {
    const workspace = new EditorWorkspace(), before = workspace.getSnapshot();
    expect(() => workspace.execute("file.moveTab", { from: 1, to: 0 })).toThrow();
    expect(workspace.getSnapshot()).toBe(before);
    workspace.execute("file.close");
    expect(workspace.getSnapshot()).toEqual([]);
    expect(() => workspace.execute("doc.nextTab")).toThrow();
    workspace.execute("file.new");
    expect(workspace.getSnapshot()[0].id).toBeGreaterThan(before[0].id);
  });

  it("prevents edits to closed tabs and pending opens from crossing an identity change", async () => {
    const workspace = new EditorWorkspace(), first = workspace.activeEngine!;
    const bytes = await first.captureNativeSnapshot()();
    const pending = workspace.open(new File([bytes], "Draft.figcraft"));
    workspace.setEditable(false);
    workspace.setEditable(true);
    await expect(pending).rejects.toThrow(/identity changed/);
    workspace.execute("file.close");
    expect(() => first.execute("shape.rectangle")).toThrow();
    await workspace.open(new File([bytes], "Draft.figcraft"));
    expect(workspace.getSnapshot()).toHaveLength(1);
    expect(workspace.getSnapshot()[0].dirty).toBe(false);
  });
});

it("keeps native filesystem recents empty for browser byte opens and downloads", async () => {
  const workspace = new EditorWorkspace();
  const source = await workspace.activeEngine!.nativeSnapshot();
  await workspace.open(new File([Uint8Array.from(source)], "Saved.figcraft"));
  (await workspace.prepareDownload()).delivered();
  expect(workspace.execute("file.openRecent")).toEqual({ files: [] });
  expect(workspace.execute("file.openRecent", { clear: true })).toEqual({ files: [] });
  expect(() => workspace.execute("file.openRecent", { index: 0 })).toThrow(/no such recent file/i);
  expect(() => workspace.execute("file.revert")).toThrow(/never saved/i);
});
