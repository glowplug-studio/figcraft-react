import { planBranch } from "./branch-merge";
import { applyBranch } from "./branch-apply";
import { branchReview } from "./branch-review";
import { EditorEngine, type EditorClipboard } from "./editor";
import { clippedText } from "./file-versions";
import type { FileBranch } from "./file-format";
import { nextBranchClient } from "./branch-ids";
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
  readonly branchId?: string;
}

interface OpenTab {
  id: number;
  engine: EditorEngine;
  unsubscribe: () => void;
  branch?: { main: EditorEngine; id: string };
}

type WorkspaceCommand = "doc.list" | "doc.switch" | "doc.nextTab" | "doc.previousTab"
  | "file.new" | "file.openRecent" | "file.revert" | "file.moveTab" | "file.close" | "file.duplicate";

type BranchCommand = "branch.list" | "branch.create" | "branch.open" | "branch.archive" | "branch.merge" | "branch.updateFromMain" | "branch.review";

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

  get fileBranches() { return (this.#active?.branch?.main ?? this.activeEngine)?.branches ?? []; }
  get onBranch() { return !!this.#active?.branch; }
  get branchOwner() { return this.#active?.branch?.main; }
  get activeBranchId() { return this.#active?.branch?.id; }

  // Recovery writes each file once. A branch is already included in its owning archive.
  get recoveryFiles() {
    const mains = this.#tabs.filter(tab => !tab.branch);
    const selected = this.#active?.branch?.main ?? this.activeEngine;
    return { engines: mains.map(tab => tab.engine), active: Math.max(0, mains.findIndex(tab => tab.engine === selected)) };
  }

  async prepareDownload() {
    const main = this.#active?.branch?.main ?? this.activeEngine;
    if (!main || !this.#editable) throw new Error("No editable document");
    const open = this.#tabs.filter(t => t.branch?.main === main).map(t => ({ engine: t.engine, revision: t.engine.archiveRevision }));
    const result = await main.saveFile();
    return { ...result, delivered: () => {
      main.execute("file.markSaved", { revision: result.revision });
      for (const tab of open) if (tab.engine.archiveRevision === tab.revision && this.#tabs.some(t => t.engine === tab.engine)) {
        tab.engine.execute("file.markSaved");
      }
    } };
  }

  #publish() {
    this.#snapshot = Object.freeze(this.#tabs.map(({ id, engine, branch }, index) => {
      const { document, dirty } = engine.getSnapshot();
      return Object.freeze({ id, index, name: document.name, dirty, active: engine === this.activeEngine, path: null, ...(branch && { branchId: branch.id }) });
    }));
    for (const listener of this.#listeners) listener();
  }

  #attach(engine: EditorEngine, branch?: OpenTab["branch"]) {
    let { document: { name }, dirty } = engine.getSnapshot();
    let last = engine.archiveRevision;
    const unsubscribe = engine.subscribe(() => {
      const state = engine.getSnapshot();
      if (last !== engine.archiveRevision) {
        last = engine.archiveRevision;
        if (branch && this.#editable) {
          branch.main.replaceBranches(branch.main.branches.map(record => record.id === branch.id
            ? Object.freeze({ ...record, head: { document: last.document, nextId: String(last.nextId) }, versions: last.versions }) : record));
        }
        for (const listener of this.#documentListeners) listener();
      }
      if (name === state.document.name && dirty === state.dirty) return;
      name = state.document.name;
      dirty = state.dirty;
      this.#publish();
    });
    return { id: nextDocumentId++, engine, unsubscribe, branch };
  }

  #append(engine: EditorEngine, activate = true, branch?: OpenTab["branch"]) {
    const tab = this.#attach(engine, branch);
    this.#tabs.push(tab);
    if (activate || !this.#active) this.#active = tab;
    this.#publish();
    return { index: this.#tabs.length - 1 };
  }

  setEditable(editable: boolean) {
    if (this.#editable === editable) return;
    this.#editable = editable;
    this.#generation++;
    if (!editable) {
      this.#sourceFiles.clear();
      delete this.#clipboard.properties;
      delete this.#clipboard.layers;
      delete this.#clipboard.effect;
      delete this.#clipboard.paint;
    }
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
    const { index } = this.#append(engine, this.#active === origin);
    return { ...result, index, tabId: this.#tabs[index].id };
  }

  #removeTab(tab: OpenTab) {
    const index = this.#tabs.indexOf(tab);
    tab.unsubscribe();
    tab.engine.closeTab();
    this.#tabs.splice(index, 1);
    if (tab === this.#active) this.#active = this.#tabs[Math.min(index, this.#tabs.length - 1)];
  }

  #branchCommand(command: BranchCommand, params: Record<string, unknown>) {
    const active = this.#active;
    if (!active) throw new Error("No document");
    const main = active.branch?.main ?? active.engine;
    const openIndex = (id: string) => this.#tabs.findIndex(tab => tab.branch?.main === main && tab.branch.id === id);
    if (command === "branch.list") return main.branches.map(({ id, name, time, state }) => {
      const index = openIndex(id);
      return { id, name, time: inspectedId(time), state, ...(index >= 0 && { index }) };
    });
    if (command === "branch.create") {
      if (active.branch) throw new Error("This tab is a branch: make branches from the main file");
      if (main.branches.length >= 100) throw new Error("The file has the most branches it can keep (100)");
      const { document, nextId } = main.archiveRevision;
      const client = nextBranchClient(document, main.branches);
      const name = clippedText(parseString(params.name)?.trim() || "Branch " + (main.branches.length + 1), 200);
      const now = Date.now();
      let stamp = now;
      while (main.branches.some(b => b.id === stamp.toString(16))) stamp++;
      const id = stamp.toString(16);
      const branch: FileBranch = Object.freeze({ id, name, client, state: "active", time: String(Math.floor(now / 1000)),
        base: { document, nextId: String(nextId) }, head: { document: Object.freeze({ ...document, name }), nextId: String((BigInt(client) << 32n) + 1n) },
        versions: Object.freeze([]) });
      main.replaceBranches([...main.branches, branch]);
      const engine = main.openBranch(branch);
      const { index } = this.#append(engine, true, { main, id });
      engine.execute("file.saveVersion", { name: "Branch created" });
      return { id, name, index };
    }
    const id = parseString(params.id) ?? active.branch?.id;
    if (!id) throw new Error("Pass the branch id");
    const record = main.branches.find(b => b.id === id);
    if (!record) throw new Error("No branch `" + id + "`");
    const index = openIndex(id);
    if (command === "branch.review" || command === "branch.merge" || command === "branch.updateFromMain") {
      const current = main.archiveRevision;
      const plan = planBranch(record.base.document, record.head.document, current.document);
      if (command === "branch.review") return branchReview(record, plan);
      if (record.state !== "active") throw new Error("The branch was merged or archived");
      const picks = params.resolutions === undefined ? {} : params.resolutions;
      if (!picks || typeof picks !== "object" || Array.isArray(picks)) throw new Error("Resolutions must be an object");
      for (const [key, value] of Object.entries(picks)) if (value !== "main" && value !== "branch") throw new Error("Choose branch or main for " + key);
      const side = command === "branch.merge" ? "branch" : "main";
      const doc = applyBranch(plan, side, picks as Record<string, unknown>);
      const counts = { changes: plan[side].count, conflicts: plan.conflicts.length };
      if (side === "branch") {
        main.applyBranchDocument(doc, "Merged “" + record.name + "”", false);
        main.replaceBranches(main.branches.map(b => b.id === id ? Object.freeze({ ...b, state: "merged" }) : b));
        if (index >= 0) this.#removeTab(this.#tabs[index]);
        this.#active = this.#tabs.find(t => t.engine === main);
        this.#publish();
        return { ...counts, merged: true, index: this.#tabs.indexOf(this.#active!) };
      }
      const engine = index >= 0 ? this.#tabs[index].engine : main.openBranch(record);
      engine.applyBranchDocument(doc, "Updated from main", true);
      const head = engine.archiveRevision;
      main.replaceBranches(main.branches.map(b => b.id === id ? Object.freeze({ ...b,
        base: { document: current.document, nextId: String(current.nextId) },
        head: { document: head.document, nextId: String(head.nextId) }, versions: head.versions }) : b));
      return { ...counts, updated: true };
    }
    if (command === "branch.archive") {
      if (record.state !== "active") throw new Error("The branch was already merged or archived");
      main.replaceBranches(main.branches.map(b => b === record ? Object.freeze({ ...b, state: "archived" }) : b));
      if (index >= 0) this.#removeTab(this.#tabs[index]);
      this.#publish();
      return { archived: true };
    }
    if (index < 0) return this.#append(main.openBranch(record), true, { main, id });
    this.#active = this.#tabs[index];
    this.#publish();
    return { index };
  }

  execute(command: "branch.review", params?: Record<string, unknown>): ReturnType<typeof branchReview>;
  execute(command: "branch.list"): { id: string; name: string; time: number | string; state: FileBranch["state"]; index?: number }[];
  execute(command: Exclude<BranchCommand, "branch.list">, params?: Record<string, unknown>): Record<string, unknown>;
  execute(command: "doc.list"): readonly DocumentTab[];
  execute(command: Exclude<WorkspaceCommand, "doc.list">, params?: Record<string, unknown>): Record<string, unknown>;
  execute(command: WorkspaceCommand | BranchCommand, params: Record<string, unknown> = {}): readonly DocumentTab[] | readonly Record<string, unknown>[] | Record<string, unknown> {
    if (!this.#editable) throw new Error("Sign in to use the workspace");
    if (command.startsWith("branch.")) return this.#branchCommand(command as BranchCommand, params);
    if (command === "doc.list") return this.#snapshot;
    // Browser byte opens and downloads never create native filesystem-path recents.
    if (command === "file.openRecent") {
      if (params.path != null) throw new Error("Select the file in the browser to open it");
      if (params.index != null) throw new Error("No such recent file");
      return { files: [] };
    }
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
    if (command === "file.revert") throw new Error("The file was never saved to a filesystem path");
    if (command === "file.duplicate") return this.#append(active.engine.duplicateTab());
    if (command === "file.close") {
      const index = "index" in params ? tabIndex("index") : this.#tabs.indexOf(active);
      const tab = this.#tabs[index];
      tab.engine.exitVersionPreview();
      if (!tab.branch && tab.engine.getSnapshot().dirty && !parseBoolean(params.force)) {
        throw new Error("command `file.close` is not available right now: the document has unsaved changes (pass force: true to discard)");
      }
      for (const child of this.#tabs.filter(t => t.branch?.main === tab.engine)) this.#removeTab(child);
      this.#removeTab(tab);
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
