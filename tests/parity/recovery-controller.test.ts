import { unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveryStore } from "../../src/backends/recovery";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { RecoveryController } from "../../src/engine/recovery";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class MemoryRecoveryStore implements RecoveryStore {
  snapshots = new Map<string, Uint8Array>();
  read = vi.fn(async (principal: string): Promise<Uint8Array | null> => this.snapshots.get(principal)?.slice() ?? null);
  write = vi.fn(async (principal: string, bytes: Uint8Array): Promise<void> => { this.snapshots.set(principal, bytes.slice()); });
  remove = vi.fn(async (principal: string): Promise<void> => { this.snapshots.delete(principal); });
  close = vi.fn();
}

const controllers: RecoveryController[] = [];
function setup(store = new MemoryRecoveryStore(), principal = "account-a") {
  const engine = new EditorEngine();
  const notify = vi.fn();
  const controller = new RecoveryController(engine, store, principal, notify);
  controllers.push(controller);
  return { engine, notify, controller, store };
}

async function snapshot(name: string): Promise<Uint8Array> {
  const engine = new EditorEngine();
  engine.execute("shape.rectangle", { name });
  return engine.nativeSnapshot();
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

describe("host recovery lifecycle", () => {
  it("restores native content without treating recovery as a saved file", async () => {
    const { engine, store, controller, notify } = setup();
    store.snapshots.set("account-a", await snapshot("Recovered rectangle"));
    await controller.start();
    expect(store.read).toHaveBeenCalledWith("account-a");
    expect(engine.getSnapshot().document.nodes["2"].name).toBe("Recovered rectangle");
    expect(engine.getSnapshot()).toMatchObject({ dirty: true, hasSaved: false, canUndo: false });
    expect(notify.mock.calls).toEqual([["loading"], ["ready"]]);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("keeps a damaged recovery archive until the recovered drawing is edited", async () => {
    const { engine, store, controller, notify } = setup();
    const original = new EditorEngine();
    original.execute("page.add");
    const members = unzipSync(await original.nativeSnapshot());
    const native = JSON.parse(new TextDecoder().decode(members["document.json"]));
    native.imageIndex = [{ hash: "lost" }];
    members["document.json"] = new TextEncoder().encode(JSON.stringify(native));
    const archive = zipSync(members);
    store.snapshots.set("account-a", archive);
    await controller.start();
    expect(notify).toHaveBeenLastCalledWith("ready", expect.stringContaining("image lost"));
    engine.execute("page.select", { id: "1" });
    await controller.flush();
    expect(store.write).not.toHaveBeenCalled();
    engine.execute("shape.rectangle");
    await controller.flush();
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it("debounces document edits and ignores tool-only state changes", async () => {
    vi.useFakeTimers();
    const { engine, store, controller, notify } = setup();
    await controller.start();
    engine.execute("tool.rectangle");
    expect(notify.mock.calls).toEqual([["loading"], ["ready"]]);
    engine.execute("shape.rectangle", { name: "First" });
    await vi.advanceTimersByTimeAsync(200);
    engine.execute("shape.rectangle", { name: "Second" });
    await vi.advanceTimersByTimeAsync(249);
    expect(store.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.write).toHaveBeenCalledTimes(1);
    const recovered = await decodeFigcraft(store.write.mock.calls[0][1]);
    expect(recovered.document).toEqual(engine.getSnapshot().document);
    expect(notify).toHaveBeenLastCalledWith("stored");
    expect(engine.getSnapshot()).toMatchObject({ dirty: true, hasSaved: false });
  });

  it("captures each flush revision and serialises writes while a previous write is pending", async () => {
    const { engine, store, controller, notify } = setup();
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    store.write.mockImplementationOnce(async () => { firstStarted.resolve(); await releaseFirst.promise; });
    await controller.start();
    engine.execute("shape.rectangle", { name: "First" });
    const firstDocument = engine.getSnapshot().document;
    const firstFlush = controller.flush();
    await firstStarted.promise;
    engine.execute("shape.rectangle", { name: "Second" });
    const secondDocument = engine.getSnapshot().document;
    const secondFlush = controller.flush();
    await Promise.resolve();
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalledWith("stored");
    releaseFirst.resolve();
    await Promise.all([firstFlush, secondFlush]);
    expect(store.write).toHaveBeenCalledTimes(2);
    expect((await decodeFigcraft(store.write.mock.calls[0][1])).document).toEqual(firstDocument);
    expect((await decodeFigcraft(store.write.mock.calls[1][1])).document).toEqual(secondDocument);
    expect(notify.mock.calls.filter(([status]) => status === "stored")).toHaveLength(1);
    expect(notify).toHaveBeenLastCalledWith("stored");
  });

  it("reports write failures and allows a subsequent snapshot to succeed", async () => {
    const { engine, store, controller, notify } = setup();
    store.write.mockRejectedValueOnce(new Error("Storage quota exceeded"));
    await controller.start();
    engine.execute("shape.rectangle");
    await controller.flush();
    expect(notify).toHaveBeenLastCalledWith("error", "Storage quota exceeded");
    expect(engine.getSnapshot()).toMatchObject({ dirty: true, hasSaved: false });
    engine.execute("shape.rectangle");
    await controller.flush();
    expect(store.write).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith("stored");
  });

  it("reports invalid recovery data without replacing the document and still stores later edits", async () => {
    const { engine, store, controller, notify } = setup();
    const before = engine.getSnapshot().document;
    store.snapshots.set("account-a", new TextEncoder().encode("broken file"));
    await controller.start();
    expect(notify).toHaveBeenLastCalledWith("error", expect.stringContaining("Cannot open Figcraft file"));
    expect(engine.getSnapshot().document).toBe(before);
    engine.execute("shape.rectangle");
    await controller.flush();
    expect(notify).toHaveBeenLastCalledWith("stored");
  });

  it("never restores or subscribes after disposal during a delayed read", async () => {
    const { engine, store, controller, notify } = setup();
    const read = deferred<Uint8Array | null>();
    store.read.mockReturnValueOnce(read.promise);
    const before = engine.getSnapshot().document;
    const starting = controller.start();
    controller.dispose();
    read.resolve(await snapshot("Previous account"));
    await starting;
    expect(engine.getSnapshot().document).toBe(before);
    engine.execute("shape.rectangle");
    await controller.flush();
    expect(store.write).not.toHaveBeenCalled();
    expect(notify.mock.calls).toEqual([["loading"]]);
  });

  it.each([false, true])("does not report completion after disposal of an in-flight write (failure: %s)", async (fails) => {
    const { engine, store, controller, notify } = setup();
    const started = deferred<void>();
    const finish = deferred<void>();
    store.write.mockImplementationOnce(async () => { started.resolve(); await finish.promise; });
    await controller.start();
    engine.execute("shape.rectangle");
    const flushing = controller.flush();
    await started.promise;
    controller.dispose();
    const callsAtDisposal = notify.mock.calls.slice();
    if (fails) finish.reject(new Error("Late storage failure"));
    else finish.resolve();
    await flushing;
    expect(notify.mock.calls).toEqual(callsAtDisposal);
    engine.execute("shape.rectangle");
    await controller.flush();
    expect(store.write).toHaveBeenCalledTimes(1);
    // Store ownership belongs to the host; disposing one controller must not close shared storage.
    expect(store.close).not.toHaveBeenCalled();
  });

  it("restores and writes only the selected principal when controllers share a store", async () => {
    const store = new MemoryRecoveryStore();
    store.snapshots.set("account-a", await snapshot("A"));
    store.snapshots.set("account-b", await snapshot("B"));
    const a = setup(store, "account-a");
    const b = setup(store, "account-b");
    await Promise.all([a.controller.start(), b.controller.start()]);
    expect(a.engine.getSnapshot().document.nodes["2"].name).toBe("A");
    expect(b.engine.getSnapshot().document.nodes["2"].name).toBe("B");
    a.engine.execute("shape.rectangle", { name: "A edit" });
    b.engine.execute("shape.rectangle", { name: "B edit" });
    await Promise.all([a.controller.flush(), b.controller.flush()]);
    expect(store.write.mock.calls.map(([principal]) => principal).sort()).toEqual(["account-a", "account-b"]);
    expect((await decodeFigcraft(store.snapshots.get("account-a")!)).document).toEqual(a.engine.getSnapshot().document);
    expect((await decodeFigcraft(store.snapshots.get("account-b")!)).document).toEqual(b.engine.getSnapshot().document);
  });

  it("cancels a restore already decoding when the controller is disposed", async () => {
    const { engine, store, controller, notify } = setup();
    store.snapshots.set("account-a", await snapshot("Disposed account"));
    const before = engine.getSnapshot().document;
    const starting = controller.start();
    // read() has resolved; file.recover is now awaiting its native decode result.
    await Promise.resolve();
    controller.dispose();
    await starting;
    expect(engine.getSnapshot().document).toBe(before);
    expect(notify.mock.calls).toEqual([["loading"]]);
  });
});
