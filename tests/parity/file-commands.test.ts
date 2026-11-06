import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";
import { decodeFigcraft } from "../../src/engine/file-format";

const native = readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url));
const data = base64Bytes(native);
describe("native file command transactions", () => {
  it("opens native data as an unsaved document and clears old history and selection", async () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle");
    await engine.executeAsync("file.open", { data, name: "fixture.figcraft" });
    const snapshot = engine.getSnapshot();
    expect(snapshot).toMatchObject({ dirty: true, hasSaved: false, selection: [], canUndo: false, canRedo: false, tool: "move" });
    expect(snapshot.document).toEqual((await decodeFigcraft(native)).document);
    expect(engine.execute("shape.rectangle").id).toBe((await decodeFigcraft(native)).nextId);
  });
  it("marks only the captured saved revision clean and recognises undo back to it", async () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle", { width: 31 });
    const captured = engine.getSnapshot().document;
    const saving = engine.executeAsync("file.saveAs", { data: true });
    engine.execute("shape.rectangle", { width: 47 });
    const result = await saving;
    expect((await decodeFigcraft(Uint8Array.from(atob(String(result.data)), c => c.charCodeAt(0)))).document).toEqual(captured);
    expect(engine.execute("file.markSaved", { revision: result.revision })).toEqual({ saved: true });
    expect(engine.getSnapshot()).toMatchObject({ dirty: true, hasSaved: true });
    engine.execute("edit.undo");
    expect(engine.getSnapshot().dirty).toBe(false);
    engine.execute("edit.redo");
    expect(engine.getSnapshot().dirty).toBe(true);
    expect(engine.execute("file.markSaved", { revision: result.revision })).toEqual({ saved: false });
  });
  it.each(["!invalid base64!", base64Bytes(new TextEncoder().encode('{"format":"other"}'))])("rejects invalid input without changing state", async invalid => {
    const engine = new EditorEngine(); engine.execute("shape.rectangle");
    const before = engine.getSnapshot();
    await expect(engine.executeAsync("file.open", { data: invalid })).rejects.toThrow();
    expect(engine.getSnapshot()).toBe(before);
    expect(engine.execute("edit.undo")).toEqual({ undone: true });
  });
  it("does not overwrite edits made during file decoding", async () => {
    const engine = new EditorEngine();
    const opening = engine.executeAsync("file.open", { data });
    engine.execute("shape.rectangle", { name: "Keep this edit" });
    const edited = engine.getSnapshot();
    await expect(opening).rejects.toThrow("cancelled");
    expect(engine.getSnapshot()).toBe(edited);
  });
  it("only the latest concurrent open can replace the document", async () => {
    const engine = new EditorEngine();
    const first = engine.executeAsync("file.open", { data });
    const second = engine.executeAsync("file.open", { data });
    await expect(first).rejects.toThrow("cancelled");
    await second;
    expect(engine.getSnapshot().document).toEqual((await decodeFigcraft(native)).document);
  });
  it.each(["file.open", "file.recover", "file.saveAs"])("cancels %s on identity revocation", async command => {
    const engine = new EditorEngine();
    const running = engine.executeAsync(command, command === "file.saveAs" ? { data: true } : { data });
    engine.setEditable(false);
    const before = engine.getSnapshot();
    await expect(running).rejects.toThrow("cancelled");
    expect(engine.getSnapshot()).toBe(before);
  });
  it("preserves allocator monotonicity after undone edits are saved and reopened", async () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle"); engine.execute("shape.rectangle"); engine.execute("edit.undo");
    const saved = await engine.executeAsync("file.saveAs", { data: true });
    await engine.executeAsync("file.open", { data: saved.data });
    expect(engine.execute("shape.rectangle").id).toBe("4");
  });
  it("can save the last u64 allocation and rejects the next creation atomically", async () => {
    const engine = new EditorEngine();
    const source = native.toString().replace('"next_id": 3', '"next_id": 18446744073709551615');
    await engine.executeAsync("file.open", { data: base64Bytes(new TextEncoder().encode(source)) });
    expect(engine.execute("shape.rectangle").id).toBe("18446744073709551615");
    await expect(engine.nativeSnapshot()).resolves.toBeInstanceOf(Uint8Array);
    const before = engine.getSnapshot();
    expect(() => engine.execute("shape.rectangle")).toThrow("exhausted");
    expect(engine.getSnapshot()).toBe(before);
  });
});
