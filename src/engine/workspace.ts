import { EditorEngine } from "./editor";
import { parseBoolean, parseIndex, parseString } from "./parameters";

export interface DocumentTab {
  readonly id: number;
  readonly index: number;
  readonly name: string;
  readonly dirty: boolean;
  readonly active: boolean;
  readonly path: null;
}

interface OpenTab {
  id: number;
  engine: EditorEngine;
  unsubscribe: () => void;
}

type WorkspaceCommand = "doc.list" | "doc.switch" | "doc.nextTab" | "doc.previousTab"
  | "file.new" | "file.moveTab" | "file.close" | "file.duplicate";

// Native DocState UIDs are process-wide and independent of layer IDs and tab order.
let nextDocumentId = 1;

export class EditorWorkspace {
  #tabs: OpenTab[] = [];
  #active?: OpenTab;
  #editable = true;
  #generation = 0;
  #listeners = new Set<() => void>();
  #snapshot: readonly DocumentTab[] = Object.freeze([]);

  constructor() { this.#append(EditorEngine.newTab()); }
  get activeEngine() { return this.#active?.engine; }
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  #publish() {
    this.#snapshot = Object.freeze(this.#tabs.map(({ id, engine }, index) => {
      const { document, dirty } = engine.getSnapshot();
      return Object.freeze({ id, index, name: document.name, dirty, active: engine === this.activeEngine, path: null });
    }));
    for (const listener of this.#listeners) listener();
  }

  #append(engine: EditorEngine) {
    let { document: { name }, dirty } = engine.getSnapshot();
    const unsubscribe = engine.subscribe(() => {
      const state = engine.getSnapshot();
      if (name === state.document.name && dirty === state.dirty) return;
      name = state.document.name;
      dirty = state.dirty;
      this.#publish();
    });
    this.#active = { id: nextDocumentId++, engine, unsubscribe };
    this.#tabs.push(this.#active);
    this.#publish();
    return { index: this.#tabs.length - 1 };
  }

  setEditable(editable: boolean) {
    if (this.#editable === editable) return;
    this.#editable = editable;
    this.#generation++;
    for (const tab of this.#tabs) tab.engine.setEditable(editable);
  }

  async open(file: File) {
    if (!this.#editable) throw new Error("Sign in to open a document");
    const generation = this.#generation;
    const engine = EditorEngine.newTab();
    const result = await engine.openFile(file);
    if (generation !== this.#generation) throw new Error("Open cancelled because the identity changed");
    return { ...result, ...this.#append(engine) };
  }

  execute(command: "doc.list"): readonly DocumentTab[];
  execute(command: Exclude<WorkspaceCommand, "doc.list">, params?: Record<string, unknown>): Record<string, unknown>;
  execute(command: WorkspaceCommand, params: Record<string, unknown> = {}): readonly DocumentTab[] | Record<string, unknown> {
    if (!this.#editable) throw new Error("Sign in to use the workspace");
    if (command === "doc.list") return this.#snapshot;
    if (command === "file.new") return { ...this.#append(EditorEngine.newTab(parseString(params.name))), kind: "design" };
    const active = this.#active;
    const tabIndex = (key: string) => {
      const index = parseIndex(params[key], key);
      if (index >= this.#tabs.length) throw new Error(command + ": no such document");
      return index;
    };
    if (command === "file.moveTab") {
      const from = tabIndex("from"), to = tabIndex("to");
      if (from !== to) {
        const [tab] = this.#tabs.splice(from, 1);
        this.#tabs.splice(to, 0, tab);
        this.#publish();
      }
      return { index: to };
    }
    if (command === "doc.switch") {
      const tab = this.#tabs[tabIndex("index")];
      if (active !== tab) { this.#active = tab; this.#publish(); }
      return { ok: true };
    }
    if (!active) throw new Error("No document");
    if (command === "file.duplicate") return this.#append(active.engine.duplicateTab());
    if (command === "file.close") {
      const index = "index" in params ? tabIndex("index") : this.#tabs.indexOf(active);
      const tab = this.#tabs[index];
      if (tab.engine.getSnapshot().dirty && !parseBoolean(params.force)) {
        throw new Error("command `file.close` is not available right now: the document has unsaved changes (pass force: true to discard)");
      }
      tab.unsubscribe();
      tab.engine.setEditable(false);
      this.#tabs.splice(index, 1);
      if (tab === active) this.#active = this.#tabs[Math.min(index, this.#tabs.length - 1)];
      this.#publish();
      return { ok: true };
    }
    if (command !== "doc.nextTab" && command !== "doc.previousTab") throw new Error("Unsupported workspace command: " + command);
    const count = this.#tabs.length;
    const index = (this.#tabs.indexOf(active) + (command === "doc.nextTab" ? 1 : -1) + count) % count;
    if (this.#tabs[index] !== active) { this.#active = this.#tabs[index]; this.#publish(); }
    return { index };
  }
}
