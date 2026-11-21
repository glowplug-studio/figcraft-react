import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {loadDesignDocument} from "../../src/engine/interchange/load";
import {writeFigDocument} from "../../src/engine/interchange/fig/write-document";
import native from "../fixtures/native-rest-documents.json";
import adjustments from "../fixtures/native-fig-image-adjustments.json";
import textPaths from "../fixtures/native-fig-text-path-export.json";
import lists from "../fixtures/native-lists.json";
import type {Document} from "../../src/engine/document";

const expected=unzipSync(readFileSync(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
// Native's export left image adjustments out when the corpus was written and writes them at bad07e44 (upstream #2297).
// The one drawing of the corpus that has them is compared with its export and reopening observed at that revision
// (tests/fixtures/native-fig-image-adjustments.provenance.md).
// The same holds for list spacing, hanging punctuation, hanging lists and vertical trim (upstream #2305;
// tests/fixtures/native-lists.provenance.md).
const repinned=new Map([...adjustments.repinned,...lists.repinned].map(c=>[c.name,c]));
it.each(native)("reopens browser-written Fig output against the native writer for $name",async input=>{
  const name=input.name.replaceAll(" ","-"),again=repinned.get(input.name);
  const source=await decodeFigcraft(Uint8Array.from(Buffer.from(input.archive,"base64")));
  const file=await writeFigDocument(source.document,()=>{});
  const result=await loadDesignDocument(file.blob,undefined,()=>{},undefined,"supplied.fig");
  const reference=await decodeFigcraft(again ? Uint8Array.from(Buffer.from(again.reopened,"base64")) : expected[name+"-zip.figcraft"]);
  if (again) expect(file.warnings).toEqual(again.exportWarnings);
  expect(result.decoded.issues).toEqual(again ? again.openWarnings : JSON.parse(new TextDecoder().decode(expected[name+"-zip.receipt.json"])).warnings);
  expect(result.decoded.document).toEqual(reference.document);
  expect(result.decoded.nextId).toBe(reference.nextId);
});

it("file.export writes the whole Fig document and leaves its selection and save revision intact",async()=>{
  const {EditorEngine}=await import("../../src/engine/editor");
  const e=new EditorEngine();
  e.execute("shape.rectangle");
  e.execute("shape.ellipse");
  const before=e.getSnapshot(),result=await e.executeAsync("file.export",{format:"FIG",ids:[],scale:2});
  expect(result).toMatchObject({format:"fig",warnings:[]});
  expect(e.getSnapshot()).toBe(before);
  const opened=await new EditorEngine().executeAsync("file.open",{data:result.data,name:"Export.fig"});
  expect(opened.summary).toMatchObject({layers:2,pages:1});
  await expect(e.executeAsync("file.export",{format:"fig",path:"output.fig"})).rejects.toThrow("browser download");
  const running=e.executeAsync("file.export",{format:"fig"});
  e.setEditable(false);
  await expect(running).rejects.toThrow("cancelled");
  await expect(e.executeAsync("file.export",{format:"fig"})).rejects.toThrow("Sign in");
});

const extra=unzipSync(readFileSync(new URL("../fixtures/native-fig-export.zip",import.meta.url)));
const components=unzipSync(readFileSync(new URL("../fixtures/native-fig-components.zip",import.meta.url)));
const texts=unzipSync(readFileSync(new URL("../fixtures/native-fig-text.zip",import.meta.url)));
// Native's export wrote text on a path as plain text when the corpus was written and writes it on its path at bad07e44
// (upstream #2323). The six drawings it now writes that way are compared with their export and reopening observed at
// that revision (tests/fixtures/native-fig-text-path-export.provenance.md). A path's start comes back through a 32-bit
// parameter and a measured length, so it is compared to a millionth.
const onPath=new Map(textPaths.repinned.map(c=>[c.name,c]));
function startsApart(document:Document) {
  const nodes={...document.nodes},starts:(number|undefined)[]=[];
  for (const node of Object.values(document.nodes)) {
    if (node.kind!=="text") continue;
    starts.push(node.text.path?.start);
    if (node.text.path) nodes[node.id]={...node,text:{...node.text,path:{...node.text.path,start:0}}};
  }
  return {starts,document:{...document,nodes}};
}
it.each(Object.keys(extra).filter(k=>k.endsWith(".json")).map(k=>k.slice(0,-5)))("matches native Fig re-export for %s",async name=>{
  const [family,key]=name.split("/"),again=onPath.get(name);
  const input=family==="strokes" ? extra[name+".source"] : (family==="text" ? texts : components)[key+".figcraft"];
  const {document}=await decodeFigcraft(input);
  const file=await writeFigDocument(document,()=>{});
  const receipt=again ?? JSON.parse(new TextDecoder().decode(extra[name+".json"]));
  expect(file.warnings).toEqual(receipt.exportWarnings);
  const {decoded}=await loadDesignDocument(file.blob,undefined,()=>{},undefined,"Same.fig");
  expect(decoded.issues).toEqual(receipt.openWarnings);
  const native=await decodeFigcraft(again ? Uint8Array.from(Buffer.from(again.reopened,"base64")) : extra[name+".figcraft"]);
  if (again) {
    const mine=startsApart(decoded.document),theirs=startsApart(native.document);
    expect(mine.document).toEqual(theirs.document);
    expect(mine.starts.length).toBe(theirs.starts.length);
    for (const [i,start] of theirs.starts.entries()) {
      if (start===undefined) expect(mine.starts[i]).toBeUndefined(); else expect(mine.starts[i]).toBeCloseTo(start,6);
    }
  } else expect(decoded.document).toEqual(native.document);
  expect(decoded.nextId).toEqual(native.nextId);
});
