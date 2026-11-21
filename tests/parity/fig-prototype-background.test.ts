import { inflateRawSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-fig-prototype-background.json";
import { decodeFigcraft } from "../../src/engine/file-format";
import { loadDesignDocument } from "../../src/engine/interchange/load";
import { readKiwiMessage, readKiwiSchema } from "../../src/engine/interchange/fig/kiwi";
import { writeFigDocument } from "../../src/engine/interchange/fig/write-document";

// A .fig export writes every page's prototype background, opaque, and the import reads it back. Observed through the
// native engine at bad07e44 (upstream fb9df220, #2326; tests/fixtures/native-fig-prototype-background.provenance.md).

type Colour = { r: number; g: number; b: number; a: number };
const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));

/** The prototype background in the record a .fig file holds for its first shown page. */
function written(fig: Uint8Array): Colour | undefined {
  const canvas = unzipSync(fig)["canvas.fig"], view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength), length = view.getUint32(12, true);
  const [schemaBytes, body] = [canvas.subarray(16, 16 + length), canvas.subarray(20 + length)].map(part => Uint8Array.from(inflateRawSync(part)));
  const message = readKiwiMessage(readKiwiSchema(schemaBytes), body, 2_000_000) as { nodeChanges: { type: string; internalOnly?: boolean; prototypeBackgroundColor?: Colour }[] };
  return message.nodeChanges.find(change => change.type === "CANVAS" && !change.internalOnly)?.prototypeBackgroundColor;
}

describe("a page's prototype background in .fig files", () => {
  it.each(fixture.cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = await decodeFigcraft(bytes(c.reopened));
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    const mine = new Uint8Array(await file.blob.arrayBuffer()), record = written(bytes(c.fig));
    expect(record, "native writes the field").toBeDefined();
    expect(written(mine), "the written record").toEqual(record);
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig");
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(back.decoded.document, "the port's export reopened").toEqual(reopened.document);
    const theirs = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Exported.fig");
    expect(theirs.decoded.document, "native's export opened by the port").toEqual(reopened.document);
  });

  // crates/format/src/rest/proto.rs::page_settings: the first of `prototypeBackgrounds`, read opaque; an alpha of 0
  // is no background.
  it.each(fixture.rest.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const opened = await loadDesignDocument(new Blob([JSON.stringify(c.file)]), undefined, () => {}, undefined, "Page.json");
    expect(opened.decoded.issues, "warnings").toEqual(c.openWarnings);
    expect(opened.decoded.document).toEqual((await decodeFigcraft(bytes(c.opened))).document);
  });

  it("the cases cover a set, a default and a translucent background", () => {
    expect(fixture.cases.map(c => c.reopenedSettings.background)).toEqual(["#336699", "#1E1E1E", "#336699"]);
    expect(fixture.cases[2].exportWarnings).toEqual(["a prototype background's opacity was left out"]);
    expect(fixture.rest.map(c => c.settings.background)).toEqual(["#336699", "#336699", "#1E1E1E", "#1E1E1E", "#336699"]);
  });
});
