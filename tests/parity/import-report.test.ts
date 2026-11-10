import { expect, it } from "vitest";
import { importNotice, readImportReport } from "../../src/engine/interchange/import-report";
import { EditorEngine } from "../../src/engine/editor";

const clean = { warnings: [] };
const known = "layers without a type were skipped";
const note = { warnings: [known] };

it.each([
  ["file.open", "Drawing.fig", clean, "Opened as a new document"],
  ["file.openRecent", "Logo.SVG", clean, undefined],
  ["file.openRecent", "Logo.svg", note, "Opened as a new document"],
  ["file.open", "native.figcraft", { repairs: ["Repaired parent"] }, undefined],
  ["file.open", "Photo.png", {}, undefined],
  ["file.import", "Logo.svg", clean, undefined],
  ["file.import", "Logo.svg", note, "Placed on the current page"],
  ["file.import", "Drawing.fig", { pages: [], warnings: [] }, "Pages added to the document"],
  ["edit.pasteDesignLayers", "", clean, undefined],
  ["edit.pasteDesignLayers", "", note, "Placed on the current page"],
  ["file.export", "", note, undefined],
] as const)("captures %s %s with %j", (command, name, result, action) => {
  expect(readImportReport(command, name, { ...result, warnings: "warnings" in result ? result.warnings : undefined })?.action).toBe(action);
});

it("retains the native summary, count order, note catalogue and repetition suffixes", () => {
  const result = {
    summary: { name: "Synthetic", pages: 2, layers: 12, images: 0 },
    warnings: [known + " (×122)", "some unknown note", known + " (×x)", "vector points with unknown stroke joins use the layer join"],
  };
  expect(readImportReport("file.open", "drawing.json", result)).toEqual({
    name: "Synthetic", action: "Opened as a new document", counts: ["Pages: 2", "Layers: 12", "Images: 0"],
    notes: ["Layers without a type were skipped (×122)", "some unknown note", known + " (×x)", "Vector points with unknown stroke joins use the layer join"],
    omitted: 0,
  });
  expect(readImportReport("edit.pasteDesignLayers", "", note)?.name).toBe("Pasted design layers");
  expect(readImportReport("file.open", "", clean)?.name).toBe("Imported document");
});

it("bounds note retention, counts excess strings and preserves whole Unicode characters", () => {
  const long = "🦎".repeat(2020);
  const report = readImportReport("file.open", long, { warnings: [null, ...Array(537).fill(long), 2] })!;
  expect(report.name).toBe("🦎".repeat(512));
  expect(report.notes).toHaveLength(500);
  expect(report.notes.every(text => text === "🦎".repeat(2000) + "…")).toBe(true);
  expect(report.omitted).toBe(37);
});

it("emits a warning array for a clean external page append and omits it for a clean native append", async () => {
  const engine = new EditorEngine();
  const source = { document: { id: "0:0", type: "DOCUMENT", name: "Imported", children: [{ id: "0:1", type: "CANVAS", name: "Page", children: [] }] } };
  const data = Buffer.from(JSON.stringify(source)).toString("base64");
  expect(await engine.executeAsync("file.import", { name: "External.json", data })).toMatchObject({ warnings: [], summary: { pages: 1 } });
  const native = await engine.executeAsync("file.saveAs", { data: true });
  expect(await engine.executeAsync("file.import", { name: "Native.figcraft", data: native?.data })).not.toHaveProperty("warnings");
});

it("summarises large sets of warnings in the notice while preserving the detailed report", () => {
  expect(importNotice("Drawing.json", [])).toBe("");
  expect(importNotice("Drawing.json", [known])).toBe("Drawing: " + known);
  expect(importNotice("Drawing.json", [known, known])).toBe("Drawing: 2 import warnings; first: " + known);
  expect(importNotice("Drawing.json", [known, known], true)).toContain("2 problems were repaired");
  expect(importNotice("File.svg", ["🦎".repeat(10000)])).toBe("File: " + "🦎".repeat(2000));
});
