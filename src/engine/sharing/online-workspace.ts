import type { OnlineFileInfo, OnlineFileRegistry, OnlineWorkspaceHost, PendingOnlinePublication, RememberedOnlineFile } from "../../backends/online-files";
import type { EditorWorkspace } from "../workspace";
import { cleanOnlineName, prepareOnlineSnapshot } from "./publication";
import { MAX_ONLINE_FILES, onlineServerKey } from "./remembered-files";

export type OnlineRow = RememberedOnlineFile & { state: "unknown" | "online" | "gone" | "pending" };

export class OnlineWorkspace {
  readonly server: string;
  private states = new Map<string, OnlineRow["state"]>();
  private tabs = new Map<string, number>();
  private publishingTabs = new Map<number, string>();
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

  private registry(update?: (current: OnlineFileRegistry) => OnlineFileRegistry) {
    this.check();
    return this.host.device.onlineRegistry(this.principal, update && (current => {
      this.check();
      return update(current);
    }));
  }

  private records(update: (records: readonly RememberedOnlineFile[]) => readonly RememberedOnlineFile[]) {
    return this.registry(current => ({ ...current, files: update(current.files) }));
  }

  private matches(record: { server: string; file: string }, id: string) {
    return record.server === this.server && record.file === id;
  }

  async list(): Promise<OnlineRow[]> {
    const { files, pending } = await this.registry();
    this.check();
    return [
      ...pending.filter(row => row.server === this.server).map(({ server, file, name, started }) => ({
        server, file, name, created: started, opened: started, state: "pending" as const,
      })),
      ...files.filter(row => row.server === this.server).map(row => ({
        ...row, state: this.states.get(row.file) ?? "unknown" as const,
      })),
    ];
  }

  private confirmed(attempt: PendingOnlinePublication, file: OnlineFileInfo): RememberedOnlineFile {
    const created = Math.floor(Date.parse(file.created) / 1000);
    if (file.id !== attempt.file || typeof file.name !== "string" || !Number.isSafeInteger(created) || created < 0) {
      throw new Error("The server returned an invalid publication receipt");
    }
    return { server: this.server, file: file.id, name: file.name, opened: attempt.started, created };
  }

  async refresh() {
    return this.run(async () => {
      const remembered = await this.list();
      if (!remembered.length) return [];
      const byId = new Map<string, OnlineFileInfo>();
      for (let i = 0; i < remembered.length; i += MAX_ONLINE_FILES) {
        this.check();
        const rows = await this.host.store.owned(remembered.slice(i, i + MAX_ONLINE_FILES).map(row => row.file));
        for (const row of rows) byId.set(row.id, row);
      }
      const prior = new Map(remembered.map(row => [row.file, row]));
      // Only confirmed listings can resolve a lost acknowledgement. A refresh never uploads bytes.
      await this.registry(current => {
        const recovered: RememberedOnlineFile[] = [];
        const pending = current.pending.filter(attempt => {
          const listing = byId.get(attempt.file);
          if (attempt.server !== this.server || !listing || prior.get(attempt.file)?.state !== "pending") return true;
          recovered.push(this.confirmed(attempt, listing));
          return false;
        });
        const files = current.files.map(record => {
          const listing = byId.get(record.file);
          return record.server === this.server && listing && prior.get(record.file)?.name === record.name
            ? { ...record, name: listing.name } : record;
        });
        return { files: [...recovered, ...files], pending };
      });
      for (const row of remembered) {
        if (byId.has(row.file)) this.states.set(row.file, "online");
        else if (row.state !== "pending") this.states.set(row.file, "gone");
      }
      return this.list();
    });
  }

  private async send(attempt: PendingOnlinePublication) {
    this.check();
    const file = await this.host.store.publish(attempt.file, attempt.snapshot);
    const confirmed = this.confirmed(attempt, file);
    await this.registry(current => {
      if (!current.pending.some(row => this.matches(row, file.id))) return current;
      return { files: [confirmed, ...current.files],
        pending: current.pending.filter(row => !this.matches(row, file.id)) };
    });
    this.states.set(file.id, "online");
    return file;
  }

  async publish(tabId: number, name: string) {
    return this.run(async () => {
      const active = this.workspace.getSnapshot().find(tab => tab.active);
      const engine = this.workspace.activeEngine;
      if (!engine || active?.id !== tabId) throw new Error("The source file changed");
      const listingName = cleanOnlineName(name) || cleanOnlineName(engine.archiveRevision.document.name);
      const previous = this.publishingTabs.get(tabId);
      let attempt: PendingOnlinePublication | undefined;
      if (previous) {
        const registry = await this.registry();
        if (registry.files.some(row => this.matches(row, previous))) {
          const [file] = await this.host.store.owned([previous]);
          this.check();
          if (!file) throw new Error("This file is no longer on its server");
          this.tabs.set(file.id, tabId);
          this.publishingTabs.delete(tabId);
          return file;
        }
        attempt = registry.pending.find(row => this.matches(row, previous));
        if (attempt && attempt.name !== listingName) throw new Error("Retry the pending publication with its original file name");
      }
      if (!attempt) {
        const { document, nextId } = engine.archiveRevision;
        const snapshot = await prepareOnlineSnapshot(document, nextId, listingName);
        if (!this.workspace.getSnapshot().some(tab => tab.id === tabId)) throw new Error("The source file closed");
        const stage = { file: crypto.randomUUID(), server: this.server, name: listingName, snapshot, started: Math.floor(Date.now() / 1000) };
        await this.registry(current => {
          if (current.pending.length >= MAX_ONLINE_FILES) throw new Error("Resolve a pending publication before starting another");
          return { ...current, pending: [stage, ...current.pending] };
        });
        attempt = stage;
        this.publishingTabs.set(tabId, attempt.file);
      }
      const file = await this.send(attempt);
      this.tabs.set(file.id, tabId);
      this.publishingTabs.delete(tabId);
      return file;
    });
  }

  async retryPublication(id: string) {
    return this.run(async () => {
      const current = await this.registry();
      const attempt = current.pending.find(row => this.matches(row, id));
      if (attempt) await this.send(attempt);
    });
  }

  publishedFile(tab: number) {
    for (const [file, id] of this.tabs) if (id === tab) return file;
  }

  async open(id: string) {
    return this.run(async () => {
      const entry = (await this.list()).find(record => record.file === id);
      if (entry?.state === "pending") throw new Error("This publication has not been confirmed");
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
    await this.registry(current => ({
      files: current.files.filter(row => !this.matches(row, id)),
      pending: current.pending.filter(row => !this.matches(row, id)),
    }));
    this.states.delete(id);
    this.tabs.delete(id);
  }

  async remove(id: string) {
    return this.run(async () => {
      await this.host.store.remove(id);
      await this.forget(id);
      this.tabs.delete(id);
    });
  }
}
