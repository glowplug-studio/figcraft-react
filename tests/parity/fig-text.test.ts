import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "fflate";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {loadDesignDocument} from "../../src/engine/interchange/load";

const corpus=unzipSync(readFileSync(new URL("../fixtures/native-fig-text.zip",import.meta.url)));
it.each(Object.keys(corpus).filter(k=>k.endsWith(".fig")))("opens Fig text geometry and native wrap offsets for %s",async file=>{
  const name=file.slice(0,-4);
  const {decoded}=await loadDesignDocument(corpus[file],undefined,()=>{},undefined,file);
  const native=await decodeFigcraft(corpus[name+".figcraft"]);
  expect(decoded.nextId).toBe(native.nextId);
  expect(decoded.issues).toEqual(JSON.parse(strFromU8(corpus[name+".receipt.json"])).warnings);
  if (name==="stretched cubic") {
    const node=native.document.nodes["3"];
    if (node.kind!=="text" || !node.text.path) throw new Error("Missing native text path");
    const path={...node.text.path,start:expect.closeTo(node.text.path.start,12)};
    expect(decoded.document).toEqual({...native.document,nodes:{...native.document.nodes,"3":{...node,text:{...node.text,path}}}});
  } else expect(decoded.document).toEqual(native.document);
});
