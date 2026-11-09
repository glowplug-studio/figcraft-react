import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft,encodeFigcraft} from "../../src/engine/file-format";
import {base64Bytes} from "../../src/engine/recovery";

const fixture=(name:string)=>readFileSync(new URL("../fixtures/native-linked-style-"+name+".figcraft",import.meta.url));
function published(version:number) {return new File([fixture("library-v"+version)],"Design Kit.figcraft");}
it("matches native linked image, paint, stroke, grid, effect and text records after an update and offline save",async()=>{
  const engine=new EditorEngine(),{id:library}=await engine.pickLibrary(published(1));
  engine.execute("node.create",{type:"frame"});
  await engine.executeAsync("node.create",{type:"text",props:{characters:"A caption"}});
  for (const [id,style,target] of [[2,"Surface","stroke"],[2,"Pattern"],[2,"Shadow"],[2,"Columns"],[3,"Caption"]] as const)
    engine.execute("library.applyStyle",{library,id,style,target});
  const doc=engine.getSnapshot().document;
  expect(doc.libraryRecords?.styles).toHaveLength(5);
  expect(doc.libraryRecords?.variables).toHaveLength(1);
  expect(Object.keys(doc.images ?? {})).toHaveLength(1);
  expect(engine.execute("library.list",{assets:true}).publishable).toMatchObject({styles:[],collections:[]});
  for (const cmd of ["delete","duplicate","update","bind","move"]) expect(()=>engine.execute("style."+cmd,{
    style:library+":S:1",styles:[library+":S:1"]
  })).toThrow("can't be edited");
  expect(engine.getSnapshot().document).toBe(doc);
  await engine.pickLibrary(published(2));
  expect(engine.execute("library.updates")).toMatchObject({count:2,libraries:[{styles:[{key:"S:3"},{key:"S:4"}]}]});
  expect(engine.execute("library.acceptUpdates")).toMatchObject({styles:2,variables:0});
  engine.execute("library.remove",{id:library});
  const native=await decodeFigcraft(fixture("consumer")),actual=await decodeFigcraft(await engine.nativeSnapshot());
  expect(actual.document).toEqual(native.document);
  const reopened=new EditorEngine();
  await reopened.executeAsync("file.open",{data:base64Bytes(await engine.nativeSnapshot())});
  expect(()=>reopened.execute("style.delete",{style:library+":S:5"})).toThrow("can't be edited");
});
it("imports typography into the live character range as one edit and prunes detached copies",async()=>{
  const engine=new EditorEngine(),{id:library}=await engine.pickLibrary(published(1));
  await engine.executeAsync("text.create",{text:"a🙂b"});
  const depth=engine.getUndoDepth(),before=engine.getSnapshot().document;
  const edit=engine.beginTextEdit({id:"2"});edit.select(1,2);
  const result=engine.execute("library.applyStyle",{library,style:"Caption",ids:[2]});
  expect(edit.node().text.runs).toMatchObject([{start:1,end:2,style:{styleId:result.style}}]);
  edit.finish();expect(engine.getUndoDepth()).toBe(depth+1);
  engine.execute("edit.undo");expect(engine.getSnapshot().document).toBe(before);
  engine.execute("edit.redo");await engine.pickLibrary(published(2));engine.execute("library.acceptUpdates");
  expect(engine.execute("node.get",{id:2,fields:["styledRuns"]})).toMatchObject({styledRuns:[{start:1,end:2,style:{font_size:32}}]});
  engine.execute("style.detach",{id:2,which:"text"});
  engine.execute("library.remove",{id:library});
  expect(engine.getSnapshot().document.libraryRecords).toBeUndefined();
  expect(engine.getSnapshot().document.styles).toBeUndefined();
});
it("allocates collision-free IDs and leaves the document untouched on refusal",async()=>{
  const e=new EditorEngine(),{id:library}=await e.pickLibrary(published(1));
  const doc=e.getSnapshot().document,id=library+":S:5";
  await e.executeAsync("file.open",{data:base64Bytes(await encodeFigcraft({...doc,styles:[{id,type:"paint",name:"Mine",description:"",paints:[]}]}))});
  e.execute("node.create",{type:"rectangle"});
  const before=e.getSnapshot().document;
  expect(()=>e.execute("library.applyStyle",{library,style:"Caption",id:2})).toThrow("text layers");
  expect(e.getSnapshot().document).toBe(before);
  expect(e.execute("library.applyStyle",{library,style:"Pattern",id:2})).toEqual({style:id+"#2"});
  e.execute("style.detach",{which:"fill",id:2});
  e.execute("library.remove",{id:library});
  expect(e.getSnapshot().document.styles?.map(s=>s.id)).toEqual([id]);
  expect(Object.keys(e.getSnapshot().document.images ?? {})).toHaveLength(1);
});
