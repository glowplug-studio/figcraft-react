import {describe, expect, it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {base64Bytes} from "../../src/engine/recovery";

function nativeGrid() {
  const box = (id: number) => ({id, type: "rectangle", parent: 2, name: String(id), width: 20, height: 20});
  return {name: "Grid", next_id: 7, pages: [1], current_page: 1, nodes: {
    1: {id: 1, type: "page", name: "Page", width: 0, height: 0, children: [2]},
    2: {id: 2, type: "frame", parent: 1, name: "Grid", width: 320, height: 200, children: [3,4,5,6], layout: {
      mode: "grid", padding: [0,0,0,0], gap: 10, cross_gap: 10, grid_columns: 3,
      column_tracks: [{sizing: "fixed", value: 100}, {sizing: "fill", value: 1}, {sizing: "hug", value: 0}],
    }},
    3: box(3), 4: box(4), 5: box(5), 6: box(6),
  }};
}
async function open(raw: unknown) {
  const engine = new EditorEngine();
  await engine.executeAsync("file.open", {data: base64Bytes(new TextEncoder().encode(JSON.stringify(raw)))});
  return engine;
}

describe("native layout.setTrack", () => {
  it("fixes a track at its resolved width, reflows siblings and restores the exact document on undo", async () => {
    const engine = await open(nativeGrid());
    const before = engine.getSnapshot().document;
    engine.execute("layout.setTrack", {ids: [2], axis: "col", index: 1, sizing: "fixed"});
    const fixed = engine.getSnapshot().document;
    expect(fixed.nodes[2]).toMatchObject({layout: {columnTracks: [{value: 100}, {sizing: "fixed",value: 180}, {value: 0}]}});
    expect(fixed.nodes[4]).toMatchObject({x: 110, y: 0});
    expect(fixed.nodes[5]).toMatchObject({x: 300, y: 0});
    engine.execute("layout.setTrack", {id: 2, axis: "row", index: 0, sizing: "fixed", value: 50});
    expect(engine.getSnapshot().document.nodes[6]).toMatchObject({x: 0, y: 60});
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(fixed);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(fixed);
  });

  it("reflows edited child widths, clamps track indices and rejects mixed targets atomically", async () => {
    const engine = await open(nativeGrid());
    engine.execute("node.set", {id: 5, width: 45});
    expect(engine.getSnapshot().document.nodes[5]).toMatchObject({x: 275, y: 0});
    const prior = engine.getSnapshot().document;
    for (const invalid of [{ids: [2,3]}, {index: 3}, {index: -1}, {index: 0.5}, {axis: "z"}, {sizing: "invalid"}]) {
      expect(() => engine.execute("layout.setTrack", {ids: [2], index: 0, axis: "x", sizing: "hug", ...invalid})).toThrow();
      expect(engine.getSnapshot().document).toBe(prior);
    }
  });
});

it("keeps live text and the next row aligned through an edit, composition and undo", async () => {
  const raw = nativeGrid();
  Object.assign(raw.nodes[2], {width: 96, children: [3,4], layout: {
    mode: "grid", grid_columns: 1, grid_rows: 2, padding: [0,0,0,0], gap: 0, cross_gap: 3,
    row_tracks: [{sizing: "hug"}, {sizing: "hug"}],
  }});
  Reflect.deleteProperty(raw.nodes, "5"); Reflect.deleteProperty(raw.nodes, "6");
  Object.assign(raw.nodes[3], {type: "text", characters: "Short", auto_resize: "height", child_layout: {sizing_h: "fill", sizing_v: "hug"}});
  const engine = await open(raw);
  engine.execute("layout.setTrack", {id: 2, axis: "columns", index: 0, sizing: "fixed", value: 96});
  const before = engine.getSnapshot().document;
  const session = engine.beginTextEdit({id: "3"});
  session.replace(0, 5, "A long line of text wraps at the fixed column edge.");
  const edited = session.node();
  expect(edited.width).toBe(96);
  expect(edited.height).toBeGreaterThan((before.nodes[3] as typeof edited).height);
  session.select(0,0);
  session.compose("日本");
  const preedit = session.compositionPreview()!;
  expect(preedit.node).toBe(preedit.document.nodes["3"]);
  session.compose(""); session.finish();
  const saved = engine.getSnapshot().document;
  expect(saved.nodes[3]).toBe(edited);
  expect(saved.nodes[4]).toMatchObject({y: edited.height + 3});
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
});

it("propagates a track resize through 192 nested fill frames", async () => {
  const depth = 192;
  const nodes: Record<string, unknown> = {1: {id: 1, type: "page", name: "Page", width: 0, height: 0, children: [2]}};
  for (let index = 0; index < depth; index++) {
    const id = index + 2;
    nodes[id] = {id, parent: id-1, name: "Grid", type: "frame", width: 100, height: 100,
      children: index+1 < depth ? [id+1] : [],
      child_layout: index ? {sizing_h: "fill", sizing_v: "fill"} : {},
      layout: {mode: "grid", grid_columns: 1, grid_rows: 1, gap: 0, padding: [0,0,0,0]}};
  }
  const engine = await open({name: "Nested grid", next_id: depth+2, pages: [1], current_page: 1, nodes});
  const before = engine.getSnapshot().document;
  engine.execute("layout.setTrack", {id: 2, axis: "x", index: 0, sizing: "fixed", value: 350});
  expect(engine.getSnapshot().document.nodes[depth+1]).toMatchObject({width: 350, height: 100});
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
});
