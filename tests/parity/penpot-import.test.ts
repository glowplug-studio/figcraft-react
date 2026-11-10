import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { decodeFigcraft } from "../../src/engine/file-format";
import { withPenpotArchive } from "../../src/engine/interchange/penpot/archive";
import { penpotScene } from "../../src/engine/interchange/penpot/scene";

const corpus = Object.assign({}, ...["native-penpot-files", "native-penpot-archive-edges","native-penpot-prototype-edges"].map(name =>
  unzipSync(readFileSync(new URL("../fixtures/" + name + ".zip", import.meta.url)))
)) as Record<string, Uint8Array>;

// These two archives need Chromium's SVG DOM and font shaping. The Playwright
// Penpot raw SVG comparison opens both through the public file entry point.
const browserSvg = new Set(["tests-raw_svg_from_export_is_preserved_for_native_svg_expansion-0.penpot","tests-svg_raw_boxes_are_never_painted-0.penpot"]);
it.each(Object.keys(corpus).filter(name => name.endsWith(".penpot") && !browserSvg.has(name)))("imports editable Penpot data against native file.open and file.saveAs for %s", async filename => {
  const stem = filename.slice(0, -7);
  const receipt = JSON.parse(new TextDecoder().decode(corpus[stem + ".json"]));
  const reading = withPenpotArchive(corpus[filename], () => {}, penpotScene);
  if (receipt.error) {
    await expect(reading).rejects.toThrow(receipt.error);
    return;
  }
  const actual = await reading;
  const expected = await decodeFigcraft(corpus[stem + ".figcraft"]);
  expect(actual.document).toEqual(expected.document);
  for (const [id,image] of Object.entries(expected.document.images ?? {})) {
    const bytes=actual.document.images![id].bytes;
    expect(bytes.type).toBe(image.bytes.type);
    expect(await bytes.arrayBuffer()).toEqual(await image.bytes.arrayBuffer());
  }
  expect(actual.nextId).toBe(expected.nextId);
  expect(actual.issues).toEqual(receipt.warnings);
});
