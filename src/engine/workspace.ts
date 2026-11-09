import { EditorEngine, type EditorClipboard } from "./editor";
import { owningInstance } from "./component-tree";
import { libraryComponent } from "./library-store";
import { MAX_CACHED_LIBRARIES } from "./library-links";
import { pageForNode } from "./hierarchy";
import { boundsOf, fitView } from "./viewport";
import { inspectedId, parseBoolean, parseIndex, parseNodeId, parseString } from "./parameters";

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

export class LibrarySourceNeeded extends Error {}

// Native DocState UIDs are process-wide and independent of layer IDs and tab order.
let nextDocumentId = 1;

export class EditorWorkspace {
  #tabs: OpenTab[] = [];
  #active?: OpenTab;
  #editable = true;
  #clipboard: EditorClipboard = {};
  #sourceFiles = new Map<string, File>();
  #filenames = new WeakMap<EditorEngine, string>();
  #generation = 0;
  #listeners = new Set<() => void>();
  #documentListeners = new Set<() => void>();
  #snapshot: readonly DocumentTab[] = Object.freeze([]);

  constructor() { this.#append(EditorEngine.newTab(undefined, this.#clipboard)); }
  get activeEngine() { return this.#active?.engine; }
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  subscribeDocuments(listener: () => void) {
    this.#documentListeners.add(listener);
    return () => { this.#documentListeners.delete(listener); };
  }
  get engines(): readonly EditorEngine[] { return this.#tabs.map(tab => tab.engine); }

  #publish() {
    this.#snapshot = Object.freeze(this.#tabs.map(({ id, engine }, index) => {
      const { document, dirty } = engine.getSnapshot();
      return Object.freeze({ id, index, name: document.name, dirty, active: engine === this.activeEngine, path: null });
    }));
    for (const listener of this.#listeners) listener();
  }

  #attach(engine: EditorEngine) {
    let { document: { name }, dirty } = engine.getSnapshot();
    let last = engine.archiveRevision;
    const unsubscribe = engine.subscribe(() => {
      const state = engine.getSnapshot();
      if (last !== engine.archiveRevision) {
        last = engine.archiveRevision;
        for (const listener of this.#documentListeners) listener();
      }
      if (name === state.document.name && dirty === state.dirty) return;
      name = state.document.name;
      dirty = state.dirty;
      this.#publish();
    });
    return { id: nextDocumentId++, engine, unsubscribe };
  }

  #append(engine: EditorEngine, activate = true) {
    const tab = this.#attach(engine);
    this.#tabs.push(tab);
    if (activate || !this.#active) this.#active = tab;
    this.#publish();
    return { index: this.#tabs.length - 1 };
  }

  setEditable(editable: boolean) {
    if (this.#editable === editable) return;
    this.#editable = editable;
    this.#generation++;
    if (!editable) this.#sourceFiles.clear();
    for (const tab of this.#tabs) tab.engine.setEditable(editable);
  }

  async restore(files: readonly Blob[], active: number, cancelled: () => boolean) {
    const generation = this.#generation;
    const tabs: EditorEngine[] = [], repairs: string[] = [];
    for (const file of files) {
      if (cancelled() || generation !== this.#generation) return;
      const engine = EditorEngine.newTab(undefined, this.#clipboard);
      const result = await engine.recoverFile(file);
      repairs.push(...result.repairs);
      tabs.push(engine);
    }
    if (cancelled() || generation !== this.#generation) return;
    for (const tab of this.#tabs) { tab.unsubscribe(); tab.engine.closeTab(); }
    this.#tabs = tabs.map(engine => this.#attach(engine));
    this.#active = this.#tabs[active];
    this.#publish();
    return repairs;
  }

  rememberLibrarySource(path: string, file: File) {
    if (!this.#editable) return;
    if (this.#sourceFiles.size >= MAX_CACHED_LIBRARIES && !this.#sourceFiles.has(path)) {
      this.#sourceFiles.delete(this.#sourceFiles.keys().next().value!);
    }
    this.#sourceFiles.set(path, file);
  }

  async goToMain(params: Record<string, unknown> = {}, picked?: File) {
    const consumer = this.activeEngine;
    if (!this.#editable || !consumer) throw new Error("No editable document");
    const { document, selection } = consumer.getSnapshot();
    const id = Array.isArray(params.ids) ? params.ids.map(parseNodeId).find(Boolean) : parseNodeId(params.id) ?? selection[0];
    const instance = id && owningInstance(document, id);
    const remote = instance && libraryComponent(document, instance.component);
    if (!instance || !remote) return consumer.execute("component.goToMain", params);
    const link = document.libraryLinks?.find(item => item.id === remote.library);
    if (!link) throw new Error("The library was removed from this file");
    if (/^\s*(figcraft|wss?):\/\//i.test(link.path)) throw new Error("Open the team library file from the server to edit its main component");
    const key = Object.entries(remote.ids).find(([, local]) => local === instance.component)?.[0] ?? remote.key;
    const candidates = this.#tabs.filter(tab => tab.engine.getSnapshot().document.published?.manifest.id === link.id);
    const source = picked ?? this.#sourceFiles.get(link.path);
    const byName = source ? candidates.filter(tab => this.#filenames.get(tab.engine) === source.name) : [];
    const matches = byName.length ? byName : candidates;
    let target = !picked && matches.length === 1 ? matches[0] : undefined;
    if (!target) {
      if (!source) throw new LibrarySourceNeeded('Choose the editable source file for "' + link.name + '"');
      const current = () => this.activeEngine === consumer && consumer.getSnapshot().document === document;
      const { index } = await this.#openFile(source, current);
      target = this.#tabs[index];
    } else if (this.#active !== target) {
      this.#active = target;
      this.#publish();
    }
    const engine = target.engine, doc = engine.getSnapshot().document, node = doc.nodes[key];
    const index = this.#tabs.indexOf(target);
    if (doc.published?.manifest.id !== link.id || !node || (node.kind !== "component" && node.kind !== "componentSet") || !pageForNode(doc, key)) {
      return { id: null, index };
    }
    if (picked) this.rememberLibrarySource(link.path, picked);
    engine.execute("select.set", { id: key });
    const bounds = boundsOf(doc, [key]);
    if (bounds) engine.updateView(fitView(engine.getView(), bounds, 2));
    return { id: inspectedId(key), index };
  }

  async duplicateVersion(params: Record<string, unknown>) {
    const active = this.#active, generation = this.#generation;
    if (!active || !this.#editable) throw new Error("No editable document");
    const copy = await active.engine.duplicateVersion(params);
    if (generation !== this.#generation || this.#active !== active) throw new Error("The active file changed");
    return this.#append(copy);
  }

  open(file: File) { return this.#openFile(file); }

  async #openFile(file: File, stillWanted?: () => boolean) {
    if (!this.#editable) throw new Error("Sign in to open a document");
    const generation = this.#generation;
    const engine = EditorEngine.newTab(undefined, this.#clipboard);
    const origin = this.#active;
    const result = await engine.openTabFile(file);
    if (generation !== this.#generation) throw new Error("Open cancelled because the identity changed");
    if (stillWanted && !stillWanted()) throw new Error("The source instance changed during navigation");
    if (origin && !this.#tabs.includes(origin)) throw new Error("Open cancelled because the source tab closed");
    this.#filenames.set(engine, file.name);
    return { ...result, ...this.#append(engine, this.#active === origin) };
  }

  execute(command: "doc.list"): readonly DocumentTab[];
  execute(command: Exclude<WorkspaceCommand, "doc.list">, params?: Record<string, unknown>): Record<string, unknown>;
  execute(command: WorkspaceCommand, params: Record<string, unknown> = {}): readonly DocumentTab[] | Record<string, unknown> {
    if (!this.#editable) throw new Error("Sign in to use the workspace");
    if (command === "doc.list") return this.#snapshot;
    if (command === "file.new") return { ...this.#append(EditorEngine.newTab(parseString(params.name), this.#clipboard)), kind: "design" };
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
      tab.engine.exitVersionPreview();
      if (tab.engine.getSnapshot().dirty && !parseBoolean(params.force)) {
        throw new Error("command `file.close` is not available right now: the document has unsaved changes (pass force: true to discard)");
      }
      tab.unsubscribe();
      tab.engine.closeTab();
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
