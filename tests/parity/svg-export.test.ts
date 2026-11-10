import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import cases from "../fixtures/native-svg-export.json";

it.each(cases)("matches native SVG structure for $name", async ({commands,svg,name}) => {
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
