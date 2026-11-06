import { newDocument, pageOf, type Document, type RectangleNode, type NodeId } from "./document";

export const commandSpecs = Object.freeze({
  "shape.rectangle": { label: "Rectangle", undo: true },
  "node.create": { label: "Create layer", undo: true },
  "tool.rectangle": { label: "Rectangle", undo: false },
  "tool.move": { label: "Move", undo: false },
  "edit.undo": { label: "Undo", undo: false },
  "edit.redo": { label: "Redo", undo: false },
});
export type CommandId = keyof typeof commandSpecs;
export interface EditorSnapshot {
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly tool: "move" | "rectangle";
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly editable: boolean;
}
interface HistoryEntry { document: Document; selection: readonly NodeId[] }
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
  constructor() {
    this.#snapshot = Object.freeze({ document: newDocument(), selection: Object.freeze([]), tool: "move", canUndo: false, canRedo: false, editable: true });
  }
  getSnapshot = (): EditorSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  #publish(patch: Partial<EditorSnapshot>): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0 });
    this.#listeners.forEach(listener => listener());
  }
  setEditable(editable: boolean): void {
    if (editable !== this.#snapshot.editable) this.#publish({ editable, tool: "move" });
  }
  execute(command: string, input: unknown = {}): Record<string, unknown> {
    if (!Object.hasOwn(commandSpecs, command)) throw new Error(`Unsupported command: ${command}`);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = parameters(input);
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
  #rectangle(command: string, p: Record<string, unknown>): Record<string, unknown> {
    const allowed = ["x", "y", "width", "height", "parent", "index", "name", "select", ...(command === "node.create" ? ["type"] : [])];
    for (const key of Object.keys(p)) if (!allowed.includes(key)) throw new Error(`Unsupported rectangle parameter: ${key}`);
    if (command === "node.create" && (typeof p.type !== "string" || !["rectangle", "rect"].includes(p.type.toLowerCase()))) throw new Error("This slice supports rectangle nodes only");
    const before = this.#snapshot;
    const page = pageOf(before.document);
    if (p.parent !== undefined && String(p.parent) !== page.id) throw new Error("The parent must be the current page");
    if (p.name !== undefined && typeof p.name !== "string") throw new Error("name must be a string");
    if (p.select !== undefined && typeof p.select !== "boolean") throw new Error("select must be a boolean");
    const index = number(p, "index", page.children.length);
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("index must be a non-negative safe integer");
    const node: RectangleNode = Object.freeze({ id: String(this.#nextId), kind: "rectangle", name: typeof p.name === "string" ? p.name : "Rectangle", parent: page.id,
      x: number(p, "x", 0), y: number(p, "y", 0), width: Math.max(0, number(p, "width", 100)), height: Math.max(0, number(p, "height", 100)), fill: "#d9d9d9" });
    const children = [...page.children];
    children.splice(Math.min(index, children.length), 0, node.id);
    const document: Document = Object.freeze({ ...before.document, nodes: Object.freeze({ ...before.document.nodes, [page.id]: Object.freeze({ ...page, children: Object.freeze(children) }), [node.id]: node }) });
    this.#undo.push({ document: before.document, selection: before.selection });
    this.#redo = [];
    this.#nextId++;
    this.#publish({ document, selection: p.select === false ? before.selection : Object.freeze([node.id]) });
    return { id: node.id };
  }
}
