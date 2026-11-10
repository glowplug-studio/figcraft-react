import {readFile} from "node:fs/promises";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {EditorEngine} from "../../src/engine/editor";
import cases from "../fixtures/native-page-imports.json";

const load=async(name:string)=>({name:name+".figcraft",data:(await readFile(new URL("../fixtures/"+name+".figcraft",import.meta.url))).toString("base64")});

it.each(cases)("matches the native page-import transaction for $name",async entry=>{
  const engine=new EditorEngine();
  if (entry.destination) await engine.executeAsync("file.open",await load(entry.destination));
  for (const [i,name] of entry.sources.entries()) {
    const result=await engine.executeAsync("file.import",await load(name));
    expect(result).toEqual(entry.imported[i]);
  }
  const {document:doc,nextId}=await decodeFigcraft(await engine.nativeSnapshot());
  const expected=await decodeFigcraft(Uint8Array.from(Buffer.from(entry.archive,"base64")));
  expect(nextId).toBe(expected.nextId);
  expect(doc.pages).toEqual(expected.document.pages);
  expect(doc.currentPage).toBe(expected.document.currentPage);
  expect(doc.nodes).toEqual(expected.document.nodes);
  expect(doc.styles ?? []).toEqual(expected.document.styles ?? []);
  expect(doc.variables).toEqual(expected.document.variables);
  expect(doc.libraryStore).toEqual(expected.document.libraryStore);
  expect(doc.libraryLinks ?? []).toEqual(expected.document.libraryLinks ?? []);
  expect(doc.libraryRecords).toEqual(expected.document.libraryRecords);
  expect(Object.keys(doc.images ?? {}).sort()).toEqual(Object.keys(expected.document.images ?? {}).sort());
});

it("keeps the active drawing and history intact on invalid, signed-out and superseded page imports",async()=>{
  const e=new EditorEngine(),input=await load("native-swap-forest");
  e.execute("shape.rectangle",{name:"Local"});
  const before=e.getSnapshot(),undo=e.getUndoDepth();
  await expect(e.executeAsync("file.import",{...input,variables:{meta:{}}})).rejects.toThrow(/variables/);
  await expect(e.executeAsync("file.import",{...input,data:"bm90IGFuIGFyY2hpdmU="})).rejects.toThrow();
  expect(e.getSnapshot().document).toBe(before.document);
  expect(e.getUndoDepth()).toBe(undo);
  const pending=e.executeAsync("file.import",input);
  e.cancelPendingFiles();
  await expect(pending).rejects.toThrow(/cancelled/);
  expect(e.getSnapshot().document).toBe(before.document);
  expect(e.getUndoDepth()).toBe(undo);
  e.setEditable(false);
  await expect(e.executeAsync("file.import",input)).rejects.toThrow(/Sign in/);
});
