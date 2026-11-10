import {readFileSync} from "node:fs";
import {inflateRawSync} from "node:zlib";
import {strFromU8,unzipSync} from "fflate";
import {expect,it} from "vitest";
import {writeKiwiSchema,writeKiwiMessage} from "../../src/engine/interchange/fig/encode";
import {readKiwiSchema,readKiwiMessage} from "../../src/engine/interchange/fig/kiwi";
import {writeFigCanvas,writeFigArchive} from "../../src/engine/interchange/fig/write-archive";
import {decodeFigCanvas} from "../../src/engine/interchange/fig/canvas";

const files=unzipSync(readFileSync(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
function chunks(canvas:Uint8Array) {
  const dir=new DataView(canvas.buffer,canvas.byteOffset,canvas.byteLength);
  const length=dir.getUint32(12,true);
  return [inflateRawSync(canvas.subarray(16,16+length)),inflateRawSync(canvas.subarray(20+length))].map(v=>Uint8Array.from(v));
}
it.each(Object.keys(files).filter(k=>k.endsWith(".fig")))("encodes the native Kiwi schema and message byte for byte for %s",name=>{
  const [schemaBytes,body]=chunks(unzipSync(files[name])["canvas.fig"]),schema=readKiwiSchema(schemaBytes);
  expect(writeKiwiSchema(schema)).toEqual(schemaBytes);
  const message=readKiwiMessage(schema,body,2000000);
  expect(writeKiwiMessage(schema,message)).toEqual(body);
});
it("writes a versioned Fig ZIP with an independently readable canvas, original image and thumbnail dimensions",async()=>{
  const [schemaBytes,body]=chunks(unzipSync(files["primitives.fig"])["canvas.fig"]);
  const schema=readKiwiSchema(schemaBytes),message=readKiwiMessage(schema,body,2000000);
  const canvas=await writeFigCanvas(schema,message),thumb=new Uint8Array(24);
  const header=new DataView(thumb.buffer);header.setUint32(16,320);header.setUint32(20,180);
  const background={r:1,g:0.25,b:0.5,a:1},image=Uint8Array.of(13,17,42);
  const zip=await writeFigArchive(canvas,"Design",background,new Map([["feed",new Blob([image])]]),new Blob([thumb]));
  const result=unzipSync(new Uint8Array(await zip.arrayBuffer()));
  expect(Object.keys(result)).toEqual(["canvas.fig","thumbnail.png","meta.json","images/feed"]);
  expect(result["images/feed"]).toEqual(image);
  expect(JSON.parse(strFromU8(result["meta.json"]))).toEqual({file_name:"Design",client_meta:{background_color:background,thumbnail_size:{width:320,height:180}}});
  expect(await decodeFigCanvas(Uint8Array.from(result["canvas.fig"]),canvas.size)).toEqual(message);
});
