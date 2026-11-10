import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { expect, it } from "vitest";
import { decodeFigcraft } from "../../src/engine/file-format";
import { layerCss } from "../../src/engine/layer-css";

const archive = (name: string) => unzipSync(readFileSync(new URL("../fixtures/" + name + ".zip", import.meta.url)));
for (const [filename, bytes] of Object.entries(archive("native-layer-css"))) {
  const sources = archive(filename.replace(/\.json$/, ""));
  const cases: Record<string, Record<string, string>> = JSON.parse(strFromU8(bytes));
  it.each(Object.entries(cases))(filename + " matches native CSS for every layer in %s", async (drawing, expected) => {
    const { document } = await decodeFigcraft(sources[drawing]);
    for (const [id, css] of Object.entries(expected)) expect(layerCss(document, document.nodes[id]), "Layer " + id).toBe(css);
  });
}

it("escapes comments and font strings and matches the native decorated RTL and mixed text properties", async () => {
  const files = archive("native-clipboard-code");
  const { document } = await decodeFigcraft(files["Clipboard.figcraft"]);
  const expected: Record<string, string> = JSON.parse(strFromU8(files["css.json"]));
  for (const [id, css] of Object.entries(expected)) expect(layerCss(document, document.nodes[id])).toBe(css);
});
