import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { executeSizing } from "../../src/engine/sizing";
import { placeGridCells } from "../../src/engine/grid-placement";
import { getNode } from "../../src/engine/inspect";

function frameBytes(layout: unknown) {
  const doc = JSON.parse(readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  Object.assign(doc.nodes["2"], { type: "frame", children: [], layout });
  return new TextEncoder().encode(JSON.stringify(doc));
}

describe("native auto layout frame records", () => {
  it("keeps an ordinary frame distinct from an empty layout record", async () => {
    for (const raw of [null, undefined]) {
      const {document} = await decodeFigcraft(frameBytes(raw));
      expect(getNode(document, {id: 2})).not.toHaveProperty("layout");
    }
    const {document} = await decodeFigcraft(frameBytes({}));
    expect(getNode(document, {id: 2})).toHaveProperty("layout", {
      mode: "horizontal", wrap: false, gap: 10, crossGap: 10, padding: [10, 10, 10, 10],
      mainAlign: "min", crossAlign: "min", contentAlign: "auto", gridColumns: 2, gridRows: 2,
      columnTracks: [], rowTracks: [], strokesIncluded: true, reverseZ: false,
    });
  });

  it("round trips all settings, implicit tracks and raw unsigned counts through the archive", async () => {
    const raw = {mode: "grid", wrap: true, gap: -1.25, cross_gap: 2.5, padding: [1, 2, 3, 4],
      main_align: "spaceEvenly", cross_align: "baseline", content_align: "spaceBetween",
      grid_columns: 4294967295, grid_rows: 0, column_tracks: [{}, {sizing: "hug"}, {sizing: "fixed", value: 56}],
      row_tracks: [{sizing: "fill", value: 2.25}], strokes_included: false, reverse_z: true};
    const loaded = await decodeFigcraft(frameBytes(raw));
    expect(getNode(loaded.document, {id: 2})).toMatchObject({layout: {
      mode: "grid", wrap: true, gap: -1.25, crossGap: 2.5, padding: [1, 2, 3, 4],
      mainAlign: "spaceEvenly", crossAlign: "baseline", contentAlign: "spaceBetween",
      gridColumns: 4294967295, gridRows: 0, columnTracks: [{sizing: "fill", value: 1}, {sizing: "hug", value: 1}, {sizing: "fixed", value: 56}],
      rowTracks: [{sizing: "fill", value: 2.25}], strokesIncluded: false, reverseZ: true,
    }});
    expect(await decodeFigcraft(await encodeFigcraft(loaded.document, loaded.nextId))).toEqual(loaded);
  });

  it.each([false, [], {mode: "GRID"}, {wrap: null}, {padding: [3]}, {gap: "1px"}, {grid_rows: 1.5},
    {grid_columns: -1}, {grid_columns: 4294967296}, {row_tracks: [null]}, {row_tracks: [{sizing: "auto"}]},
    {reverse_z: 1}, {unknown_setting: 2}])("rejects invalid or unsupported layout %j", async value => {
    await expect(decodeFigcraft(frameBytes(value))).rejects.toThrow();
  });
});

async function gridWithChildren(children: Record<string, unknown>[]) {
  const file = JSON.parse(readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
  const frame = file.nodes["2"];
  Object.assign(frame, {type: "frame", layout: {mode: "grid", grid_columns: 3}, children: []});
  children.forEach((props, index) => {
    const id = index + 3;
    file.nodes[id] = {id, parent: 2, name: "Layer", type: "rectangle", width: 10, height: 15, ...props};
    frame.children.push(id);
  });
  file.next_id = 3 + children.length;
  return decodeFigcraft(new TextEncoder().encode(JSON.stringify(file)));
}

describe("native grid children", () => {
  it("keeps layer order whilst reserving anchors first and skipping hidden and absolute children", async () => {
    const {document} = await gridWithChildren([
      {child_layout: {sizing_h: "fill", grid_column_span: 2, min_w: 0, max_h: 55}},
      {child_layout: {grid_column: 0, grid_row: 0, grid_align_v: "max"}},
      {child_layout: {absolute: true}}, {visible: false}, {child_layout: {grid_row_span: 2, grid_column: 1}},
    ]);
    const inspect = (id: number) => getNode(document, {id, fields: ["sizing", "gridCell", "absolute", "minWidth", "maxHeight", "constraints"]});
    expect(inspect(3)).toEqual({id: 3, sizing: {horizontal: "fill", vertical: "fixed"}, minWidth: 0, maxHeight: 55,
      gridCell: {column: 1, row: 0, columnSpan: 2, rowSpan: 1, anchored: false, alignH: null, alignV: null}});
    expect(inspect(4)?.gridCell).toEqual({column: 0, row: 0, columnSpan: 1, rowSpan: 1, anchored: true, alignH: null, alignV: "max"});
    expect(inspect(5)).toMatchObject({absolute: true, constraints: {horizontal: "left", vertical: "top"}});
    expect(inspect(5)).not.toHaveProperty("gridCell");
    expect(inspect(6)).not.toHaveProperty("gridCell");
    expect(inspect(7)?.gridCell).toMatchObject({column: 1, row: 1, rowSpan: 2});
    expect((await decodeFigcraft(await encodeFigcraft(document))).document).toEqual(document);
  });

  it("scales gaps, padding, fixed tracks and child limits while retaining grid indices", async () => {
    const {document} = await gridWithChildren([{child_layout: {min_w: 0, max_w: 40, min_h: 3, grid_column: 1}}]);
    const next = executeSizing("transform.scale", document, ["2"], {factor: 2});
    expect(next.nodes["2"]).toMatchObject({layout: {gap: 20, crossGap: 20, padding: [20, 20, 20, 20]}});
    expect(next.nodes["3"]).toMatchObject({childLayout: {minWidth: 0, maxWidth: 80, minHeight: 6, gridColumn: 1}});
    const tracks = await decodeFigcraft(frameBytes({column_tracks: [{sizing: "fixed", value: 12}, {sizing: "fill", value: 2}]}));
    expect(executeSizing("transform.scale", tracks.document, ["2"], {factor: 3}).nodes["2"]).toMatchObject(
      {layout: {columnTracks: [{sizing: "fixed", value: 36}, {sizing: "fill", value: 2}]}});
  });

  it("finds free spans across occupancy words and overlaps exhausted cells in the last fitting row", async () => {
    const {document} = await gridWithChildren([
      {child_layout: {grid_column: 31, grid_row: 0, grid_column_span: 35}},
      {child_layout: {grid_column_span: 32}}, {child_layout: {grid_column: 128, grid_row_span: 1000}},
      {child_layout: {grid_column: 128, grid_row_span: 3}},
    ]);
    const frame = document.nodes["2"];
    if (frame.kind !== "frame" || !frame.layout) throw new Error("Expected grid");
    const grid = placeGridCells(document, {...frame, layout: {...frame.layout, gridColumns: 130}});
    expect([...grid.cells.values()]).toEqual([
      {column: 31, row: 0, columnSpan: 35, rowSpan: 1}, {column: 66, row: 0, columnSpan: 32, rowSpan: 1},
      {column: 128, row: 0, columnSpan: 1, rowSpan: 1000}, {column: 128, row: 997, columnSpan: 1, rowSpan: 3},
    ]);
    expect(grid.rows).toBe(1000);
  });

  it.each([{sizing_h: null}, {grid_column: -1}, {grid_align_v: "MAX"}, {grid_row_span: 0.5},
    {min_w: "4"}, {grid_column_span: 4294967296}, {absolute: "true"}, {unrecognised: 2}])(
    "rejects malformed child settings %j", async child_layout => {
      await expect(gridWithChildren([{child_layout}])).rejects.toThrow();
    });
});
