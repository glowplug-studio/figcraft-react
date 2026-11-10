import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {parse} from "lossless-json";
import {it,expect} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {writePenpotDocument} from "../../src/engine/interchange/penpot/write-document";
import {EditorEngine} from "../../src/engine/editor";

const corpus=(name:string)=>unzipSync(readFileSync(new URL("../fixtures/"+name+".zip",import.meta.url)));
const authored=corpus("native-penpot-authored-exports");
const outputs={...corpus("native-penpot-exports"),...authored};
const inputs=Object.assign({},...["native-penpot-files","native-penpot-archive-edges","native-penpot-prototype-edges"].map(corpus));
for (const [k,v] of Object.entries(corpus("native-sketch-files"))) inputs["native-sketch-files__"+k]=v;
for (const [k,v] of Object.entries(authored)) if (k.endsWith(".input.figcraft")) inputs[k.replace(".input.figcraft",".figcraft")]=v;
const text=new TextDecoder();
it.each(Object.keys(outputs).filter(n=>n.endsWith(".penpot")))("writes and reopens the native Penpot archive for %s",async name=>{
  const stem=name.slice(0,-7),{document}=await decodeFigcraft(inputs[stem+".figcraft"]);
  const native=unzipSync(outputs[name]),receipt=JSON.parse(text.decode(outputs[stem+".json"]));
  const result=await writePenpotDocument(document,()=>{});
  const bytes=new Uint8Array(await result.blob.arrayBuffer()),actual=unzipSync(bytes);
  expect(result.warnings).toEqual(receipt.exportWarnings);
  expect(Object.keys(actual).sort()).toEqual(Object.keys(native).sort());
  for (const path of Object.keys(native)) {
    if (!path.endsWith(".json")) {
      expect(actual[path],path).toEqual(native[path]);
      continue;
    }
    const expected=parse(text.decode(native[path])) as Record<string,unknown>;
    if (path==="manifest.json") {
      expect(expected.generatedBy).toBe("figcraft/0.15.0");
      expected.generatedBy="figcraft-react";
    }
    // Source metadata may contain a u64 outside the JS safe range or a float-valued integer.
    expect(parse(text.decode(actual[path])),path).toEqual(expected);
  }
  // These two raw-SVG archives need Chromium's SVG DOM and font renderer.
  if (stem.includes("raw_svg_from_export") || stem.includes("svg_raw_boxes")) return;
  const engine=new EditorEngine();
  const reopened=await engine.openFile(new File([result.blob],"Reopened.penpot"));
  const expected=await decodeFigcraft(outputs[stem+".figcraft"]);
  expect(engine.getSnapshot().document).toEqual(expected.document);
  expect(reopened.warnings).toEqual(receipt.open.warnings);
  expect(reopened.summary).toEqual(receipt.open.summary);
});
