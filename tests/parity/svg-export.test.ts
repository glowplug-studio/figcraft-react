import { expect, it } from "vitest";
import { renderSvgExport } from "../../src/engine/export-svg";
import { deepPatternDocument } from "../fixtures/svg-depth";
import { EditorEngine } from "../../src/engine/editor";
import cases from "../fixtures/native-svg-export.json";
import effects from "../fixtures/native-svg-shadow-export.json";
import dashes from "../fixtures/native-svg-dash-export.json";

it.each([...cases,...effects,...dashes])("matches native SVG structure for $name", async ({commands,svg,name}) => {
  const engine = new EditorEngine();
  for (const [command,input] of commands.slice(0,-1)) {
    if (command === "text.create") await engine.executeAsync(command,input);
    else engine.execute(String(command),input);
  }
  const {data} = await engine.executeAsync("file.exportSvg",commands.at(-1)![1]);
  const actual = Buffer.from(String(data),"base64").toString("utf8");
  // The native rounded rectangle stroke includes redundant cubics of zero length.
  if (name === "outside stroke") expect(actual).toBe(svg.replace(/C(-?\d+) (-?\d+) \1 \2 \1 \2/g,""));
  else expect(actual).toBe(svg);
});

it("counts off-tree SVG pattern sources from the depth of their painting layer",async()=>{
  for (const [outer,inner,drawn] of [[200,40,true],[200,100,false],[1,100,true]] as const) {
    const doc=deepPatternDocument(outer,inner);
    const svg=await (await renderSvgExport(doc,["2"],{})).text();
    expect(svg.includes("#FF0000")).toBe(drawn);
  }
});

it("refuses a visible descendant beyond 256 before exporting a partial SVG",async()=>{
  const doc=deepPatternDocument(258,1);
  await expect(renderSvgExport(doc,["2"],{})).rejects.toThrow(/maximum export depth of 256/);
  expect(await (await renderSvgExport(doc,["3"],{})).text()).toContain("<svg");
});
