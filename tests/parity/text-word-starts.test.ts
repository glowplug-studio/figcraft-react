import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { FontLibrary } from "../../src/engine/font-library";
import { ShapingFace } from "../../src/engine/shaping-face";
import { readTextData } from "../../src/engine/text-data";
import { layoutText } from "../../src/engine/text-flow";
import { textWordStarts } from "../../src/engine/text-word-starts";
import reference from "../fixtures/text-word-starts.json" with {type:"json"};

const fonts = new FontLibrary();
for (const face of ShapingFace.read(await readFile(new URL("../../fonts/inter/Inter-Regular.ttf", import.meta.url)))) {
  fonts.add(face);
}

it.each(reference)("matches browser Figcraft word boundaries and line geometry for '$text'", async sample => {
  const [flags, result] = await Promise.all([
    textWordStarts(sample.text),
    layoutText(readTextData({characters:sample.text,auto_resize:"height"}), fonts, {width:sample.width}),
  ]);
  expect(flags.length).toBe(sample.length);
  expect([...flags.keys()].filter(i => flags[i])).toEqual(sample.starts);
  expect({width:result.width,height:result.height,lines:result.lines.map(l => [l.start,l.end,l.width,l.baseline])}).toEqual(sample.flow);
});
