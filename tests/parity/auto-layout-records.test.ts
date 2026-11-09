import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
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
