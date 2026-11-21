import { inflateRawSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-fig-region-paints.json";
import { decodeFigcraft } from "../../src/engine/file-format";
import { loadDesignDocument } from "../../src/engine/interchange/load";
import { readKiwiMessage, readKiwiSchema } from "../../src/engine/interchange/fig/kiwi";
import { writeFigDocument } from "../../src/engine/interchange/fig/write-document";

// A .fig export writes each vector region's own paints as an entry of the network's style table. Observed through the
// native engine at bad07e44 (upstream f1e92749, 98f94626, #2302; tests/fixtures/native-fig-region-paints.provenance.md).

type Style = Record<string, unknown> & { styleID: number };
type Change = { type: string; vectorData?: { vectorNetworkBlob: number; styleOverrideTable?: Style[] } };
const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));

/** The style table of the vector a .fig file holds, and each region's style and winding as its network says. */
function written(fig: Uint8Array) {
  const canvas = unzipSync(fig)["canvas.fig"], view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength), length = view.getUint32(12, true);
  const [schemaBytes, body] = [canvas.subarray(16, 16 + length), canvas.subarray(20 + length)].map(part => Uint8Array.from(inflateRawSync(part)));
  const message = readKiwiMessage(readKiwiSchema(schemaBytes), body, 2_000_000) as { nodeChanges: Change[]; blobs: { bytes: Uint8Array }[] };
  const data = message.nodeChanges.find(change => change.vectorData)!.vectorData!, blob = message.blobs[data.vectorNetworkBlob].bytes;
  const words = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), [vertices, segments, count] = [0, 4, 8].map(at => words.getUint32(at, true));
  const regions: { style: number; nonZero: boolean }[] = [];
  let at = 12 + vertices * 12 + segments * 28;
  for (let r = 0; r < count; r++) {
    const word = words.getUint32(at, true), loops = words.getUint32(at + 4, true); at += 8;
    regions.push({ style: word >>> 1, nonZero: (word & 1) === 1 });
    for (let l = 0; l < loops; l++) at += 4 + words.getUint32(at, true) * 4;
  }
  return { styles: data.styleOverrideTable ?? [], regions };
}

describe("vector region paints in .fig files", () => {
  it.each(fixture.cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = await decodeFigcraft(bytes(c.reopened));
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    expect(written(new Uint8Array(await file.blob.arrayBuffer())), "the written style table and region styles").toEqual(written(bytes(c.fig)));
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig");
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(back.decoded.document, "the port's export reopened").toEqual(reopened.document);
    const theirs = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Exported.fig");
    expect(theirs.decoded.document, "native's export opened by the port").toEqual(reopened.document);
  });

  it("the cases cover shared, separate and empty lists", () => {
    const tables = Object.fromEntries(fixture.cases.map(c => [c.name, written(bytes(c.fig))]));
    expect(tables["no region paints"].regions.map(r => r.style)).toEqual([0, 0]);
    // Equal lists share one entry; different lists take one each; a region without paints of its own writes style 0.
    const shared = tables["two regions with equal paints"].regions.map(r => r.style);
    expect(shared[0]).toBeGreaterThan(0); expect(shared[1]).toBe(shared[0]);
    const apart = tables["two regions with different paints"].regions.map(r => r.style);
    expect(new Set(apart).size).toBe(2); expect(Math.min(...apart)).toBeGreaterThan(0);
    const one = tables["one region with a colour of its own"].regions.map(r => r.style);
    expect(one[0]).toBeGreaterThan(0); expect(one[1]).toBe(0);
    // An empty list is a list of its own: the region shows nothing where the layer's fill would.
    const empty = tables["a region with an empty list"], style = empty.styles.find(s => s.styleID === empty.regions[1].style);
    expect(style?.fillPaints).toEqual([]);
  });
});
