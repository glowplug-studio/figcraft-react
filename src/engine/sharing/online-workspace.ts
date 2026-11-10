import type { OnlineWorkspaceHost, RememberedOnlineFile } from "../../backends/online-files";
import type { EditorWorkspace } from "../workspace";
import { prepareOnlineSnapshot } from "./publication";
import { onlineServerKey } from "./remembered-files";

export type OnlineRow = RememberedOnlineFile & { state: "unknown" | "online" | "gone" };

export class OnlineWorkspace {
  readonly server: string;
  private states = new Map<string, OnlineRow["state"]>();
  private tabs = new Map<string, number>();
  private pending = new Map<number, { id: string; name: string; snapshot: Blob }>();
  private operation = false;

  constructor(private workspace: EditorWorkspace, private host: OnlineWorkspaceHost,
    private principal: string, private authorised: () => boolean) {
    this.server = onlineServerKey(host.server);
    if (!this.server) throw new Error("Invalid online server address");
  }

  private check() {
    if (!this.authorised()) throw new Error("The signed-in account changed");
  }

  private async run<T>(action: () => Promise<T>) {
    this.check();
    if (this.operation) throw new Error("Asking the server…");
    this.operation = true;
    try { return await action(); } finally { this.operation = false; }
  }

  private records(update?: (records: readonly RememberedOnlineFile[]) => readonly RememberedOnlineFile[]) {
    this.check();
    return this.host.device.onlineFiles(this.principal, update && (records => {
      this.check();
      return update(records);
    }));
  }

  private matches(record: RememberedOnlineFile, id: string) {
    return record.server === this.server && record.file === id;
  }

  async list(): Promise<OnlineRow[]> {
    const records = await this.records();
    this.check();
    return records.filter(record => record.server === this.server).map(record => ({
      ...record, state: this.states.get(record.file) ?? "unknown",
    }));
  }

  async refresh() {
    return this.run(async () => {
      const remembered = await this.list();
      if (!remembered.length) return [];
      const remote = await this.host.store.owned(remembered.map(row => row.file));
      this.check();
      const byId = new Map(remote.map(row => [row.id, row]));
      const prior = new Map(remembered.map(row => [row.file, row.name]));
      await this.records(records => records.map(record => {
        const listing = byId.get(record.file);
        return record.server === this.server && listing && prior.get(record.file) === record.name
          ? { ...record, name: listing.name } : record;
      }));
      for (const row of remembered) this.states.set(row.file, byId.has(row.file) ? "online" : "gone");
      return this.list();
    });
  }

  async publish(tabId: number, name: string) {
    return this.run(async () => {
      const active = this.workspace.getSnapshot().find(tab => tab.active);
      const engine = this.workspace.activeEngine;
      if (!engine || active?.id !== tabId) throw new Error("The source file changed");
      let attempt = this.pending.get(tabId);
      if (attempt && attempt.name !== name) throw new Error("Retry the pending publication with its original file name");
      if (!attempt) {
        const { document, nextId } = engine.archiveRevision;
        const snapshot = await prepareOnlineSnapshot(document, nextId, name);
        this.check();
        if (!this.workspace.getSnapshot().some(tab => tab.id === tabId)) throw new Error("The source file closed");
        attempt = { id: crypto.randomUUID(), snapshot, name };
        this.pending.set(tabId, attempt);
      }
      const file = await this.host.store.publish(attempt.id, attempt.snapshot);
      const opened = Math.floor(Date.now() / 1000);
      const entry = { server: this.server, file: file.id, name: file.name, created: Math.floor(Date.parse(file.created) / 1000), opened };
      // A server acknowledgement must be remembered even if the source tab has since closed.
      await this.records(records => [entry, ...records.filter(record => !this.matches(record, file.id))]);
      this.states.set(file.id, "online");
      this.tabs.set(file.id, tabId);
      this.pending.delete(tabId);
      return file;
    });
  }

  async open(id: string) {
    return this.run(async () => {
      const entry = (await this.list()).find(record => record.file === id);
      if (!entry || entry.state === "gone") throw new Error("This file is no longer on its server");
      const tab = this.workspace.getSnapshot().find(tab => tab.id === this.tabs.get(id));
      if (tab) {
        this.workspace.execute("doc.switch", { index: tab.index });
        return;
      }
      const bytes = await this.host.store.open(id);
      this.check();
      const result = await this.workspace.open(new File([bytes], entry.name + ".figcraft"));
      this.check();
      this.tabs.set(id, result.tabId);
      this.states.set(id, "online");
      await this.records(records => {
        const current = records.find(record => this.matches(record, id));
        return current ? [{ ...current, opened: Math.floor(Date.now() / 1000) }, ...records.filter(r => !this.matches(r, id))] : records;
      });
    });
  }

  async rename(id: string, name: string) {
    return this.run(async () => {
      const file = await this.host.store.rename(id, name);
      await this.records(records => records.map(record => this.matches(record, id) ? { ...record, name: file.name } : record));
    });
  }

  async forget(id: string) {
    await this.records(records => records.filter(record => !this.matches(record, id)));
    this.states.delete(id);
  }

  async remove(id: string) {
    return this.run(async () => {
      await this.host.store.remove(id);
      await this.forget(id);
      this.tabs.delete(id);
    });
  }
}
