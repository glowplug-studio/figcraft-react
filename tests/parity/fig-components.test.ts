import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "fflate";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {loadDesignDocument} from "../../src/engine/interchange/load";

const files=unzipSync(readFileSync(new URL("../fixtures/native-fig-components.zip",import.meta.url)));
it.each(Object.keys(files).filter(k=>k.endsWith(".fig")))("preserves component sources, geometry and warnings for %s",async file=>{
  const name=file.slice(0,-4);
  const {decoded}=await loadDesignDocument(files[file],undefined,()=>{},undefined,file);
  const native=await decodeFigcraft(files[name+".figcraft"]);
  const receipt=JSON.parse(strFromU8(files[name+".receipt.json"]));
  expect(decoded.issues).toEqual(receipt.warnings);
  expect(decoded.nextId).toBe(native.nextId);
  if (name==="negative reflection constraint") {
    // libm and Chromium differ by a few double-precision ULPs in the rotated fit.
    const node=native.document.nodes["6"];
    if (node.kind!=="rectangle") throw new Error("Missing reflected rectangle in the native fixture");
    const approx=(value:number)=>expect.closeTo(value,11);
    const equivalent={...node,x:approx(node.x),y:approx(node.y),width:approx(node.width),transform:node.transform!.map(approx)};
    expect(decoded.document).toEqual({...native.document,nodes:{...native.document.nodes,"6":equivalent}});
  } else expect(decoded.document).toEqual(native.document);
});
