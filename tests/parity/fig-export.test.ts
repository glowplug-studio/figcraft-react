import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {loadDesignDocument} from "../../src/engine/interchange/load";
import {writeFigDocument} from "../../src/engine/interchange/fig/write-document";
import native from "../fixtures/native-rest-documents.json";

const expected=unzipSync(readFileSync(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
it.each(native)("reopens browser-written Fig output against the native writer for $name",async input=>{
  const name=input.name.replaceAll(" ","-");
  const source=await decodeFigcraft(Uint8Array.from(Buffer.from(input.archive,"base64")));
  const file=await writeFigDocument(source.document,()=>{});
  const result=await loadDesignDocument(file.blob,undefined,()=>{},undefined,"supplied.fig");
  const reference=await decodeFigcraft(expected[name+"-zip.figcraft"]);
  expect(result.decoded.issues).toEqual(JSON.parse(new TextDecoder().decode(expected[name+"-zip.receipt.json"])).warnings);
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
it.each(Object.keys(extra).filter(k=>k.endsWith(".json")).map(k=>k.slice(0,-5)))("matches native Fig re-export for %s",async name=>{
  const [family,key]=name.split("/");
  const input=family==="strokes" ? extra[name+".source"] : (family==="text" ? texts : components)[key+".figcraft"];
  const {document}=await decodeFigcraft(input);
  const file=await writeFigDocument(document,()=>{});
  const receipt=JSON.parse(new TextDecoder().decode(extra[name+".json"]));
  expect(file.warnings).toEqual(receipt.exportWarnings);
  const {decoded}=await loadDesignDocument(file.blob,undefined,()=>{},undefined,"Same.fig");
  expect(decoded.issues).toEqual(receipt.openWarnings);
  const native=await decodeFigcraft(extra[name+".figcraft"]);
  expect(decoded.document).toEqual(native.document);
  expect(decoded.nextId).toEqual(native.nextId);
});
