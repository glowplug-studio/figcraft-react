import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-fig-point-radius.json";
import { decodeFigcraft } from "../../src/engine/file-format";
import type { Document, VectorNode } from "../../src/engine/document";
import { loadDesignDocument } from "../../src/engine/interchange/load";
import { writeFigDocument } from "../../src/engine/interchange/fig/write-document";

// A vector point without a corner radius of its own takes the layer's when a .fig is read, and the export writes a
// sharp point on a rounded vector with its own zero so it stays sharp. Observed through the native engine at bad07e44
// (upstream a6be897d, #2114; tests/fixtures/native-fig-point-radius.provenance.md).

const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));
const radii = (document: Document) => (Object.values(document.nodes).find(n => n.kind === "vector") as VectorNode).network.vertices.map(v => v.radius);

describe("a vector point's corner radius in .fig files", () => {
  it.each(fixture.cases.map(c => [c.name, c] as const))("export: %s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = await decodeFigcraft(bytes(c.reopened));
    expect(radii(source.document)).toEqual(c.radii);
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig");
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(radii(back.decoded.document), "the points' radii after the port's export and reopening").toEqual(c.reopenedRadii);
    expect(back.decoded.document, "the port's export reopened").toEqual(reopened.document);
    const theirs = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Exported.fig");
    expect(theirs.decoded.document, "native's export opened by the port").toEqual(reopened.document);
  });

  it.each(fixture.crafted.map(c => [c.name, c] as const))("import: %s", async (_name, c) => {
    const opened = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Crafted.fig");
    expect(opened.decoded.issues, "warnings").toEqual(c.openWarnings);
    expect(radii(opened.decoded.document), "the points' radii").toEqual(c.radii);
    expect(opened.decoded.document).toEqual((await decodeFigcraft(bytes(c.opened))).document);
  });

  it("the cases cover sharp and rounded points under sharp and rounded layers", () => {
    expect(fixture.cases.map(c => [c.layerRadius, c.radii, c.reopenedRadii])).toEqual([
      [8, [8, 0, 8, 0], [8, 0, 8, 0]], [8, [8, 8, 8, 8], [8, 8, 8, 8]], [null, [20, 0, 10, 0], [20, 0, 10, 0]], [8, [8, 3, 8, 8], [8, 3, 8, 8]], [null, [0, 0, 0, 0], [0, 0, 0, 0]],
    ]);
    expect(fixture.crafted.map(c => [c.layerRadius, c.radii])).toEqual([[8, [8, 8, 8, 8]], [8, [8, 8, 8, 8]]]);
  });
});
