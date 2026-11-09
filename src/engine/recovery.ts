import type { RecoveryStore } from "../backends/recovery";
import { sameContent, type Document } from "./document";
import type { EditorEngine } from "./editor";

export function base64Bytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  // Only the final chunk may require base64 padding.
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 12288))));
  }
  return chunks.join("");
}

/** Host-owned recovery lifecycle. Serial writes prevent old snapshots overtaking newer edits. */
export class RecoveryController {
  #disposed = false;
  #unsubscribe?: () => void;
  #timer?: ReturnType<typeof setTimeout>;
  #queue: Promise<void> = Promise.resolve();
  #last?: object;
  #partialRestore?: Document;
  constructor(private engine: EditorEngine, private store: RecoveryStore, private principal: string,
    private notify: (status: "loading" | "ready" | "pending" | "stored" | "error", message?: string) => void) {}

  async start(): Promise<void> {
    this.notify("loading");
    try {
      const stored = this.store.readBlob ? await this.store.readBlob(this.principal) : await this.store.read(this.principal);
      if (this.#disposed) return;
      const result = stored ? await this.engine.recoverFile(stored instanceof Blob ? stored : new Blob([new Uint8Array(stored)])) : undefined;
      if (this.#disposed) return;
      if (result?.repairs.length) {
        this.#partialRestore = this.engine.getSnapshot().document;
        this.notify("ready", result.repairs.join("\n"));
      } else this.notify("ready");
    } catch (error) {
      if (this.#disposed) return;
      this.notify("error", error instanceof Error ? error.message : "Recovery could not be restored");
    }
    this.#last = this.engine.archiveRevision;
    this.#unsubscribe = this.engine.subscribe(() => {
      const snapshot = this.engine.getSnapshot();
      if (!snapshot.editable || this.#disposed || this.engine.archiveRevision === this.#last) return;
      this.#last = this.engine.archiveRevision;
      if (this.#partialRestore && sameContent(snapshot.document, this.#partialRestore)) return;
      this.#partialRestore = undefined;
      this.notify("pending");
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { void this.flush(); }, 250);
    });
  }

  flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#disposed || !this.engine.getSnapshot().editable) return this.#queue;
    const document = this.engine.getSnapshot().document;
    // Hiding an untouched partially recovered drawing must preserve its original archive.
    if (this.#partialRestore && sameContent(document, this.#partialRestore)) return this.#queue;
    // Capture now; a later queued write must never read a different document revision.
    const encode = this.engine.captureNativeSnapshot();
    this.#queue = this.#queue.then(async () => {
      if (this.#disposed) return;
      try {
        const encoded = await encode();
        if (this.#disposed || !this.engine.getSnapshot().editable) return;
        if (this.store.writeBlob) await this.store.writeBlob(this.principal, encoded);
        else {
          const bytes = new Uint8Array(await encoded.arrayBuffer());
          if (this.#disposed || !this.engine.getSnapshot().editable) return;
          await this.store.write(this.principal, bytes);
        }
        if (!this.#disposed && this.engine.getSnapshot().document === document) this.notify("stored");
      } catch (error) {
        if (!this.#disposed) this.notify("error", error instanceof Error ? error.message : "Recovery could not be stored");
      }
    });
    return this.#queue;
  }

  dispose(): void {
    this.#disposed = true;
    this.engine.cancelPendingFiles();
    clearTimeout(this.#timer);
    this.#unsubscribe?.();
  }
}
