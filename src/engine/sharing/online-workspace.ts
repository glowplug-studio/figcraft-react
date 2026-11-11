import {teamFileLink} from "./team-directory";
import type { OnlineFileInfo, OnlineFileRegistry, OnlineWorkspaceHost, PendingOnlinePublication, RememberedOnlineFile } from "../../backends/online-files";
import type { EditorWorkspace } from "../workspace";
import { cleanOnlineName, prepareOnlineSnapshot } from "./publication";
import { MAX_ONLINE_FILES, onlineServerKey } from "./remembered-files";

export type OnlineRow = RememberedOnlineFile & { requiresKey?:true; expires?: string | null; state: "unknown" | "online" | "gone" | "pending" };

export class OnlineWorkspace {
  readonly server: string;
  private states = new Map<string, OnlineRow["state"]>();
  private expiries = new Map<string, string | null>();
  private tabs = new Map<string, number>();
  private publishingTabs = new Map<number, string>();
  private operation = false;
  private key = "";

  constructor(private workspace: EditorWorkspace, private host: OnlineWorkspaceHost,
    private principal: string, private authorised: () => boolean) {
    this.server = onlineServerKey(host.server);
    if (!this.server) throw new Error("Invalid online server address");
  }

  get supportsServerKey() { return this.host.supportsServerKey === true; }
  get serverKey() { return this.key; }
  setServerKey(value: string) {
    this.key = [...value.replace(/[\p{White_Space}\p{Cc}]/gu,"")].slice(0,128).join("");
    this.host.serverKeyChanged?.(this.key);
  }

  get hasHostingInfo() { return !!this.host.store.hosting; }

  async hosting(file?: string) {
    this.check();
    const info = await this.host.store.hosting?.(file);
    this.check();
    return info;
  }

  get sharing() { return this.host.sharing; }

  private bindTab(file: string, tab: number) {
    const previous = this.publishedFile(tab);
    if (previous && previous !== file) this.leaveTab(tab);
    this.tabs.set(file, tab);
  }

  private async attachPublished(listing:OnlineFileInfo, tabId: number) {
    const invitations = this.host.invitations;
    const {id:file,managedByKey}=listing;
    const joined = await invitations?.joinOwned?.(file, managedByKey,listing);
    if (!joined) {
      this.check();
      if (managedByKey) throw new Error("The original edit link is unavailable");
      this.bindTab(file, tabId);
      return;
    }
    try {
      this.check();
      const previous = this.workspace.getSnapshot().find(tab => tab.id === tabId)?.guest;
      if (!this.workspace.attachGuestSession(tabId, joined.session)) throw new Error("The source file closed");
      this.bindTab(file, tabId);
      if (previous) await invitations!.leave(previous.connection);
    } finally {
      if (!this.workspace.getSnapshot().some(tab => tab.guest?.connection === joined.session.connection)) {
        await invitations!.leave(joined.session.connection);
      }
    }
  }

  leaveTab(id: number) {
    const file = this.publishedFile(id);
    if (file) {
      this.tabs.delete(file);
      this.host.releasePublished?.(file);
    }
    this.publishingTabs.delete(id);
  }

  async teamDirectory() {
    this.check();
    if (this.server.replace(/^https:/, "wss:") === "wss://collab.craftapps.dev") return {state: "none" as const};
    const directory = await this.host.store.teamDirectory?.() ?? {state: "none" as const};
    this.check();
    return directory;
  }

  teamLink(file: string) {
    const address = this.host.server.split("?",1)[0].trim().replace(/^http/i, "ws");
    const endpoint = new URL(address).pathname === "/" && !address.endsWith("/") ? address + "/" : address;
    return teamFileLink(endpoint, file);
  }

  async openTeam(file: string) {
    this.check();
    const invitations = this.host.invitations;
    if (!invitations?.join) throw new Error("The host cannot open this invite");
    await invitations.join(this.teamLink(file));
    this.check();
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
      ...pending.filter(row => row.server === this.server).map(({ server, file, name, started, requiresKey }) => ({
        server, file, name, ...(requiresKey && {requiresKey}), created: started, opened: started, state: "pending" as const,
      })),
      ...files.filter(row => row.server === this.server).map(row => ({
        ...row, expires: this.expiries.get(row.file), state: this.states.get(row.file) ?? "unknown" as const,
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
          if (attempt.requiresKey || attempt.server !== this.server || !listing || prior.get(attempt.file)?.state !== "pending") return true;
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
        const expiry = byId.get(row.file)?.expires;
        if (expiry === undefined) this.expiries.delete(row.file);
        else this.expiries.set(row.file, expiry);
        if (byId.has(row.file)) this.states.set(row.file, "online");
        else if (row.state !== "pending") this.states.set(row.file, "gone");
      }
      return this.list();
    });
  }

  private async send(attempt: PendingOnlinePublication) {
    this.check();
    if (attempt.requiresKey && !this.key) throw new Error("Enter the server key to retry this publication");
    const file = attempt.requiresKey ? await this.host.store.publish(attempt.file, attempt.snapshot, this.key)
      : await this.host.store.publish(attempt.file, attempt.snapshot);
    if (Boolean(file.managedByKey) !== Boolean(attempt.requiresKey)) throw new Error("Unexpected publication authority");
    const confirmed = this.confirmed(attempt, file);
    // A keyed file has no Home listing. Retain the recovery record until its tab has opened.
    if (file.managedByKey) return file;
    await this.registry(current => {
      if (!current.pending.some(row => this.matches(row, file.id))) return current;
      return { files: [confirmed, ...current.files],
        pending: current.pending.filter(row => !this.matches(row, file.id)) };
    });
    this.states.set(file.id, "online");
    if (file.expires !== undefined) this.expiries.set(file.id, file.expires);
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
          await this.attachPublished(file,tabId);
          this.publishingTabs.delete(tabId);
          return file;
        }
        attempt = registry.pending.find(row => this.matches(row, previous));
        if (attempt && attempt.name !== listingName) throw new Error("Retry the pending publication with its original file name");
      }
      if (!attempt) {
        const { document, nextId } = engine.archiveRevision;
        const file = crypto.randomUUID();
        const policy = this.supportsServerKey ? await this.hosting() : undefined;
        if (policy?.open === false && !this.key) throw new Error("This server takes files only from people who have its key");
        const snapshot = await prepareOnlineSnapshot(document,nextId,file,listingName,
          policy?.maxFileMb === undefined ? undefined : policy.maxFileMb * 1024 * 1024);
        if (!this.workspace.getSnapshot().some(tab => tab.id === tabId)) throw new Error("The source file closed");
        const stage = { ...(this.key && this.supportsServerKey && {requiresKey:true as const}), file, server: this.server, name: listingName, snapshot, started: Math.floor(Date.now() / 1000) };
        await this.registry(current => {
          if (current.pending.length >= MAX_ONLINE_FILES) throw new Error("Resolve a pending publication before starting another");
          return { ...current, pending: [stage, ...current.pending] };
        });
        attempt = stage;
        this.publishingTabs.set(tabId, attempt.file);
      }
      const file = await this.send(attempt);
      await this.attachPublished(file,tabId);
      if (file.managedByKey) await this.finishKeyed(file.id);
      this.publishingTabs.delete(tabId);
      return file;
    });
  }

  private async finishKeyed(id: string) {
    await this.registry(current => ({...current, pending:current.pending.filter(row => !this.matches(row,id))}));
  }

  async retryPublication(id: string) {
    return this.run(async () => {
      const current = await this.registry();
      const attempt = current.pending.find(row => this.matches(row, id));
      if (!attempt) return;
      const file = await this.send(attempt);
      if (!file.managedByKey) return;
      const source = this.workspace.getSnapshot().find(tab => this.publishingTabs.get(tab.id) === id);
      if (source) {
        this.workspace.execute("doc.switch", {index:source.index});
        await this.attachPublished(file,source.id);
        this.publishingTabs.delete(source.id);
      } else {
        const invites = this.host.invitations;
        const joined = await invites?.joinOwned?.(id,true,file);
        if (!joined) throw new Error("The original edit link is unavailable");
        let attached = false;
        try {
          this.check();
          const tab = await this.workspace.open(new File([joined.archive], file.name + ".figcraft"), joined.session);
          this.check();
          this.bindTab(id,tab.tabId);
          attached = true;
        } finally {
          if (!attached) await invites!.leave(joined.session.connection);
        }
      }
      await this.finishKeyed(id);
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
      const invitations = this.host.invitations;
      const listing=invitations?.joinOwned ? (await this.host.store.owned([id]))[0] : undefined;
      if (invitations?.joinOwned && !listing) {
        throw new Error("This file is no longer on its server");
      }
      this.check();
      const joined = await invitations?.joinOwned?.(id,false,listing,true);
      let attached = false;
      try {
        // Older device records have no original edit credential. Their owner
        // can still open the archive as a local drawing without a live grant.
        const bytes = joined?.archive ?? await this.host.store.open(id);
        this.check();
        const result = await this.workspace.open(new File([bytes], entry.name + ".figcraft"), joined?.session);
        this.check();
        this.bindTab(id, result.tabId);
        attached = true;
      } finally {
        if (joined && !attached) await invitations!.leave(joined.session.connection);
      }
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
    this.expiries.delete(id);
    this.tabs.delete(id);
  }

  async remove(id: string) {
    return this.run(async () => {
      const session = this.workspace.getSnapshot().find(tab => tab.id === this.tabs.get(id))?.guest;
      await this.host.store.remove(id);
      if (session && this.host.invitations) {
        await this.host.invitations.leave(session.connection);
        this.workspace.leaveSession(session.connection);
      }
      await this.forget(id);
    });
  }
}
