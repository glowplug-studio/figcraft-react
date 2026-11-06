import { describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/rectangle-parity.json";
import { newDocument, pageOf, type RectangleNode } from "../../src/engine/document";
import { commandSpecs, EditorEngine } from "../../src/engine/editor";
import { drawnRectangle, pixelRound } from "../../src/engine/geometry";

function created(engine: EditorEngine, command = "shape.rectangle", params: unknown = {}): RectangleNode {
  const { id } = engine.execute(command, params);
  expect(typeof id).toBe("string");
  const node = engine.getSnapshot().document.nodes[String(id)];
  expect(node.kind).toBe("rectangle");
  return node as RectangleNode;
}

describe("rectangle upstream parity", () => {
  it("creates the default document with exactly one empty current page", () => {
    const document = newDocument();
    expect(document.name).toBe(fixture.defaults.documentName);
    expect(document.pages).toEqual([document.currentPage]);
    expect(Object.keys(document.nodes)).toEqual(document.pages);
    expect(pageOf(document)).toMatchObject({
      name: fixture.defaults.pageName,
      parent: null,
      children: [],
      background: fixture.defaults.pageBackground,
    });
  });

  it("preserves creation command labels and undo flags", () => {
    expect(commandSpecs["shape.rectangle"]).toEqual({ label: "Rectangle", undo: true });
    expect(commandSpecs["node.create"]).toEqual({ label: "Create layer", undo: true });
    expect(commandSpecs["edit.undo"]).toEqual({ label: "Undo", undo: false });
    expect(commandSpecs["edit.redo"]).toEqual({ label: "Redo", undo: false });
  });

  it("matches create_select_undo_redo from the Rust test", () => {
    const engine = new EditorEngine();
    const empty = engine.getSnapshot().document;
    const rectangle = created(engine, fixture.creation.command, fixture.creation.params);
    expect(rectangle).toMatchObject(fixture.creation.expected);
    expect(rectangle.parent).toBe(empty.currentPage);
    expect(engine.getSnapshot().selection).toEqual([rectangle.id]);
    expect(pageOf(engine.getSnapshot().document).children).toEqual([rectangle.id]);
    expect(engine.execute("edit.undo")).toEqual({ undone: true });
    expect(engine.getSnapshot().document.nodes[rectangle.id]).toBeUndefined();
    expect(engine.getSnapshot().selection).toEqual([]);
    expect(engine.execute("edit.redo")).toEqual({ redone: true });
    expect(engine.getSnapshot().document.nodes[rectangle.id]).toEqual(rectangle);
    expect(engine.getSnapshot().selection).toEqual([rectangle.id]);
    expect(engine.execute("edit.redo")).toEqual({ redone: false });
  });

  it("uses upstream rectangle dimensions, name and solid fill defaults", () => {
    const engine = new EditorEngine();
    expect(created(engine)).toMatchObject(fixture.defaults.rectangle);
    expect(created(engine, "node.create", { type: "RECT" })).toMatchObject(fixture.defaults.rectangle);
  });

  it("clamps negative dimensions while preserving negative coordinates", () => {
    expect(created(new EditorEngine(), "shape.rectangle", { x: -10, y: -20, width: -30, height: -40 }))
      .toMatchObject({ x: -10, y: -20, width: 0, height: 0 });
  });

  it("inserts in explicit sibling order and retains the requested name", () => {
    const engine = new EditorEngine();
    const first = created(engine);
    const second = created(engine, "shape.rectangle", { index: 0, name: "Behind" });
    const third = created(engine, "shape.rectangle", { index: 999 });
    expect(pageOf(engine.getSnapshot().document).children).toEqual([second.id, first.id, third.id]);
    expect(second.name).toBe("Behind");
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it("select false preserves selection through creation, undo and redo", () => {
    const engine = new EditorEngine();
    const selected = created(engine);
    const unselected = created(engine, "shape.rectangle", { select: false });
    expect(engine.getSnapshot().selection).toEqual([selected.id]);
    engine.execute("edit.undo");
    expect(engine.getSnapshot().selection).toEqual([selected.id]);
    engine.execute("edit.redo");
    expect(engine.getSnapshot().selection).toEqual([selected.id]);
    expect(engine.getSnapshot().document.nodes[unselected.id]).toEqual(unselected);
  });

  it("discards redo on a new edit and gives each creation one undo step", () => {
    const engine = new EditorEngine();
    const first = created(engine);
    const discarded = created(engine);
    engine.execute("edit.undo");
    const replacement = created(engine);
    expect(engine.execute("edit.redo")).toEqual({ redone: false });
    expect(pageOf(engine.getSnapshot().document).children).toEqual([first.id, replacement.id]);
    expect(engine.getSnapshot().document.nodes[discarded.id]).toBeUndefined();
    expect(engine.execute("edit.undo")).toEqual({ undone: true });
    expect(engine.execute("edit.undo")).toEqual({ undone: true });
    expect(engine.execute("edit.undo")).toEqual({ undone: false });
  });

  it.each(fixture.drawing)("draws $name", ({ start, end, shift, alt, expected }) => {
    expect(drawnRectangle(start, end, shift, alt)).toEqual(expected);
  });

  it("rounds negative halves away from zero and preserves negative zero", () => {
    expect(pixelRound(-2.5)).toBe(-3);
    expect(pixelRound(2.5)).toBe(3);
    expect(Object.is(pixelRound(-0.1), -0)).toBe(true);
  });

  it("uses Rust's negative-zero sign for a Shift-constrained horizontal delta", () => {
    // f64::signum(-0.0) is -1.0; this case cannot be represented in the JSON fixture.
    expect(drawnRectangle({ x: 0, y: 0 }, { x: -0, y: 20 }, true))
      .toEqual({ x: -20, y: 0, width: 20, height: 20 });
  });
});

describe("rectangle port boundary and transaction safety", () => {
  it.each([
    ["shape.vector", {}],
    ["shape.rectangle", { unknown: true }],
    ["shape.rectangle", { props: { effects: [] } }],
    ["shape.rectangle", { width: Number.NaN }],
    ["shape.rectangle", { x: Number.POSITIVE_INFINITY }],
    ["shape.rectangle", { index: "wrong" }],
    ["shape.rectangle", { parent: "missing" }],
    ["shape.rectangle", { index: -1 }],
    ["shape.rectangle", { index: 0.5 }],
    ["shape.rectangle", { index: 1e9 }],
    ["node.create", { type: "vector" }],
    ["shape.rectangle", null],
    ["edit.undo", { extra: true }],
  ] as const)("rejects %s invalid input atomically (%j)", (command, params) => {
    const engine = new EditorEngine();
    created(engine);
    engine.execute("edit.undo");
    const before = engine.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    expect(() => engine.execute(command, params)).toThrow();
    expect(engine.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(engine.execute("edit.redo")).toEqual({ redone: true });
    unsubscribe();
  });

  it("exposes immutable snapshots without modifying earlier document nodes", () => {
    const engine = new EditorEngine();
    const empty = engine.getSnapshot();
    const rectangle = created(engine);
    const before = engine.getSnapshot();
    created(engine);
    expect(empty.document.nodes[rectangle.id]).toBeUndefined();
    expect(pageOf(before.document).children).toEqual([rectangle.id]);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.document)).toBe(true);
    expect(Object.isFrozen(before.document.nodes)).toBe(true);
    expect(Object.isFrozen(pageOf(before.document))).toBe(true);
    expect(Object.isFrozen(pageOf(before.document).children)).toBe(true);
    expect(Object.isFrozen(rectangle)).toBe(true);
    expect(Object.isFrozen(before.selection)).toBe(true);
  });

  it("tool changes do not add undo entries and subscriptions detach", () => {
    const engine = new EditorEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    engine.execute("tool.rectangle");
    expect(engine.getSnapshot().tool).toBe("rectangle");
    expect(engine.getSnapshot().canUndo).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    engine.execute("tool.move");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("denies edits and history mutations after the host disables editing", () => {
    const engine = new EditorEngine();
    created(engine);
    engine.execute("tool.rectangle");
    engine.setEditable(false);
    const before = engine.getSnapshot();
    expect(before.tool).toBe("move");
    for (const command of ["shape.rectangle", "edit.undo", "edit.redo", "tool.rectangle"]) {
      expect(() => engine.execute(command)).toThrow("Sign in");
      expect(engine.getSnapshot()).toBe(before);
    }
    engine.setEditable(true);
    expect(engine.execute("edit.undo")).toEqual({ undone: true });
  });
});
