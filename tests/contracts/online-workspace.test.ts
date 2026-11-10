import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { strFromU8, unzipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { IndexedDbRecoveryStore } from "../../src/backends/browser/recovery";
import type { OnlineFileInfo, OnlineFileStore, RememberedOnlineFile } from "../../src/backends/online-files";
import { EditorWorkspace } from "../../src/engine/workspace";
import { OnlineWorkspace } from "../../src/engine/sharing/online-workspace";
import { onlineServerKey, readRememberedFiles } from "../../src/engine/sharing/remembered-files";

const native = unzipSync(readFileSync(new URL("../fixtures/native-online-ownership.zip", import.meta.url)));
for (const title of ["empty", "corrupt preferences", "normalised address and case-sensitive path", "device bounds",
  "maximum examined preferences", "a restart forgets state and expiry", "bounded Unicode title", "offline and no live transport"]) {
  it("reads the device-visible fields of the native " + title + " fixture", () => {
    const { preferences, expected } = JSON.parse(strFromU8(native[title + ".json"]));
    const rows = readRememberedFiles(preferences.online_files);
    expect(rows).toEqual(expected[0].files.map((row: RememberedOnlineFile) => ({
      file: row.file, server: onlineServerKey(row.server), name: row.name, created: row.created, opened: row.opened,
    })));
    expect(JSON.stringify(rows)).not.toContain("example-owner");
  });
}

it("serialises concurrent device updates and isolates accounts", async () => {
  const db = new IDBFactory();
  const first = new IndexedDbRecoveryStore({ indexedDB: db }), second = new IndexedDbRecoveryStore({ indexedDB: db });
  const base = { server: "https://files.example", opened: 2, created: 1, name: "File" };
  await Promise.all([first.onlineFiles("owner", rows => [{ ...base, file: "a" }, ...rows]),
    second.onlineFiles("owner", rows => [{ ...base, file: "b" }, ...rows])]);
  expect((await first.onlineFiles("owner")).map(row => row.file).sort()).toEqual(["a", "b"]);
  expect(await second.onlineFiles("stranger")).toEqual([]);
  expect(readRememberedFiles([{}, { ...base, file: "../bad" }, { ...base, file: "x", opened: -1 }])).toEqual([]);
  first.close(); second.close();
});

function setup() {
  const workspace = new EditorWorkspace();
  const device = new IndexedDbRecoveryStore({ indexedDB: new IDBFactory() });
  const remote = new Map<string, { info: OnlineFileInfo; bytes: Blob }>();
  const store: OnlineFileStore = {
    async publish(id, bytes) {
      const info = { id, created: "2026-01-01T00:00:00Z", name: "Remote" };
      remote.set(id, { info, bytes }); return info;
    },
    async owned(ids) { return ids.flatMap(id => remote.get(id)?.info ?? []); },
    async open(id) { return remote.get(id)!.bytes; },
    async rename(id, name) { const file = remote.get(id)!; return file.info = { ...file.info, name }; },
    async remove(id) { remote.delete(id); },
  };
  const host = { store, device, server: "https://files.example" };
  const online = new OnlineWorkspace(workspace, host, "owner", () => true);
  return { workspace, device, remote, store, host, online };
}

it("checks only remembered IDs, reuses the source tab, and keeps offline and removed states distinct", async () => {
  const { workspace, device, remote, store, host, online } = setup();
  const lookup = vi.spyOn(store, "owned");
  expect(await online.refresh()).toEqual([]);
  const initial = workspace.getSnapshot()[0];
  const info = await online.publish(initial.id, "Remote");
  expect(lookup).not.toHaveBeenCalled();
  workspace.execute("file.new");
  await online.open(info.id);
  expect(workspace.getSnapshot().find(tab => tab.active)?.id).toBe(initial.id);
  await online.rename(info.id, "Alternate");
  const afterRestart = new OnlineWorkspace(workspace, host, "owner", () => true);
  expect((await afterRestart.list())[0]).toMatchObject({ name: "Alternate", state: "unknown" });
  lookup.mockRejectedValueOnce(new Error("offline"));
  await expect(afterRestart.refresh()).rejects.toThrow("offline");
  expect((await afterRestart.list())[0].name).toBe("Alternate");
  expect((await afterRestart.refresh())[0].state).toBe("online");
  await afterRestart.open(info.id);
  expect(workspace.activeEngine!.getSnapshot().document.name).toBe("Remote");
  const count = workspace.getSnapshot().length;
  await afterRestart.open(info.id);
  expect(workspace.getSnapshot()).toHaveLength(count);
  await afterRestart.forget(info.id);
  expect(remote.has(info.id)).toBe(true);
  expect(await afterRestart.refresh()).toEqual([]);
  workspace.execute("doc.switch", { index: 0 });
  const again = await online.publish(initial.id, "Remote");
  remote.delete(again.id);
  expect((await online.refresh())[0].state).toBe("gone");
  await expect(online.open(again.id)).rejects.toThrow("no longer");
  await online.forget(again.id);
  expect(await online.list()).toEqual([]);
  device.close();
});

it("retries a lost acknowledgement with the original bytes and identity", async () => {
  const { online, workspace, store, device } = setup();
  const source = workspace.getSnapshot()[0].id;
  const publish = vi.spyOn(store, "publish").mockRejectedValueOnce(new Error("reply lost"));
  await expect(online.publish(source, "Remote")).rejects.toThrow("reply lost");
  await online.publish(source, "Remote");
  expect(publish.mock.calls[0][0]).toBe(publish.mock.calls[1][0]);
  expect(publish.mock.calls[0][1]).toBe(publish.mock.calls[1][1]);
  expect(await online.list()).toHaveLength(1);
  device.close();
});
