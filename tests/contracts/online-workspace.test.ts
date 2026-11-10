import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { strFromU8, unzipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { IndexedDbRecoveryStore } from "../../src/backends/browser/recovery";
import type { OnlineFileInfo, OnlineFileStore, OnlineInvitations, RememberedOnlineFile } from "../../src/backends/online-files";
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
  expect(await publish.mock.calls[0][1].arrayBuffer()).toEqual(await publish.mock.calls[1][1].arrayBuffer());
  expect(await online.list()).toHaveLength(1);
  device.close();
});

it("recovers a confirmed publication after a lost response without uploading or resurrecting it", async () => {
  const { workspace, host, device, remote, store } = setup();
  let signedIn = true;
  const first = new OnlineWorkspace(workspace, host, "owner", () => signedIn);
  const accept = store.publish.bind(store);
  const publish = vi.spyOn(store, "publish").mockImplementationOnce(async (id, bytes) => {
    const info = await accept(id, bytes);
    signedIn = false;
    return info;
  });
  await expect(first.publish(workspace.getSnapshot()[0].id, "Remote")).rejects.toThrow("account changed");
  const [id] = remote.keys();
  const restored = new OnlineWorkspace(new EditorWorkspace(), host, "owner", () => true);
  const stranger = new OnlineWorkspace(new EditorWorkspace(), host, "stranger", () => true);
  expect(await stranger.refresh()).toEqual([]);
  expect((await restored.list())[0]).toMatchObject({ file: id, state: "pending" });
  expect((await restored.refresh())[0]).toMatchObject({ file: id, state: "online" });
  expect((await device.onlineRegistry("owner")).pending).toEqual([]);
  remote.delete(id);
  expect((await restored.refresh())[0].state).toBe("gone");
  await restored.retryPublication(id);
  expect(publish).toHaveBeenCalledTimes(1);
  device.close();
});

it("retries the captured bytes after a restart only on explicit request", async () => {
  const { workspace, host, device, online, store } = setup();
  const publish = vi.spyOn(store, "publish").mockRejectedValueOnce(new Error("upload interrupted"));
  await expect(online.publish(workspace.getSnapshot()[0].id, "Initial")).rejects.toThrow("interrupted");
  const [id, original] = publish.mock.calls[0];
  const restored = new OnlineWorkspace(new EditorWorkspace(), host, "owner", () => true);
  expect(await restored.refresh()).toMatchObject([{ file: id, state: "pending" }]);
  expect(publish).toHaveBeenCalledTimes(1);
  await restored.retryPublication(id);
  expect(publish.mock.calls[1][0]).toBe(id);
  expect(await publish.mock.calls[1][1].arrayBuffer()).toEqual(await original.arrayBuffer());
  expect((await restored.list())[0].state).toBe("online");
  expect((await device.onlineRegistry("owner")).pending).toEqual([]);
  device.close();
});

it("keeps a concurrent device forget in effect after the server answers", async () => {
  const { workspace, host, device, online, store, remote } = setup();
  const other = new OnlineWorkspace(new EditorWorkspace(), host, "owner", () => true);
  const accept = store.publish.bind(store);
  vi.spyOn(store, "publish").mockImplementationOnce(async (id, bytes) => {
    await other.forget(id);
    return accept(id, bytes);
  });
  const file = await online.publish(workspace.getSnapshot()[0].id, "Remote");
  expect(remote.has(file.id)).toBe(true);
  expect(await other.refresh()).toEqual([]);
  device.close();
});

it("keeps the previous owner-list format readable without a database reset", async () => {
  const { readOnlineRegistry } = await import("../../src/engine/sharing/remembered-files");
  const row = { server: "https://files.example", file: "old", name: "Old", created: 1, opened: 2 };
  expect(readOnlineRegistry([row])).toEqual({ files: [row], pending: [] });
  expect(readOnlineRegistry({ files: [row], pending: [{ ...row, started: 0, snapshot: "broken" }] })).toEqual({ files: [row], pending: [] });
});

it("retains the pending snapshot if the server returns malformed ownership metadata", async () => {
  const { workspace, host, device, online, store } = setup();
  vi.spyOn(store, "publish").mockImplementationOnce(async id => ({ id, created: "invalid", name: "Remote" }));
  await expect(online.publish(workspace.getSnapshot()[0].id, "Remote")).rejects.toThrow("invalid publication receipt");
  const restored = new OnlineWorkspace(new EditorWorkspace(), host, "owner", () => true);
  const [row] = await restored.refresh();
  expect(row.state).toBe("pending");
  await restored.retryPublication(row.file);
  expect((await restored.list())[0].state).toBe("online");
  device.close();
});

it("leaves the server untouched when the device cannot retain the publication", async () => {
  const { workspace, device, online, store } = setup();
  const upload = vi.spyOn(store, "publish");
  vi.spyOn(device, "onlineRegistry").mockRejectedValueOnce(new DOMException("Device storage is full", "QuotaExceededError"));
  await expect(online.publish(workspace.getSnapshot()[0].id, "Remote")).rejects.toThrow("Device storage is full");
  expect(upload).not.toHaveBeenCalled();
  expect(await online.list()).toEqual([]);
  device.close();
});

it("keeps the original link credentials private to the host, stable across tabs, and erases them on forget", async () => {
  const { online, workspace, device } = setup();
  const file = await online.publish(workspace.getSnapshot()[0].id, "Private receipt");
  const [first, second] = await Promise.all([device.publicationLinks("owner", online.server, file.id),
    device.publicationLinks("owner", online.server, file.id)]);
  expect(first).toEqual(second);
  expect(first.edit.token).toMatch(/^[a-zA-Z0-9_-]{22}$/);
  expect(first.view.token).not.toEqual(first.edit.token);
  expect(JSON.stringify(await device.onlineRegistry("owner"))).not.toContain(first.edit.token);
  await expect(device.publicationLinks("different", online.server, file.id)).rejects.toThrow("forgotten");
  await online.forget(file.id);
  await expect(device.publicationLinks("owner", online.server, file.id)).rejects.toThrow("forgotten");
  // Remembering the same ID again does not resurrect the forgotten keys.
  await device.onlineFiles("owner", () => [{ file: file.id, server: online.server, name: "Again", created: 1, opened: 1 }]);
  expect((await device.publicationLinks("owner", online.server, file.id)).edit.token).not.toEqual(first.edit.token);
  device.close();
});

it("keeps an ended guest session on its own tab until leave and preserves local edits on rejoin", async () => {
  const workspace = new EditorWorkspace(), document = workspace.activeEngine!;
  const archive = await document.saveFile();
  const view = {connection: crypto.randomUUID(), file: "review", access: "view" as const};
  await workspace.open(new File([archive.data], "Review.figcraft"), view);
  const guest = workspace.activeEngine!;
  expect(guest.getSnapshot().editable).toBe(false);
  expect(workspace.setGuestSession({...view, ended: "stopped"})).toBe(true);
  expect(workspace.getSnapshot().find(tab => tab.active)?.guest?.ended).toBe("stopped");
  expect(guest.getSnapshot().editable).toBe(true);
  guest.execute("shape.rectangle");
  const localDocument = guest.getSnapshot().document;
  expect(Object.keys(localDocument.nodes)).toHaveLength(2);
  workspace.setEditable(false);
  expect(guest.getSnapshot().editable).toBe(false);
  workspace.setEditable(true);
  expect(guest.getSnapshot().editable).toBe(true);
  expect(workspace.setGuestSession({...view, file: "different"})).toBe(false);
  expect(workspace.setGuestSession(view)).toBe(true);
  expect(guest.getSnapshot().editable).toBe(false);
  expect(guest.getSnapshot().document).toBe(localDocument);
  workspace.leaveSession(view.connection);
  expect(workspace.getSnapshot().find(tab => tab.active)?.guest).toBeUndefined();
  expect(guest.getSnapshot().editable).toBe(true);
});

it("publishing a second file from a tab keeps each server drawing attached to its own tab", async () => {
  const {workspace, online} = setup();
  const firstTab = workspace.getSnapshot()[0].id;
  const first = await online.publish(firstTab, "First");
  const second = await online.publish(firstTab, "Second");
  expect(online.publishedFile(firstTab)).toBe(second.id);
  await online.open(first.id);
  const reopened = workspace.getSnapshot().find(tab => tab.active)!;
  expect(reopened.id).not.toBe(firstTab);
  expect(online.publishedFile(reopened.id)).toBe(first.id);
});

it("retries an interrupted owner join on the same confirmed publication", async () => {
  const {workspace, host, store, device} = setup();
  const publish = vi.spyOn(store, "publish");
  const invitations: OnlineInvitations = {
    joinOwned: vi.fn(async (file: string) => ({
      session: {file, access: "edit" as const, connection: crypto.randomUUID(), openedAsOwner: true as const},
      archive: await store.open(file),
    })).mockRejectedValueOnce(new Error("lost welcome")),
    showJoin() {}, subscribe: () => () => {}, copyPublished: vi.fn(), leave: vi.fn(),
  };
  const online = new OnlineWorkspace(workspace, {...host, invitations}, "owner", () => true);
  const source = workspace.getSnapshot()[0].id;
  await expect(online.publish(source, "Remote")).rejects.toThrow("lost welcome");
  expect(await online.list()).toHaveLength(1);
  const receipt = await online.publish(source, "Remote");
  expect(publish).toHaveBeenCalledTimes(1);
  expect(workspace.getSnapshot()).toHaveLength(1);
  expect(workspace.getSnapshot()[0].guest).toMatchObject({file: receipt.id, access: "edit", openedAsOwner: true});
  await online.open(receipt.id);
  expect(invitations.joinOwned).toHaveBeenCalledTimes(2);
  const prior = workspace.getSnapshot()[0].guest!.connection;
  await online.publish(source, "Second");
  expect(invitations.leave).toHaveBeenCalledWith(prior);
  device.close();
});

it("opens a pre-link owner archive as a local copy but never bypasses a refused original link", async () => {
  const {workspace, online, host, store, device} = setup();
  const id = (await online.publish(workspace.getSnapshot()[0].id, "Remote")).id;
  const read = vi.spyOn(store, "open");
  const invitations: OnlineInvitations = {
    joinOwned: vi.fn(async () => undefined).mockRejectedValueOnce(new Error("The invite is unavailable")),
    showJoin() {}, subscribe: () => () => {}, copyPublished: vi.fn(), leave: vi.fn(),
  };
  const next = new OnlineWorkspace(workspace, {...host, invitations}, "owner", () => true);
  await expect(next.open(id)).rejects.toThrow("The invite is unavailable");
  expect(read).not.toHaveBeenCalled();
  await next.open(id);
  expect(read).toHaveBeenCalledOnce();
  expect(workspace.getSnapshot().find(tab => tab.active)?.guest).toBeUndefined();
  device.close();
});

it("keeps pending owner changes across tabs and excludes credentials from public listings", async () => {
  const db = new IDBFactory();
  const first = new IndexedDbRecoveryStore({indexedDB: db}), second = new IndexedDbRecoveryStore({indexedDB: db});
  const record = {server: "https://files.example", file: "a", opened: 2, created: 1, name: "Shared"};
  const pending = {seed: "a".repeat(64), expected: null, revision: crypto.randomUUID(), revoke: []};
  await first.onlineFiles("owner", () => [record]);
  const stage = (device: IndexedDbRecoveryStore, seed: string) => device.ownerSharing("owner", record.server, record.file,
    row => row.pending ? row : {...row, pending: {...pending, seed}});
  const [a, b] = await Promise.all([stage(first, pending.seed), stage(second, "b".repeat(64))]);
  expect(a.pending).toBeDefined();
  expect(a).toEqual(b);
  first.close();
  expect(await second.ownerSharing("owner", record.server, record.file)).toEqual(a);
  expect(JSON.stringify(await second.onlineRegistry("owner"))).not.toContain(a.pending!.seed);
  await expect(second.ownerSharing("stranger", record.server, record.file)).rejects.toThrow("not remembered");
  await second.onlineFiles("owner", () => []);
  await expect(stage(second, pending.seed)).rejects.toThrow("not remembered");
  await second.onlineFiles("owner", () => [record]);
  expect(await second.ownerSharing("owner", record.server, record.file)).toEqual({links: []});
  second.close();
});
