import { inflateRawSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-lists.json";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { loadDesignDocument } from "../../src/engine/interchange/load";
import { readKiwiMessage, readKiwiSchema } from "../../src/engine/interchange/fig/kiwi";
import { writeFigDocument } from "../../src/engine/interchange/fig/write-document";

// Lists: a typed number starts a numbered list at that number, an item made by Enter has no start of its own, a list
// read from a file keeps a start only where it starts counting, and a .fig export writes list spacing, hanging
// punctuation, hanging lists and vertical trim. Observed through the native engine at bad07e44 (upstream a4e33077,
// bb480bdf, 4e9b414c, b190e675, 7c3f9ce7, b8f05d19; tests/fixtures/native-lists.provenance.md).

const keys = ["name", "characters", "listStyle", "lineTypes", "listStartOffsets", "lineIndentations", "listSpacing", "hangingPunctuation", "hangingList", "leadingTrim"];
const listFields = (receipt: Record<string, unknown>) => Object.fromEntries(keys.filter(k => k in receipt).map(k => [k, receipt[k]]));
const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));
type Change = { type: string; name?: string; listSpacing?: number; hangingPunctuation?: boolean; hangingList?: boolean; leadingTrim?: string };

/** The four fields as each text layer of a .fig file holds them, absent ones left out. */
function written(fig: Uint8Array) {
  const canvas = unzipSync(fig)["canvas.fig"], view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength), length = view.getUint32(12, true);
  const [schemaBytes, body] = [canvas.subarray(16, 16 + length), canvas.subarray(20 + length)].map(part => Uint8Array.from(inflateRawSync(part)));
  const message = readKiwiMessage(readKiwiSchema(schemaBytes), body, 2_000_000) as { nodeChanges: Change[] };
  return message.nodeChanges.filter(change => change.type === "TEXT").map(({ listSpacing, hangingPunctuation, hangingList, leadingTrim }) =>
    JSON.parse(JSON.stringify({ listSpacing, hangingPunctuation, hangingList, leadingTrim })) as Record<string, unknown>);
}
/** The list fields of every text of a document, in layer order, as node.get reads them. */
async function textsOf(file: Uint8Array) {
  const engine = new EditorEngine();
  await engine.executeAsync("file.open", { data: Buffer.from(file).toString("base64"), name: "Drawing.figcraft" });
  const { document } = engine.getSnapshot();
  return Object.values(document.nodes).filter(n => n.kind === "text").sort((a, b) => Number(a.id) - Number(b.id))
    .map(n => listFields(engine.execute("node.get", { id: n.id }) as Record<string, unknown>));
}

describe("lists, as upstream changed them", () => {
  it.each(fixture.typing.map(c => [c.name, c] as const))("typing: %s", async (_name, c) => {
    const engine = new EditorEngine();
    let last: Record<string, unknown> = {};
    for (const [command, params] of c.commands as [string, Record<string, unknown>][]) {
      const receipt = await engine.executeAsync(command, params);
      if (command === "node.get") last = receipt as Record<string, unknown>;
    }
    expect(listFields(last)).toEqual(c.text);
  });

  it.each(fixture.exports.map(c => [c.name, c] as const))("export: %s", async (_name, c) => {
    const source = await decodeFigcraft(bytes(c.source)), reopened = await decodeFigcraft(bytes(c.reopened));
    const file = await writeFigDocument(source.document, () => {});
    expect(file.warnings, "export warnings").toEqual(c.exportWarnings);
    expect(written(new Uint8Array(await file.blob.arrayBuffer())), "the four fields as written").toEqual(written(bytes(c.fig)));
    const back = await loadDesignDocument(file.blob, undefined, () => {}, undefined, "Exported.fig");
    expect(back.decoded.issues, "warnings on reopening").toEqual(c.openWarnings);
    expect(back.decoded.document, "the port's export reopened").toEqual(reopened.document);
    const theirs = await loadDesignDocument(new Blob([bytes(c.fig)]), undefined, () => {}, undefined, "Exported.fig");
    expect(theirs.decoded.document, "native's export opened by the port").toEqual(reopened.document);
    expect(await textsOf(bytes(c.reopened)), "the reopened texts' list fields").toEqual(c.reopenedTexts);
  });
});
