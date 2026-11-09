import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { IndexedDbRecoveryStore } from "../../src/backends/browser/recovery";

const stores: IndexedDbRecoveryStore[] = [];
afterEach(() => { stores.splice(0).forEach(store => store.close()); vi.restoreAllMocks(); });
function open(indexedDB = new IDBFactory()) {
  const store = new IndexedDbRecoveryStore({ indexedDB });
  stores.push(store);
  return store;
}

describe("browser recovery contract", () => {
  it("replaces the latest snapshot atomically and retains it when reopened", async () => {
    const indexedDB = new IDBFactory();
    const store = open(indexedDB);
    expect(await store.read("principal")).toBeNull();
    await store.write("principal", new Uint8Array([1, 2]));
    await store.write("principal", new Uint8Array([3, 4, 5]));
    store.close();
    expect(await open(indexedDB).read("principal")).toEqual(new Uint8Array([3, 4, 5]));
  });

  it("reads legacy byte records as Blobs and new Blob records through the byte adapter", async () => {
    const indexedDB = new IDBFactory(), store = open(indexedDB);
    await store.write("old", Uint8Array.of(1,2));
    await store.writeBlob("new", new Blob([Uint8Array.of(3,4)]));
    store.close();
    const reopened = open(indexedDB);
    expect(await (await reopened.readBlob("old"))!.bytes()).toEqual(Uint8Array.of(1,2));
    expect(await reopened.read("new")).toEqual(Uint8Array.of(3,4));
    expect(await reopened.readBlob("missing")).toBeNull();
  });

  it("isolates principals and deletes only the requested principal", async () => {
    const store = open();
    await store.write("alice", new Uint8Array([1]));
    await store.write("bob", new Uint8Array([2]));
    expect(await store.read("unknown")).toBeNull();
    expect(await store.read("alice")).toEqual(new Uint8Array([1]));
    await store.remove("alice");
    expect(await store.read("alice")).toBeNull();
    expect(await store.read("bob")).toEqual(new Uint8Array([2]));
    await store.remove("unknown");
  });

  it("copies the input before awaiting open and never returns mutable stored bytes", async () => {
    const store = open();
    const bytes = new Uint8Array([7, 8, 9]);
    const write = store.write("principal", bytes.subarray(1));
    bytes.fill(0);
    await write;
    const first = await store.read("principal");
    expect(first).toEqual(new Uint8Array([8, 9]));
    first!.fill(0);
    expect(await store.read("principal")).toEqual(new Uint8Array([8, 9]));
  });

  it("acknowledges the transaction rather than the request and preserves the old copy on abort", async () => {
    const store = open();
    await store.write("principal", new Uint8Array([1]));
    const put = IDBObjectStore.prototype.put;
    const injection = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = put.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    await expect(store.write("principal", new Uint8Array([2]))).rejects.toThrow();
    injection.mockRestore();
    expect(await store.read("principal")).toEqual(new Uint8Array([1]));
  });

  it("reports quota failure without losing the last acknowledged snapshot", async () => {
    const store = open();
    await store.write("principal", new Uint8Array([1]));
    const injection = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("Storage is full", "QuotaExceededError"); });
    await expect(store.write("principal", new Uint8Array([2]))).rejects.toMatchObject({ name: "QuotaExceededError" });
    injection.mockRestore();
    expect(await store.read("principal")).toEqual(new Uint8Array([1]));
  });

  it("rejects empty principals without creating an anonymous recovery slot", async () => {
    const store = open();
    await expect(store.read("")).rejects.toThrow("principal");
    await expect(store.write(" ", new Uint8Array([1]))).rejects.toThrow("principal");
    await expect(store.remove("")).rejects.toThrow("principal");
  });

  it("rejects pending and future work on close without deleting acknowledged recovery", async () => {
    const indexedDB = new IDBFactory();
    const store = open(indexedDB);
    await store.write("principal", new Uint8Array([1]));
    const pending = store.write("principal", new Uint8Array([2]));
    store.close();
    await expect(pending).rejects.toThrow("closed");
    await expect(store.read("principal")).rejects.toThrow("closed");
    await expect(store.remove("principal")).rejects.toThrow("closed");
    store.close();
    expect(await open(indexedDB).read("principal")).toEqual(new Uint8Array([1]));
  });

  it("closes an in-flight database open without leaving its callers pending", async () => {
    const store = open();
    const pending = store.read("principal");
    store.close();
    await expect(pending).rejects.toThrow("closed");
  });
});

it("isolates selected library publications by principal and filename from document recovery",async()=>{
  const store=open();
  await store.writeLibrary("first","Kit",new Blob(["public"]));
  expect(await (await store.readLibrary("first","Kit"))?.text()).toBe("public");
  expect(await store.readLibrary("second","Kit")).toBeNull();
  expect(await store.readLibrary("first","Other")).toBeNull();
  expect(await store.read("first")).toBeNull();
});
