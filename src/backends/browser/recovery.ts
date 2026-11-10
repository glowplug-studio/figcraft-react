import type { OnlineFileDevice, OnlineFileRegistry, RememberedOnlineFile } from "../online-files";
import { readOnlineRegistry } from "../../engine/sharing/remembered-files";
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
      store.put(next, key);
      return next;
    });
  }

  async onlineFiles(principal: string, update?: (current: readonly RememberedOnlineFile[]) => readonly RememberedOnlineFile[]) {
    const registry = await this.onlineRegistry(principal, update && (current => ({ ...current, files: update(current.files) })));
    return registry.files;
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

  async readWorkspace(principal: string): Promise<WorkspaceArchive | null> {
    const stored = await this.#transaction(principal, "readonly", store => store.get([principal, "workspace"]), value => {
      if (value === undefined) return null;
      const record = value as Partial<WorkspaceArchive>;
      if (!Array.isArray(record.files) || !record.files.every(file => file instanceof Blob)
        || !Number.isInteger(record.active) || record.active! < 0 || record.active! >= Math.max(1, record.files.length)) {
        throw new Error("Invalid stored file workspace");
      }
      return { files: record.files as Blob[], active: record.active! };
    });
    if (stored) return stored;
    const legacy = await this.readBlob(principal);
    return legacy ? { files: [legacy], active: 0 } : null;
  }

  writeWorkspace(principal: string, archive: WorkspaceArchive): Promise<void> {
    return this.#transaction(principal, "readwrite", store => {
      store.delete(principal);
      return store.put(archive, [principal, "workspace"]);
    }, () => undefined);
  }

  remove(principalId: string): Promise<void> {
    return this.#transaction(principalId, "readwrite", store => { store.delete([principalId, "workspace"]); return store.delete(principalId); }, () => undefined);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelOpen?.();
    for (const transaction of this.#transactions) {
      try { transaction.abort(); } catch { /* It may already have committed. */ }
    }
    this.#database?.close();
    this.#database = undefined;
  }
}
