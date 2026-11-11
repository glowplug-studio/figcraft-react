import {claimWorkspaceScope,type WorkspaceScope} from "./workspace-scope";
import {readOnlineNote} from "../../engine/sharing/online-recovery";
import { readDeviceOwnerSharing, type DeviceOwnerSharing } from "./owner-sharing";
import { createPublishedLinks, type PublishedLinks } from "../published-links";
import type { OnlineFileDevice, OnlineFileRegistry, RememberedOnlineFile } from "../online-files";
import { onlineServerKey, readOnlineRegistry } from "../../engine/sharing/remembered-files";
import type { WorkspaceArchive, WorkspaceRecoveryStore } from "../recovery";

const SNAPSHOTS = "snapshots";

export interface IndexedDbRecoveryOptions {
  /** Defaults to the current browser's IndexedDB; injectable for host tests. */
  indexedDB?: IDBFactory;
  databaseName?: string;
}

/** Transactional browser equivalent of upstream recovery's successful-write acknowledgement. */
export class IndexedDbRecoveryStore implements WorkspaceRecoveryStore, OnlineFileDevice {
  #options: IndexedDbRecoveryOptions;
  #database: IDBDatabase | undefined;
  #opening: Promise<IDBDatabase> | undefined;
  #cancelOpen: (() => void) | undefined;
  #transactions = new Set<IDBTransaction>();
  #closed = false;
  #scopes=new Map<string,Promise<WorkspaceScope>>();
  #adopted=new Set<WorkspaceScope>();

  constructor(options: IndexedDbRecoveryOptions = {}) {
    this.#options = options;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Recovery storage is closed");
  }

  #open(): Promise<IDBDatabase> {
    this.#assertOpen();
    if (this.#opening) return this.#opening;
    const factory = this.#options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error("Browser recovery storage is unavailable");
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let failed = false;
      const cancel = () => fail(new Error("Recovery storage is closed"));
      const fail = (reason: unknown) => {
        failed = true;
        if (this.#cancelOpen === cancel) this.#cancelOpen = undefined;
        reject(reason);
      };
      this.#cancelOpen = cancel;
      const request = factory.open(this.#options.databaseName ?? "figcraft-recovery", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SNAPSHOTS)) request.result.createObjectStore(SNAPSHOTS);
      };
      request.onerror = () => fail(request.error ?? new Error("Could not open recovery storage"));
      request.onblocked = () => fail(new Error("Recovery storage upgrade is blocked by another tab"));
      request.onsuccess = () => {
        if (this.#cancelOpen === cancel) this.#cancelOpen = undefined;
        const database = request.result;
        if (failed || this.#closed) { database.close(); return; }
        this.#database = database;
        database.onversionchange = () => {
          database.close();
          this.#database = undefined;
          this.#opening = undefined;
        };
        resolve(database);
      };
    });
    this.#opening = opening;
    void opening.catch(() => { if (this.#opening === opening) this.#opening = undefined; });
    return opening;
  }

  async #transaction<T>(principalId: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest, result: (value: unknown, store: IDBObjectStore) => T): Promise<T> {
    if (!principalId.trim()) throw new Error("Recovery requires a host principal");
    const database = await this.#open();
    this.#assertOpen();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(SNAPSHOTS, mode);
      this.#transactions.add(transaction);
      let value: T;
      let failure: unknown;
      const finish = () => { this.#transactions.delete(transaction); };
      transaction.oncomplete = () => { finish(); resolve(value); };
      transaction.onabort = () => { finish(); reject(failure ?? transaction.error ?? new Error("Recovery transaction was aborted")); };
      transaction.onerror = () => { failure ??= transaction.error; };
      try {
        const store = transaction.objectStore(SNAPSHOTS);
        const request = operation(store);
        request.onsuccess = () => {
          try { value = result(request.result as unknown, store); }
          catch (error) { failure = error; transaction.abort(); }
        };
        request.onerror = () => { failure = request.error; };
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  }

  #stored(principalId: string): Promise<ArrayBuffer | Blob | null> {
    return this.#transaction(principalId, "readonly", store => store.get(principalId), value => {
      if (value === undefined) return null;
      if (!(value instanceof ArrayBuffer || value instanceof Blob)) throw new Error("The stored recovery snapshot is invalid");
      return value;
    });
  }

  async read(principalId: string): Promise<Uint8Array | null> {
    const stored = await this.#stored(principalId);
    return stored && new Uint8Array(stored instanceof Blob ? await stored.arrayBuffer() : stored);
  }

  async readBlob(principalId: string): Promise<Blob | null> {
    const stored = await this.#stored(principalId);
    return stored instanceof ArrayBuffer ? new Blob([stored]) : stored;
  }

  onlineRegistry(principal: string, update?: (current: OnlineFileRegistry) => OnlineFileRegistry) {
    const key = [principal, "online-files"];
    return this.#transaction(principal, update ? "readwrite" : "readonly", store => store.get(key), (value, store) => {
      const current = readOnlineRegistry(value);
      if (!update) return current;
      const next = readOnlineRegistry(update(current));
      const retained = new Set([...next.files, ...next.pending].map(row => row.server + "?" + row.file));
      for (const row of [...current.files, ...current.pending]) {
        if (!retained.has(row.server + "?" + row.file)) {
          store.delete([principal, "published-links", row.server, row.file]);
          store.delete([principal, "owner-sharing", row.server, row.file]);
        }
      }
      store.put(next, key);
      return next;
    });
  }

  ownerSharing(principal: string, server: string, file: string, update?: (row: DeviceOwnerSharing) => DeviceOwnerSharing) {
    const address = onlineServerKey(server), key = [principal, "owner-sharing", address, file];
    let registry: IDBRequest;
    return this.#transaction(principal, update ? "readwrite" : "readonly", store => {
      registry = store.get([principal, "online-files"]);
      return store.get(key);
    }, (stored, store) => {
      if (!readOnlineRegistry(registry.result).files.some(row => row.server === address && row.file === file)) {
        throw new Error("This file is not remembered on this device");
      }
      const current = readDeviceOwnerSharing(stored);
      if (!update) return current;
      const next = readDeviceOwnerSharing(update(current));
      store.put(next, key);
      return next;
    });
  }

  async cachedCodes(principal:string,server:string,file:string) {
    return this.#transaction(principal,"readonly",store=>store.get([principal,"owner-sharing",onlineServerKey(server),file]),
      stored=>Object.fromEntries(readDeviceOwnerSharing(stored).links.map(link=>[link.access,link.code])));
  }

  readPublishedLinks(principal: string, server: string, file: string): Promise<PublishedLinks | undefined> {
    return this.#transaction(principal, "readonly", store => store.get([principal, "published-links", onlineServerKey(server), file]),
      value => value as PublishedLinks | undefined);
  }

  /** Keep bearer credentials in the host's private storage, outside document and registry snapshots. */
  async publicationLinks(principal: string, server: string, file: string): Promise<PublishedLinks> {
    const address = onlineServerKey(server);
    const key = [principal, "published-links", address, file];
    let registry: IDBRequest;
    return this.#transaction(principal, "readwrite", store => {
      registry = store.get([principal, "online-files"]);
      return store.get(key);
    }, (prior, store) => {
      const current = readOnlineRegistry(registry.result);
      if (![...current.files, ...current.pending].some(row => row.server === address && row.file === file)) {
        throw new Error("This publication was forgotten on this device");
      }
      if (prior) return prior as PublishedLinks;
      const links = createPublishedLinks();
      store.put(links, key);
      return links;
    });
  }

  async onlineFiles(principal: string, update?: (current: readonly RememberedOnlineFile[]) => readonly RememberedOnlineFile[]) {
    const registry = await this.onlineRegistry(principal, update && (current => ({ ...current, files: update(current.files) })));
    return registry.files;
  }

  trustedTeamLibraries(principal:string,server:string,remember?:string):Promise<readonly string[]> {
    const key=[principal,"trusted-team-libraries",onlineServerKey(server)];
    return this.#transaction(principal,remember ? "readwrite" : "readonly",store=>store.get(key),(value,store)=>{
      const rows:string[]=Array.isArray(value) ? value.filter(path=>typeof path==="string" && /^team-library:[0-9a-f]{64}$/.test(path)).slice(0,500) : [];
      if (remember===undefined || rows[0]===remember) return rows;
      if (!/^team-library:[0-9a-f]{64}$/.test(remember)) throw new Error("Invalid team library reference");
      const next=[remember,...rows.filter(path=>path!==remember).slice(0,499)];
      store.put(next,key);
      return next;
    });
  }

  teamLibraryInvite(principal: string, server: string, path: string, invite?: string) {
    const key = [principal,"team-library-invites",onlineServerKey(server)];
    return this.#transaction(principal,invite === undefined ? "readonly" : "readwrite",store => store.get(key),(value,store) => {
      const saved: [string,string][] = Array.isArray(value) ? value.filter(row => Array.isArray(row) && row.length===2
        && typeof row[0]==="string" && typeof row[1]==="string") : [];
      if (invite === undefined) return saved.find(row => row[0]===path)?.[1];
      store.put([[path,invite],...saved.filter(row => row[0]!==path).slice(0,499)],key);
      return invite;
    });
  }

  readLibrary(principalId:string,path:string):Promise<Blob|null> {
    return this.#transaction(principalId,"readonly",store=>store.get([principalId,"library",path]),value=>{
      if (value===undefined) return null;
      if (!(value instanceof Blob)) throw Error("Invalid stored publication");
      return value;
    });
  }
  writeLibrary(principalId:string,path:string,publication:Blob):Promise<void> {
    return this.#transaction(principalId,"readwrite",store=>store.put(publication,[principalId,"library",path]),()=>undefined);
  }

  writeBlob(principalId: string, archive: Blob): Promise<void> {
    return this.#transaction(principalId, "readwrite", store => store.put(archive, principalId), () => undefined);
  }

  write(principalId: string, bytes: Uint8Array): Promise<void> {
    // Copy before opening the database yields: callers may reuse their export buffer immediately.
    const copy = new Uint8Array(bytes).buffer;
    return this.#transaction(principalId, "readwrite", store => store.put(copy, principalId), () => undefined);
  }

  private workspaceKey(principal:string,scope:string):string[] {
    return scope ? [principal,"workspace",scope] : [principal,"workspace"];
  }

  private workspaceScope(principal:string) {
    let pending=this.#scopes.get(principal);
    if(!pending){
      const name=this.#options.databaseName ?? "figcraft-recovery";
      pending=claimWorkspaceScope(name,principal,()=>this.#transaction(principal,"readonly",store=>
        store.getAllKeys(IDBKeyRange.bound([principal,"workspace"],[principal,"workspace",[]])),value=>
        (value as IDBValidKey[]).flatMap(key=>Array.isArray(key) && key[1]==="workspace" ? [String(key[2] ?? "")] : [])));
      this.#scopes.set(principal,pending);
      void pending.catch(()=>this.#scopes.delete(principal));
    }
    return pending;
  }

  private readScope(principal:string,scope:string) {
    return this.#transaction(principal, "readonly", store => store.get(this.workspaceKey(principal,scope)), value => {
      if (value === undefined) return null;
      const record = value as Partial<WorkspaceArchive>;
      if (!Array.isArray(record.files) || !record.files.every(file => file instanceof Blob)
        || !Number.isInteger(record.active) || record.active! < 0 || record.active! >= Math.max(1, record.files.length)) {
        throw new Error("Invalid stored file workspace");
      }
      const online=Array.isArray(record.online) && record.online.length===record.files.length ? record.online.map(readOnlineNote) : [];
      return { files: record.files as Blob[], active: record.active!, ...(online.some(Boolean) && {online}) };
    });
  }

  async readWorkspace(principal:string):Promise<WorkspaceArchive|null> {
    const scope=await this.workspaceScope(principal);
    let archive=await this.readScope(principal,scope.current);
    if(!archive && !scope.current){
      const legacy=await this.readBlob(principal);
      if(legacy)archive={files:[legacy],active:0};
    }
    for(const previous of scope.adopted){
      const other=await this.readScope(principal,previous);
      if(!other)continue;
      if(!archive){archive=other;continue;}
      const files=[...archive.files,...other.files];
      const notes=[...(archive.online ?? archive.files.map(()=>null)),...(other.online ?? other.files.map(()=>null))];
      archive={files,active:archive.active,...(notes.some(Boolean) && {online:notes})};
    }
    this.#adopted.add(scope);
    return archive;
  }

  async writeWorkspace(principal: string, archive: WorkspaceArchive): Promise<void> {
    const scope=await this.workspaceScope(principal);
    await this.#transaction(principal, "readwrite", store => {
      if(!scope.current || this.#adopted.has(scope) && scope.adopted.includes(""))store.delete(principal);
      if(this.#adopted.has(scope))for(const old of scope.adopted)store.delete(this.workspaceKey(principal,old));
      return store.put(archive,this.workspaceKey(principal,scope.current));
    }, () => undefined);
    if(this.#adopted.has(scope))scope.adopted.length=0;
  }

  async remove(principal: string): Promise<void> {
    const scope=await this.workspaceScope(principal);
    await this.#transaction(principal,"readwrite",store=>{
      for(const previous of scope.adopted)store.delete(this.workspaceKey(principal,previous));
      store.delete(this.workspaceKey(principal,scope.current));
      return store.delete(principal);
    },()=>undefined);
    scope.adopted.length=0;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for(const scope of this.#scopes.values())void scope.then(current=>current.release()).catch(()=>{});
    this.#scopes.clear();
    this.#cancelOpen?.();
    for (const transaction of this.#transactions) {
      try { transaction.abort(); } catch { /* It may already have committed. */ }
    }
    this.#database?.close();
    this.#database = undefined;
  }
}
