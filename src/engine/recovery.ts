import type { RecoveryStore } from "../backends/recovery";
import type { Document } from "./document";
import type { EditorEngine } from "./editor";

export function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/** Host-owned recovery lifecycle. Serial writes prevent old snapshots overtaking newer edits. */
export class RecoveryController {
  #disposed = false;
  #unsubscribe?: () => void;
  #timer?: ReturnType<typeof setTimeout>;
  #queue: Promise<void> = Promise.resolve();
  #last?: Document;
  constructor(private engine: EditorEngine, private store: RecoveryStore, private principal: string,
    private notify: (status: "loading" | "ready" | "pending" | "stored" | "error", message?: string) => void) {}

  async start(): Promise<void> {
    this.notify("loading");
    try {
      const bytes = await this.store.read(this.principal);
      if (this.#disposed) return;
      if (bytes) await this.engine.executeAsync("file.recover", { data: base64Bytes(bytes) });
      if (this.#disposed) return;
      this.notify("ready");
    } catch (error) {
      if (this.#disposed) return;
      this.notify("error", error instanceof Error ? error.message : "Recovery could not be restored");
    }
    this.#last = this.engine.getSnapshot().document;
    this.#unsubscribe = this.engine.subscribe(() => {
      const snapshot = this.engine.getSnapshot();
      if (!snapshot.editable || this.#disposed || snapshot.document === this.#last) return;
      this.#last = snapshot.document;
      this.notify("pending");
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { void this.flush(); }, 250);
    });
  }

  flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#disposed || !this.engine.getSnapshot().editable) return this.#queue;
    const document = this.engine.getSnapshot().document;
    // Capture now; a later queued write must never read a different document revision.
    const bytes = this.engine.nativeSnapshot();
    void bytes.catch(() => undefined);
    this.#queue = this.#queue.then(async () => {
      if (this.#disposed) return;
      try {
        const encoded = await bytes;
        if (this.#disposed || !this.engine.getSnapshot().editable) return;
        await this.store.write(this.principal, encoded);
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
