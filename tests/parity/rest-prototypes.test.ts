import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {expect,it} from "vitest";
import {loadDesignDocument} from "../../src/engine/interchange/load";
import {decodeFigcraft} from "../../src/engine/file-format";

const corpus=unzipSync(readFileSync(new URL("../fixtures/native-rest-prototypes.zip",import.meta.url)));
it.each(Object.keys(corpus).filter(n=>n.endsWith(".json")))("imports prototype properties against native file.open and file.saveAs for %s",async filename=>{
  const prefix=filename.slice(0,-5),{decoded}=await loadDesignDocument(corpus[filename],undefined,()=>{},undefined,filename);
  const native=await decodeFigcraft(corpus[prefix+".figcraft"]);
  expect(decoded.issues).toEqual(JSON.parse(new TextDecoder().decode(corpus[prefix+".receipt"])).warnings);
  expect(decoded.document).toEqual(native.document);
  expect(decoded.nextId).toBe(native.nextId);
});

const transfers=unzipSync(readFileSync(new URL("../fixtures/native-prototype-transfers.zip",import.meta.url)));
it.each(["copy","append","u64"])("preserves native prototype references and raw action values during %s",async scenario=>{
  const {EditorEngine}=await import("../../src/engine/editor");
  const engine=new EditorEngine();
  const file=(bytes:Uint8Array)=>({name:"Scenario.figcraft",data:Buffer.from(bytes).toString("base64")});
  if (scenario==="append") {
    const existing=readFileSync(new URL("../fixtures/native-swap-forest.figcraft",import.meta.url));
    await engine.executeAsync("file.open",file(existing));
    await engine.executeAsync("file.import",file(transfers[scenario+".input"]));
  } else {
    await engine.executeAsync("file.open",file(transfers[scenario+".input"]));
    if (scenario==="copy") engine.execute("page.duplicate",{id:2});
  }
  const actual=await decodeFigcraft(await engine.nativeSnapshot());
  const native=await decodeFigcraft(transfers[scenario+".figcraft"]);
  expect(actual.document).toEqual(native.document);
  expect(actual.nextId).toBe(native.nextId);
});
