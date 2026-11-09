import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {base64Bytes} from "../../src/engine/recovery";
import exports from "../fixtures/native-variable-exports.json";

async function drawing() {
  const engine=new EditorEngine();
  const bytes=readFileSync(new URL("../fixtures/native-variable-inspectors.json",import.meta.url));
  await engine.executeAsync("file.open",{data:base64Bytes(bytes)});
  return engine;
}

it("exports the four native file texts exactly without changing the document",async()=>{
  const engine=await drawing(),initial=engine.getSnapshot().document,depth=engine.getUndoDepth();
  for (const [format,text] of Object.entries(exports)) expect(engine.execute("variable.export",{format})).toEqual({text});
  expect(engine.execute("variable.export")).toEqual({text:exports.json});
  expect(()=>engine.execute("variable.export",{collections:["Missing"]})).toThrow();
  expect(engine.getSnapshot().document).toBe(initial);
  expect(engine.getUndoDepth()).toBe(depth);
});

it("imports mode values and aliases on one undo step and retains local metadata on repeat",async()=>{
  const engine=new EditorEngine(),initial=engine.getSnapshot().document;
  expect(engine.execute("variable.import",{variables:exports.json})).toEqual({collections:2,variables:12,updated:0,warnings:[]});
  const imported=engine.getSnapshot().document,raw=JSON.parse(exports.json);
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(initial);
  engine.execute("edit.redo");
  expect(engine.getSnapshot().document).toBe(imported);
  raw.meta.variables["VariableID:1"].description="Should remain local";
  expect(engine.execute("variable.import",{variables:raw})).toEqual({collections:0,variables:0,updated:12,warnings:[]});
  expect(engine.getSnapshot().document).toBe(imported);
  expect(()=>engine.execute("variable.import",{variables:"{"})).toThrow();
  expect(engine.getSnapshot().document).toBe(imported);
});

it("rejects a pending variable file when the destination document changes",async()=>{
  const engine=new EditorEngine();
  let finish!:(text:string)=>void;
  class DelayedFile extends Blob {override text(){return new Promise<string>(r=>{finish=r;});}}
  const pending=engine.importVariableFile(new DelayedFile());
  const bytes=readFileSync(new URL("../fixtures/native-character-fills.json",import.meta.url));
  await engine.executeAsync("file.open",{data:base64Bytes(bytes)});
  finish(exports.json);
  await expect(pending).rejects.toThrow("document changed");
  expect(engine.getSnapshot().document.variables).toBeUndefined();
});

it("skips missing references, merges by mode name and reports alias cycles in source order",()=>{
  const engine=new EditorEngine();
  const fields={variableCollectionId:"c",resolvedType:"FLOAT"};
  const alias=(id:string)=>({type:"VARIABLE_ALIAS",id});
  const variables={variableCollections:{c:{name:"Measures",modes:[{name:"First",modeId:"a"},{name:"Second",modeId:"b"}],defaultModeId:"b",
    variableIds:["one","two","bad"]}},variables:{
    one:{...fields,name:"One",valuesByMode:{a:alias("two"),b:4}},
    two:{...fields,name:"Two",valuesByMode:{a:alias("one"),b:7}},
    bad:{...fields,name:"Missing",valuesByMode:{a:alias("absent")}},
  }};
  expect(engine.execute("variable.import",{variables})).toEqual({collections:1,variables:2,updated:0,warnings:[
    "variable aliases to variables that aren't in the variables JSON (or of another type) were skipped",
    "1 of the 3 variables the collections list in `variableIds` weren't imported",
    "`Two`: the alias would refer back to itself",
  ]});
  const data=engine.execute("variable.list");
  expect(data.collections[0].modes.map(m=>m.name)).toEqual(["Second","First"]);
  const [b,a]=data.collections[0].modes;
  expect(data.variables[0].values[a.id]).toEqual({type:"alias",value:data.variables[1].id});
  expect(data.variables[1].values[a.id]).toEqual(data.variables[1].values[b.id]);
});
