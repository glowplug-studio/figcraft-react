import { inflateRawSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-fig-text-path-export.json";
import { decodeFigcraft } from "../../src/engine/file-format";
import type { Document, LayerNode } from "../../src/engine/document";
import { loadDesignDocument } from "../../src/engine/interchange/load";
import { readKiwiMessage, readKiwiSchema } from "../../src/engine/interchange/fig/kiwi";
import { writeFigDocument } from "../../src/engine/interchange/fig/write-document";

// A .fig export writes text on a path as the format's own layer kind, with its start and its path as a vector
// network. Observed through the native engine at bad07e44 (upstream 88b63d1e, a243f0b8, 193c3a35, #2323;
// tests/fixtures/native-fig-text-path-export.provenance.md).

type Change = { type: string; textAlignVertical?: string; textPathStart?: { tValue: number; forward: boolean }; vectorData?: { vectorNetworkBlob: number; normalizedSize: { x: number; y: number } } };
type TextNode = LayerNode & { kind: "text" };
const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));

/** What a .fig file holds for its text layer: the layer kind, the start, and the bytes of its path's network. */
function written(fig: Uint8Array) {
  const canvas = unzipSync(fig)["canvas.fig"], view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength), length = view.getUint32(12, true);
  const [schemaBytes, body] = [canvas.subarray(16, 16 + length), canvas.subarray(20 + length)].map(part => Uint8Array.from(inflateRawSync(part)));
  const message = readKiwiMessage(readKiwiSchema(schemaBytes), body, 2_000_000) as { nodeChanges: Change[]; blobs: { bytes: Uint8Array }[] };
  const text = message.nodeChanges.find(change => change.type === "TEXT" || change.type === "TEXT_PATH")!;
  return { type: text.type, align: text.textAlignVertical, start: text.textPathStart, size: text.vectorData?.normalizedSize,
    network: text.vectorData && Array.from(message.blobs[text.vectorData.vectorNetworkBlob].bytes) };
}
const textOf = (document: Document) => Object.values(document.nodes).find(n => n.kind === "text") as TextNode;
/** The document with its texts' path starts set aside: a start comes back through a 32-bit parameter and a measured
 * length. `start` is the first text's. */
function apart(document: Document) {
  const nodes = { ...document.nodes }, starts: (number | undefined)[] = [];
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== "text") continue;
    starts.push(node.text.path?.start);
    if (node.text.path) nodes[node.id] = { ...node, text: { ...node.text, path: { ...node.text.path, start: 0 } } };
  }
  return { start: starts[0], starts, document: { ...document, nodes } };
}

describe("text on a path in .fig export", () => {
  it.each(fixture.cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = apart((await decodeFigcraft(bytes(c.reopened))).document);
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    const mine = written(new Uint8Array(await file.blob.arrayBuffer())), theirs = written(bytes(c.fig));
    expect({ ...mine, start: mine.start?.forward }, "the written layer").toEqual({ ...theirs, start: theirs.start?.forward });
    if (theirs.start) expect(mine.start!.tValue, "the start's parameter").toBeCloseTo(theirs.start.tValue, 6);
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig"), mineBack = apart(back.decoded.document);
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(mineBack.document, "the port's export reopened").toEqual(reopened.document);
    expect(textOf(back.decoded.document).text.path?.d, "the path after reopening").toBe(c.reopenedTextPath?.d);
    if (reopened.start === undefined) expect(mineBack.start).toBeUndefined();
    else expect(mineBack.start, "the start after reopening").toBeCloseTo(reopened.start, 6);
  });

  // An instance's override row follows its main's layer: it is on a path in the file when, and only when, the main is.
  it.each(fixture.instances.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = apart((await decodeFigcraft(bytes(c.reopened))).document);
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig"), mine = apart(back.decoded.document);
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(mine.document, "the port's export reopened").toEqual(reopened.document);
    expect(mine.starts.length).toBe(reopened.starts.length);
    for (const [i, start] of reopened.starts.entries()) {
      if (start === undefined) expect(mine.starts[i]).toBeUndefined(); else expect(mine.starts[i]).toBeCloseTo(start, 6);
    }
    const theirs = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Exported.fig");
    expect(apart(theirs.decoded.document).document, "native's export opened by the port").toEqual(reopened.document);
  });

  it("the cases cover what goes on a path and what stays plain text", () => {
    const kinds = Object.fromEntries(fixture.cases.map(c => [c.name, written(bytes(c.fig)).type]));
    expect(kinds).toEqual({ "a straight path": "TEXT_PATH", "a curve": "TEXT_PATH", "a start a quarter along and flipped": "TEXT_PATH", "a start on the second segment": "TEXT_PATH",
      "a quadratic curve": "TEXT_PATH", "a closed path": "TEXT_PATH", "a path of two parts": "TEXT_PATH", "text of two lines": "TEXT" });
    const flipped = written(bytes(fixture.cases[2].fig));
    expect(flipped.start?.forward).toBe(false); expect(flipped.align).toBe("TOP");
  });
});
