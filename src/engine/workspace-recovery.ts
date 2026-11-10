import type { WorkspaceRecoveryStore } from "../backends/recovery";
import type { EditorWorkspace } from "./workspace";

export interface WorkspaceRecoveryState {
  status: "loading" | "ready" | "pending" | "stored" | "error";
  message?: string;
}

export class WorkspaceRecovery {
  #disposed = false;
  #revision = 0;
  #written = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<void>;
  #detach: (() => void)[] = [];
  #archives = new WeakMap<object, Blob>();
  constructor(private workspace: EditorWorkspace, private store: WorkspaceRecoveryStore, private principal: string,
    private notify: (state: WorkspaceRecoveryState) => void) {}

  async start() {
    try {
      const saved = await this.store.readWorkspace(this.principal);
      if (this.#disposed) return;
      const repairs = saved && await this.workspace.restore(saved.files, saved.active, () => this.#disposed);
      if (this.#disposed) return;
      // Keep original archives, including repaired data, until this particular drawing changes.
      if (saved && repairs) this.workspace.engines.forEach((engine, i) => this.#archives.set(engine.archiveRevision, saved.files[i]));
      this.notify({ status: "ready", message: repairs?.join("\n") });
    } catch (error) {
      if (this.#disposed) return;
      this.notify({ status: "error", message: error instanceof Error ? error.message : "Recovery could not be restored" });
      // A failed read must not overwrite the last recoverable workspace on the next edit.
      return;
    }
    const schedule = () => {
      this.#revision++;
      this.notify({ status: "pending" });
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { void this.flush(); }, 250);
    };
    this.#detach.push(this.workspace.subscribeDocuments(schedule), this.workspace.subscribe(schedule));
  }

  flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#running) return this.#running;
    this.#running = this.#write().finally(() => { this.#running = undefined; });
    return this.#running;
  }

  async #write() {
    let attempted = this.#written;
    try {
      while (!this.#disposed && this.#written !== this.#revision) {
        attempted = this.#revision;
        const { active, engines } = this.workspace.recoveryFiles;
        const pending = engines.map(engine => ({
          doc: engine.archiveRevision, encode: engine.captureNativeSnapshot(),
        }));
        const files: Blob[] = [];
        for (const { doc, encode } of pending) {
          let blob = this.#archives.get(doc);
          if (!blob) { blob = await encode(); this.#archives.set(doc, blob); }
          if (this.#disposed) return;
          files.push(blob);
        }
        if (attempted !== this.#revision) continue;
        await this.store.writeWorkspace(this.principal, { active, files });
        this.#written = attempted;
        if (!this.#disposed && attempted === this.#revision) this.notify({ status: "stored" });
      }
    } catch (error) {
      if (!this.#disposed) this.notify({ status: "error", message: error instanceof Error ? error.message : "Recovery could not be stored" });
    }
  }

  dispose() {
    this.#disposed = true;
    clearTimeout(this.#timer);
    for (const unsubscribe of this.#detach) unsubscribe();
  }
}
