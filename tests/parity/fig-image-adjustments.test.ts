import { inflateRawSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-fig-image-adjustments.json";
import { decodeFigcraft } from "../../src/engine/file-format";
import { loadDesignDocument } from "../../src/engine/interchange/load";
import { readKiwiMessage, readKiwiSchema } from "../../src/engine/interchange/fig/kiwi";
import { writeFigDocument } from "../../src/engine/interchange/fig/write-document";

// A .fig export writes an image paint's adjustments as the paint's `paintFilter`, within the file's range. Observed
// through the native engine at bad07e44 (upstream b54df860, 501df234, #2297;
// tests/fixtures/native-fig-image-adjustments.provenance.md).

type Paint = { type: string; paintFilter?: Record<string, number> };
type Change = { type: string; name?: string; fillPaints?: Paint[]; strokePaints?: Paint[] };
const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));

/** The `paintFilter` of each image paint of the image layer a .fig file holds: fills, then strokes. */
function written(fig: Uint8Array) {
  const canvas = unzipSync(fig)["canvas.fig"], view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength), length = view.getUint32(12, true);
  const [schemaBytes, body] = [canvas.subarray(16, 16 + length), canvas.subarray(20 + length)].map(part => Uint8Array.from(inflateRawSync(part)));
  const schema = readKiwiSchema(schemaBytes), message = readKiwiMessage(schema, body, 2_000_000) as { nodeChanges: Change[] };
  const layer = message.nodeChanges.find(change => change.name === "Image")!;
  const filters = (paints: Paint[] | undefined) => (paints ?? []).filter(p => p.type === "IMAGE").map(p => p.paintFilter ?? null);
  return { fills: filters(layer.fillPaints), strokes: filters(layer.strokePaints) };
}

describe("image adjustments in .fig files", () => {
  it.each(fixture.cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = await decodeFigcraft(bytes(c.reopened));
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    expect(written(new Uint8Array(await file.blob.arrayBuffer())), "the written paints").toEqual(written(bytes(c.fig)));
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig");
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(back.decoded.document, "the port's export reopened").toEqual(reopened.document);
    const theirs = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Exported.fig");
    expect(theirs.decoded.issues, "warnings on opening native's export").toEqual(c.openWarnings);
    expect(theirs.decoded.document, "native's export opened by the port").toEqual(reopened.document);
  });

  it("the cases cover what is written and what is not", () => {
    const paints = Object.fromEntries(fixture.cases.map(c => [c.name, written(bytes(c.fig))]));
    expect(paints["no adjustment"]).toEqual({ fills: [null], strokes: [] });
    // Every field is written once one is set; saturation is the file's vibrance and the tint's sign is the file's.
    expect(Object.keys(paints["one adjustment"].fills[0]!).sort()).toEqual(["contrast", "exposure", "highlights", "shadows", "temperature", "tint", "vibrance"]);
    expect(paints["one adjustment"].fills[0]!.tint).toBe(-1);
    expect(paints["every adjustment"].fills[0]).toMatchObject({ tint: 1, vibrance: Math.fround(-0.4), shadows: Math.fround(0.7) });
    // A value outside the file's range is written at its end.
    expect(fixture.cases.find(c => c.name.startsWith("an adjustment out of range"))!.layer.fills[0]!.exposure).toBe(5);
    expect(paints["an adjustment out of range in a fills property"].fills[0]!.exposure).toBe(1);
    expect(paints["a stroke's image"].strokes[0]!.shadows).toBe(-0.5);
  });
});
