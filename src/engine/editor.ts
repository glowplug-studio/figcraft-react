import { newDocument, pageOf, type Document, type RectangleNode, type NodeId } from "./document";
import { decodeFigcraft, encodeFigcraft } from "./file-format";
import { executePage, listPages, pageSpecs } from "./pages";
import { executeSelection, selectionSpecs } from "./selection";
import { setRectangleProperties } from "./properties";
import { transformBounds } from "./affine";

export const commandSpecs = Object.freeze({
  ...pageSpecs,
  ...selectionSpecs,
  "node.set": { label: "Set properties", undo: true },
  "shape.rectangle": { label: "Rectangle", undo: true },
  "node.create": { label: "Create layer", undo: true },
  "tool.rectangle": { label: "Rectangle", undo: false },
  "tool.move": { label: "Move", undo: false },
  "edit.undo": { label: "Undo", undo: false },
  "edit.redo": { label: "Redo", undo: false },
  "file.open": { label: "Open", undo: false },
  "file.recover": { label: "Recover file", undo: false },
  "file.saveAs": { label: "Save as", undo: false },
  "file.markSaved": { label: "Mark saved", undo: false },
});
export type CommandId = keyof typeof commandSpecs;
export interface EditorSnapshot {
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly tool: "move" | "rectangle";
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly editable: boolean;
  readonly dirty: boolean;
  readonly hasSaved: boolean;
}
interface HistoryEntry { document: Document; selection: readonly NodeId[] }
// Current page is navigation state. It is persisted, but does not dirty document content.
function sameContent(a: Document, b: Document | null): boolean {
  return b !== null && a.name === b.name && a.pages === b.pages && a.nodes === b.nodes;
}
function parameters(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Command parameters must be an object");
  return input as Record<string, unknown>;
}
function number(p: Record<string, unknown>, key: string, fallback: number): number {
  const value = p[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}
/** React-free command transactions. Snapshots share immutable nodes and document references. */
export class EditorEngine {
  #snapshot: EditorSnapshot;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #nextId = 2n;
  #listeners = new Set<() => void>();
  #saved: Document | null = null;
  #saveSequence = 0;
  #pendingSaves = new Map<number, Document>();
  #openSequence = 0;
  constructor() {
    this.#snapshot = Object.freeze({ document: newDocument(), selection: Object.freeze([]), tool: "move", canUndo: false, canRedo: false, editable: true, dirty: true, hasSaved: false });
  }
  getSnapshot = (): EditorSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  nativeSnapshot = (): Promise<Uint8Array> => encodeFigcraft(this.#snapshot.document, String(this.#nextId));
  cancelPendingFiles(): void { this.#openSequence++; this.#pendingSaves.clear(); }
  #publish(patch: Partial<EditorSnapshot>): void {
    const document = patch.document ?? this.#snapshot.document;
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0, dirty: !sameContent(document, this.#saved), hasSaved: this.#saved !== null });
    this.#listeners.forEach(listener => listener());
  }
  setEditable(editable: boolean): void {
    if (!editable) this.cancelPendingFiles();
    if (editable !== this.#snapshot.editable) this.#publish({ editable, tool: "move" });
  }
  execute(command: "page.list", input?: unknown): ReturnType<typeof listPages>;
  execute(command: string, input?: unknown): Record<string, unknown>;
  execute(command: string, input: unknown = {}): Record<string, unknown> | ReturnType<typeof listPages> {
    if (!Object.hasOwn(commandSpecs, command)) throw new Error(`Unsupported command: ${command}`);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = parameters(input);
    if (Object.hasOwn(selectionSpecs, command)) {
      const next = executeSelection(command, this.#snapshot.document, this.#snapshot.selection, p);
      this.#publish({ document: next.document, selection: next.selection });
      return next.result;
    }
    if (command === "node.set") {
      const before = this.#snapshot;
      const document = setRectangleProperties(before.document, before.selection, p);
      if (document !== before.document) {
        this.#undo.push({ document: before.document, selection: before.selection });
        this.#redo = [];
        this.#publish({ document });
      }
      return { ok: true };
    }
    if (command === "page.list") return listPages(this.#snapshot.document);
    if (Object.hasOwn(pageSpecs, command)) {
      const before = this.#snapshot;
      const changed = executePage(command, before.document, before.selection, this.#nextId, p);
      if (command !== "page.select" && !sameContent(before.document, changed.document)) {
        this.#undo.push({ document: before.document, selection: before.selection });
        this.#redo = [];
      }
      this.#nextId = changed.nextId;
      if (changed.document !== before.document || changed.selection !== before.selection) this.#publish({ document: changed.document, selection: changed.selection });
      return changed.result;
    }
    if (command === "file.markSaved") {
      if (Object.keys(p).some(key => key !== "revision")) throw new Error("Unsupported save acknowledgement parameter");
      const document = p.revision === undefined ? this.#snapshot.document : typeof p.revision === "number" ? this.#pendingSaves.get(p.revision) : undefined;
      if (!document) return { saved: false };
      this.#saved = document;
      this.#pendingSaves.clear();
      this.#publish({});
      return { saved: true };
    }
    if (command.startsWith("file.")) throw new Error(`${command} requires executeAsync`);
    if (command === "shape.rectangle" || command === "node.create") return this.#rectangle(command, p);
    if (Object.keys(p).length) throw new Error(`${command} takes no parameters`);
    if (command === "tool.rectangle" || command === "tool.move") {
      this.#publish({ tool: command === "tool.rectangle" ? "rectangle" : "move" });
      return {};
    }
    const undo = command === "edit.undo";
    const source = undo ? this.#undo : this.#redo;
    const target = undo ? this.#redo : this.#undo;
    const entry = source.pop();
    if (entry) {
      target.push({ document: this.#snapshot.document, selection: this.#snapshot.selection });
      this.#publish(entry);
    }
    return { [undo ? "undone" : "redone"]: Boolean(entry) };
  }
  /** Native file commands run outside pointer rendering and retain atomic document replacement. */
  async executeAsync(command: string, input: unknown = {}): Promise<Record<string, unknown>> {
    if (!["file.open", "file.recover", "file.saveAs"].includes(command)) return this.execute(command, input);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = parameters(input);
    if (command === "file.saveAs") {
      if (Object.keys(p).some(key => key !== "data") || (p.data !== undefined && p.data !== true)) throw new Error("Browser save requires data: true");
      const document = this.#snapshot.document;
      const revision = ++this.#saveSequence;
      const opening = this.#openSequence;
      const bytes = await encodeFigcraft(document, String(this.#nextId));
      if (!this.#snapshot.editable || opening !== this.#openSequence) throw new Error("Save was cancelled because the document or identity changed");
      this.#pendingSaves.set(revision, document);
      while (this.#pendingSaves.size > 16) this.#pendingSaves.delete(this.#pendingSaves.keys().next().value!);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return { name: `${document.name}.figcraft`, bytes: bytes.length, data: btoa(binary), revision };
    }
    if (Object.keys(p).some(key => !["data", "name"].includes(key)) || typeof p.data !== "string" || (p.name !== undefined && typeof p.name !== "string")) throw new Error("File open requires base64 data and optional name");
    if (p.data.length > Math.ceil(16 * 1024 * 1024 / 3) * 4) throw new Error("File exceeds the browser import limit");
    const before = this.#snapshot.document;
    const opening = ++this.#openSequence;
    const bytes = Uint8Array.from(atob(p.data), character => character.charCodeAt(0));
    const decoded = await decodeFigcraft(bytes);
    if (opening !== this.#openSequence || before !== this.#snapshot.document || !this.#snapshot.editable) throw new Error("Open was cancelled because the document or identity changed");
    this.#nextId = BigInt(decoded.nextId);
    this.#undo = []; this.#redo = []; this.#saved = null; this.#pendingSaves.clear();
    this.#publish({ document: decoded.document, selection: Object.freeze([]), tool: "move" });
    return { summary: { name: decoded.document.name, pages: decoded.document.pages.length, layers: Object.keys(decoded.document.nodes).length - decoded.document.pages.length, images: 0 } };
  }
  #rectangle(command: string, p: Record<string, unknown>): Record<string, unknown> {
    const allowed = ["x", "y", "width", "height", "parent", "index", "name", "select", ...(command === "node.create" ? ["type"] : [])];
    for (const key of Object.keys(p)) if (!allowed.includes(key)) throw new Error(`Unsupported rectangle parameter: ${key}`);
    if (command === "node.create" && (typeof p.type !== "string" || !["rectangle", "rect"].includes(p.type.toLowerCase()))) throw new Error("This slice supports rectangle nodes only");
    const before = this.#snapshot;
    if (this.#nextId > 18446744073709551615n || before.document.nodes[String(this.#nextId)]) throw new Error("Document identifiers are exhausted");
    const page = pageOf(before.document);
    if (p.parent !== undefined && String(p.parent) !== page.id) throw new Error("The parent must be the current page");
    if (p.name !== undefined && typeof p.name !== "string") throw new Error("name must be a string");
    if (p.select !== undefined && typeof p.select !== "boolean") throw new Error("select must be a boolean");
    const index = number(p, "index", page.children.length);
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("index must be a non-negative safe integer");
    const node: RectangleNode = Object.freeze({ id: String(this.#nextId), kind: "rectangle", name: typeof p.name === "string" ? p.name : "Rectangle", parent: page.id,
      x: number(p, "x", 0), y: number(p, "y", 0), width: Math.max(0, number(p, "width", 100)), height: Math.max(0, number(p, "height", 100)), fill: "#d9d9d9" });
    transformBounds([1, 0, 0, 1, node.x, node.y], node.width, node.height);
    const children = [...page.children];
    children.splice(Math.min(index, children.length), 0, node.id);
    const document: Document = Object.freeze({ ...before.document, nodes: Object.freeze({ ...before.document.nodes, [page.id]: Object.freeze({ ...page, children: Object.freeze(children) }), [node.id]: node }) });
    this.#undo.push({ document: before.document, selection: before.selection });
    this.#redo = [];
    if (this.#nextId < 18446744073709551615n) this.#nextId++;
    this.#publish({ document, selection: p.select === false ? before.selection : Object.freeze([node.id]) });
    return { id: node.id };
  }
}
