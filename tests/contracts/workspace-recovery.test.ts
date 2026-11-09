import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { IndexedDbRecoveryStore } from "../../src/backends/browser/recovery";
import { EditorWorkspace } from "../../src/engine/workspace";
import { WorkspaceRecovery } from "../../src/engine/workspace-recovery";
import { EditorEngine } from "../../src/engine/editor";

it("migrates legacy archives, restores ordered tabs and keeps an intentionally empty workspace", async () => {
  const store = new IndexedDbRecoveryStore({ indexedDB: new IDBFactory() });
  const legacy = new EditorEngine("Legacy");
  legacy.execute("shape.rectangle");
  await store.write("alice", await legacy.nativeSnapshot());
  await store.write("bob", await new EditorEngine("Bob").nativeSnapshot());
  const workspace = new EditorWorkspace(), notify = vi.fn();
  const controller = new WorkspaceRecovery(workspace, store, "alice", notify);
  await controller.start();
  expect(workspace.getSnapshot()[0].name).toBe("Legacy");
  const encodeLegacy = vi.spyOn(workspace.activeEngine!, "captureNativeSnapshot");
  workspace.execute("file.new", { name: "Second" });
  workspace.execute("file.moveTab", { from: 1, to: 0 });
  await controller.flush();
  controller.dispose();
  expect(await store.read("alice")).toBeNull();
  expect(await store.read("bob")).not.toBeNull();
  expect(encodeLegacy.mock.calls.length).toBeLessThanOrEqual(1);
  const restored = new EditorWorkspace(), next = new WorkspaceRecovery(restored, store, "alice", notify);
  await next.start();
  expect(restored.getSnapshot().map(tab => [tab.name, tab.active])).toEqual([["Second", true], ["Legacy", false]]);
  restored.execute("file.close", { force: true });
  restored.execute("file.close", { force: true });
  await next.flush();
  next.dispose();
  expect(await store.readWorkspace("alice")).toEqual({ files: [], active: 0 });
  await store.remove("alice");
  expect(await store.readWorkspace("alice")).toBeNull();
  store.close();
});

it("cannot resurrect a closed document when its previous write completes late", async () => {
  const store = new IndexedDbRecoveryStore({ indexedDB: new IDBFactory() });
  const workspace = new EditorWorkspace();
  const controller = new WorkspaceRecovery(workspace, store, "alice", vi.fn());
  await controller.start();
  const write = store.writeWorkspace.bind(store);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = vi.spyOn(store, "writeWorkspace").mockImplementationOnce(async (...args) => {
    await blocked;
    return write(...args);
  });
  workspace.execute("file.new", { name: "Remove me" });
  const pending = controller.flush();
  await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
  workspace.execute("file.close");
  release();
  await pending;
  expect((await store.readWorkspace("alice"))!.files).toHaveLength(1);
  controller.dispose();
  store.close();
});

it("keeps a corrupt recovery record recoverable while the user edits a fresh drawing", async () => {
  const store = new IndexedDbRecoveryStore({ indexedDB: new IDBFactory() });
  await store.write("alice", Uint8Array.of(1, 2, 3));
  const workspace = new EditorWorkspace(), notify = vi.fn();
  const controller = new WorkspaceRecovery(workspace, store, "alice", notify);
  await controller.start();
  expect(notify.mock.lastCall?.[0].status).toBe("error");
  workspace.activeEngine!.execute("shape.rectangle");
  await controller.flush();
  expect(await store.read("alice")).toEqual(Uint8Array.of(1, 2, 3));
  controller.dispose();
  store.close();
});
