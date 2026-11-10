import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {expect,it} from "vitest";
import {imageHash} from "../../src/engine/image-resource";
import {decodeFigcraft} from "../../src/engine/file-format";
import {loadDesignDocument} from "../../src/engine/interchange/load";

const corpus={...unzipSync(readFileSync(new URL("../fixtures/native-sketch-files.zip",import.meta.url))),
  ...unzipSync(readFileSync(new URL("../fixtures/native-sketch-edge-files.zip",import.meta.url)))};
const files=Object.keys(corpus).filter(key=>key.endsWith(".sketch"));
it.each(files)("opens Sketch input against native file.open and file.saveAs for %s",async filename=>{
  const stem=filename.slice(0,-7);
  const receipt=JSON.parse(new TextDecoder().decode(corpus[stem+".json"]));
  const opening=loadDesignDocument(corpus[filename],undefined,()=>{},undefined,"Original.sketch");
  if (receipt.error) {await expect(opening).rejects.toThrow(receipt.error);return;}
  const {external,decoded}=await opening;
  expect(external).toBe(true);
  expect(decoded.issues ?? []).toEqual(receipt.warnings ?? []);
  const reference=await decodeFigcraft(corpus[stem+".figcraft"]);
  const {images:actualImages,...actualDocument}=decoded.document;
  const {images:expectedImages,...expectedDocument}=reference.document;
  expect(actualDocument).toEqual(expectedDocument);
  expect(Object.keys(actualImages ?? {}).sort()).toEqual(Object.keys(expectedImages ?? {}).sort());
  expect(decoded.nextId).toEqual(reference.nextId);
  for (const [id,image] of Object.entries(reference.document.images ?? {})) {
    const actual=decoded.document.images?.[id];
    if (!actual) throw new Error("Missing image "+id);
    const {bytes,digest,...info}=actual, {bytes:expectedBytes,digest:expectedDigest,...expectedInfo}=image;
    expect(digest ?? await imageHash(bytes)).toEqual(expectedDigest);
    expect(info).toEqual(expectedInfo);
    expect(bytes.type).toEqual(expectedBytes.type);
    expect(await bytes.arrayBuffer()).toEqual(await expectedBytes.arrayBuffer());
  }
});

it("bounds repeated Sketch symbol expansion and retains the remaining page",async()=>{
  const {sketchScene}=await import("../../src/engine/interchange/sketch/scene");
  const master={_class:"symbolMaster",symbolID:"S",do_objectID:"M",name:"Main",layers:[{_class:"rectangle",do_objectID:"R",name:"Inside"}]};
  const copies=Array.from({length:200},(_,i)=>({_class:"symbolInstance",symbolID:"S",do_objectID:"I"+i,name:"Copy "+i}));
  const archive={document:{},pages:[{id:"P",page:{layers:[master,...copies,{_class:"oval",name:"After"}]}}],version:139,warnings:[],image:async()=>undefined};
  const opened=await sketchScene(archive,"Budget",1000,()=>{},undefined,160);
  expect(opened.issues).toEqual(["the file's symbols expand to more than the import handles; the instances past that were imported as empty frames"]);
  const nodes=Object.values(opened.document.nodes);
  expect(nodes.some(n=>n.kind==="instance" && n.children.length===1)).toBe(true);
  expect(nodes.some(n=>n.kind==="frame" && !n.children.length && n.name==="Copy 199")).toBe(true);
  expect(nodes.some(n=>n.kind==="ellipse" && n.name==="After")).toBe(true);
});

it("applies the native horizontal trak table and discards incomplete or unordered tracks",async()=>{
  const {fontTracking,normalFontTrack}=await import("../../src/engine/font-tables");
  const table=new DataView(new ArrayBuffer(46));
  table.setUint32(0,65536);table.setUint16(6,12);table.setUint16(12,1);table.setUint16(14,3);
  table.setUint32(16,28);table.setUint16(24,256);table.setUint16(26,40);
  for (const [i,size] of [10,20,40].entries()) table.setInt32(28+i*4,size*65536);
  for (const [i,units] of [-8,0,16].entries()) table.setInt16(40+i*2,units);
  const track=normalFontTrack(table);
  expect(track).toEqual([[10,-8],[20,0],[40,16]]);
  expect([5,15,30,80].map(n=>fontTracking(track,n,2048))).toEqual([-40,-60,240,1280].map(n=>n/2048));
  expect(normalFontTrack(new DataView(table.buffer,0,44))).toEqual([]);
  table.setInt32(32,10*65536);
  expect(normalFontTrack(table)).toEqual([]);
  table.setUint32(16,0xfffffffc);
  expect(normalFontTrack(table)).toEqual([]);
});
