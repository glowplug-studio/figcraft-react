import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft} from "../../src/engine/file-format";
import {base64Bytes} from "../../src/engine/recovery";
import expected from "../fixtures/native-linked-variables.json";

function publication(v2=false) {
  const file="../fixtures/native-published-library"+(v2 ? "-v2" : "")+".figcraft";
  return new File([readFileSync(new URL(file,import.meta.url))],"Kit.figcraft");
}
async function consumer() {
  const engine=new EditorEngine(),{id:library}=await engine.pickLibrary(publication());
  const command=(cmd:string,p:Record<string,unknown>)=>engine.execute("library."+cmd,{library,...p});
  engine.execute("node.create",{type:"rectangle",name:"Consumer",width:100,height:50});
  engine.execute("variable.createCollection",{name:"Local"});
  engine.execute("variable.create",{name:"Local fill",type:"color",collection:"Local"});
  command("importVariable",{variable:"Highlight"});
  command("bindVariable",{variable:"Accent",field:"fill",id:2});
  command("aliasVariable",{alias:"Base",variable:"Local fill"});
  command("setVariableMode",{collection:"Theme",mode:"Dark",id:2});
  command("extendCollection",{collection:"Density",name:"Extended"});
  return {engine,library:String(library),command};
}
it("matches native linked alias closure, stable copy IDs, extension updates and pruning across reload",async()=>{
  const {engine,library}=await consumer();
  await engine.pickLibrary(publication(true));
  expect(engine.execute("library.updates")).toEqual(expected.pending);
  const prior=engine.getSnapshot().document;
  expect(engine.execute("library.acceptUpdates")).toEqual(expected.accepted);
  expect(engine.execute("variable.list")).toEqual(expected.updated);
  engine.execute("edit.undo");expect(engine.getSnapshot().document).toBe(prior);
  engine.execute("edit.redo");
  expect(engine.execute("library.updates")).toEqual({count:0,libraries:[],errors:[]});
  engine.execute("library.remove",{id:library});
  expect(engine.execute("variable.list")).toEqual(expected.removed);
  const decoded=await decodeFigcraft(await engine.nativeSnapshot());
  expect(decoded.document.libraryLinks).toBeUndefined();
  expect(decoded.document.libraryRecords?.variables.length).toBeGreaterThan(0);
  const reopened=new EditorEngine();await reopened.executeAsync("file.open",{data:base64Bytes(await engine.nativeSnapshot())});
  expect(reopened.execute("variable.list")).toEqual(expected.removed);
  expect(()=>reopened.execute("variable.set",{variable:library+":VariableID:1",value:"#fed"})).toThrow("can't be edited");
});
it("refuses edits of linked copies atomically and only exports local collections by default",async()=>{
  const {engine,library,command}=await consumer(),cid=library+":VariableCollectionId:1",vid=library+":VariableID:1";
  const before=engine.getSnapshot().document,depth=engine.getUndoDepth();
  for (const [cmd,p] of [
    ["variable.set",{variable:vid,value:"#fac"}],["variable.update",{variable:vid,description:"No"}],
    ["variable.deleteCollection",{collection:cid}],["variable.create",{collection:cid,name:"No",type:"number",value:5}],
    ["variable.duplicate",{variable:vid}],["variable.renameCollection",{collection:cid,name:"No"}]
  ] as const) expect(()=>engine.execute(cmd,p)).toThrow("can't be edited");
  expect(()=>command("bindVariable",{variable:"Size",field:"fill",id:2})).toThrow();
  expect(()=>command("aliasVariable",{variable:"Local fill",alias:"Size"})).toThrow("another type");
  expect(engine.getUndoDepth()).toBe(depth);expect(engine.getSnapshot().document).toBe(before);
  const exported=(p:Record<string,unknown>)=>JSON.parse(String(engine.execute("variable.export",p).text)).meta.variableCollections;
  expect(Object.keys(exported({}))).not.toContain(cid);
  expect(Object.keys(exported({collections:[cid]}))).toEqual([cid]);
  const style=engine.execute("library.list",{assets:true}).publishable as {collections:{id:string}[]};
  expect(style.collections.map(c=>c.id)).not.toContain(cid);
  const incoming=engine.execute("variable.export",{collections:[cid]}).text;
  const imported=engine.execute("variable.import",{variables:incoming});
  expect(imported.collections).toBe(1);
  expect(engine.getSnapshot().document.variables!.collections.find(c=>c.name==="Theme 2")).toBeDefined();
});
it("keeps a local identifier collision and imports newly seen keys into separately numbered copies",async()=>{
  const engine=new EditorEngine(),{id:library}=await engine.pickLibrary(publication());
  const original=await decodeFigcraft(await engine.nativeSnapshot()),cid=library+":VariableCollectionId:1",vid=library+":VariableID:1";
  const doc={...original.document,variables:{collections:[{id:cid,name:"Local",modes:[]}],variables:[{id:vid,name:"Other",collection:cid,
    description:"",resolvedType:"string" as const,values:{}}]}};
  const {encodeFigcraft}=await import("../../src/engine/file-format");
  await engine.executeAsync("file.open",{data:base64Bytes(await encodeFigcraft(doc))});
  expect(engine.execute("library.importVariable",{library,variable:"Base"})).toEqual({variable:vid+"#2"});
  expect(engine.getSnapshot().document.libraryRecords?.collections[0].local).toBe(cid+"#2");
  const depth=engine.getUndoDepth();engine.execute("library.importVariable",{library,variable:"Base"});expect(engine.getUndoDepth()).toBe(depth);
});
