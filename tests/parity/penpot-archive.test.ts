import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { PenpotArchive, penpotError, rootId, withPenpotArchive } from "../../src/engine/interchange/penpot/archive";
import { decodeFigcraft } from "../../src/engine/file-format";

const corpus = Object.assign({}, ...["native-penpot-files", "native-penpot-archive-edges"].map(name =>
  unzipSync(readFileSync(new URL("../fixtures/" + name + ".zip", import.meta.url)))
)) as Record<string, Uint8Array>;

async function inspect(archive: PenpotArchive) {
  const files = await archive.manifest(), fontWarning = await archive.fontWarning(), pages = [];
  for (const file of files) {
    for (const page of await archive.pages(file)) {
      const shapes = await archive.shapes(String(file.id), page);
      expect(shapes.has(rootId)).toBe(true);
      pages.push({id: page.id, name: page.name});
    }
  }
  if (!pages.length) throw penpotError("no pages found");
  return {pages, fontWarning};
}

it.each(Object.keys(corpus).filter(name => name.endsWith(".penpot")))("reads the native archive structure and page order for %s", async filename => {
  const stem = filename.slice(0, -7), receipt = JSON.parse(new TextDecoder().decode(corpus[stem + ".json"]));
  const reading = withPenpotArchive(corpus[filename], () => {}, inspect);
  if (receipt.error) {
    await expect(reading).rejects.toThrow(receipt.error);
    return;
  }
  const {document} = await decodeFigcraft(corpus[stem + ".figcraft"]);
  const {pages, fontWarning} = await reading;
  expect(pages).toEqual(document.pages.map(id => ({
    id: document.nodes[id].sourceMetadata?.["penpot.pageId"], name: document.nodes[id].name,
  })));
  expect(fontWarning).toBe(receipt.warnings.find((line: string) => line.startsWith("Penpot contains ") && line.includes("embedded font file")));
});
