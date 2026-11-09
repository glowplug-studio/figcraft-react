import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";
import { readVariables, resolveVariable } from "../../src/engine/variables";

const bytes=readFileSync(new URL("../fixtures/native-variables.json",import.meta.url));
const fixture=JSON.parse(bytes.toString("utf8"));
const cid="VariableCollectionId:1";

it("round-trips native variables and expressions, including code syntax and file profile conversion",async()=>{
  const e=new EditorEngine();
  await e.executeAsync("file.open",{data:base64Bytes(bytes)});
  const catalogue=e.execute("variable.list");
  expect(catalogue).toEqual(fixture.variables);
  expect(await e.executeAsync("variable.list")).toEqual(catalogue);
  expect(JSON.parse(strFromU8(unzipSync(await e.nativeSnapshot())["document.json"])).variables).toEqual(fixture.variables);
  e.execute("file.colorProfile",{profile:"displayP3",convert:true});
  const p3=e.execute("variable.list");
  const converted=p3.variables[0].values[cid+"/mode1"];
  expect(converted.type==="color" && converted.value.r).toBeCloseTo(0.7046054005622864,6);
  const expression=p3.variables[2].values[cid+"/mode2"];
  expect(expression.type==="colorMix" && "literal" in expression.value.from && expression.value.from.literal.g).toBeCloseTo(0.8979002833366394,6);
  expect(p3.variables[2].values[cid+"/mode2"]).not.toEqual(catalogue.variables[2].values[cid+"/mode2"]);
  expect(p3.variables[1].values).toEqual(catalogue.variables[1].values);
  e.execute("edit.undo"); expect(e.execute("variable.list")).toEqual(catalogue);
});

it("resolves aliases and colour expressions using mode ids and native f32 channel arithmetic",()=>{
  const vars=readVariables(fixture.variables), dark={[cid]:cid+"/mode2"};
  expect(resolveVariable(vars,"Highlight",dark)).toBeUndefined();
  expect(resolveVariable(vars,"VariableID:3",dark)).toEqual({type:"color",value:{
    a:0.501960813999176,b:0.6590588688850403,g:0.6667842864990234,r:0.717960774898529}});
  const light=resolveVariable(vars,"VariableID:3");
  expect(light).toMatchObject({type:"color",value:{a:0.5167279243469238}});
  expect(resolveVariable(vars,"VariableID:3",{[cid]:"Dark"})).toEqual(light);
  expect(resolveVariable(vars,"VariableID:4",dark)).toEqual({type:"string",value:"次へ"});
});

it("limits distinct variable reads, recognises cycles and distinguishes missing and inherited map keys",()=>{
  const collections=[{id:"C",name:"C",modes:[{id:"m",name:"m"}]}];
  const series=Array.from({length:33},(_,i)=>({id:String(i),name:String(i),collection:"C",resolvedType:"number",
    values:{m:i===32 ? {type:"number",value:41} : {type:"alias",value:String(i+1)}}}));
  const vars=readVariables({collections,variables:series});
  expect(resolveVariable(vars,"0")).toBeUndefined();
  expect(resolveVariable(vars,"1")).toEqual({type:"number",value:41});
  const cycle=readVariables({collections,variables:[{...series[32],values:{m:{type:"alias",value:"32"}}}]});
  expect(resolveVariable(cycle,"32")).toBeUndefined();
  expect(resolveVariable(vars,"__proto__")).toBeUndefined();
});

it("propagates parent modes through two collection extensions and preserves catalogue history",async()=>{
  const e=new EditorEngine();
  await e.executeAsync("file.open",{data:base64Bytes(bytes)});
  const capture=e.getSnapshot().document;
  const a=e.execute("variable.extendCollection",{collection:"Theme"}).id;
  const b=e.execute("variable.extendCollection",{collection:a}).id;
  const m=e.execute("variable.addMode",{collection:cid,name:"Dusk",from:"Dark"}).id as string;
  e.execute("variable.moveMode",{collection:cid,mode:m,to:0});
  let vars=e.execute("variable.list");
  expect(vars.collections.filter(c=>[a,b].includes(c.id)).map(c=>c.modes[0].id)).toEqual([m,m]);
  expect(vars.variables.filter(v=>v.collection===b)).toHaveLength(5);
  const deepest=vars.variables.find(v=>v.collection===b && v.name==="Highlight")!;
  expect(resolveVariable(vars,deepest.id)).toEqual(resolveVariable(vars,"VariableID:3",{[cid]:m}));
  expect(()=>e.execute("variable.removeMode",{collection:a,mode:m})).toThrow();
  e.execute("variable.renameMode",{collection:cid,mode:m,name:"Evening"});
  e.execute("variable.removeMode",{collection:cid,mode:"Evening"});
  vars=e.execute("variable.list");
  expect(vars.variables.every(v=>!Object.hasOwn(v.values,m))).toBe(true);
  expect(vars.collections.every(c=>c.modes.every(mode=>mode.id!==m))).toBe(true);
  for(let i=0;i<6;i++) e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(capture);
});

it("validates references across modes and preserves resolved values when an operand is deleted",async()=>{
  const e=new EditorEngine();
  await e.executeAsync("file.open",{data:base64Bytes(bytes)});
  const initial=e.getSnapshot().document;
  const create=(name:string,value:unknown)=>String(e.execute("variable.create",{collection:cid,name,type:"color",value}).id);
  const mix=create("Signal",{mix:{from:{variable:"Accent"},to:{literal:"#ccff00"},t:.25}});
  const direct=create("Direct",{alias:"Accent"});
  for (const value of [{alias:mix},{mix:{from:{variable:"Signal"},to:{literal:"red"},t:.7}},
    {alpha:{variable:"Base",opacity:1.1}},{alpha:{variable:"Spacing",opacity:.5}},{mix:{from:"Base",to:"red",t:.5}}]) {
    const before=e.getSnapshot().document;
    expect(()=>e.execute("variable.set",{variable:"Accent",mode:"Dark",value})).toThrow();
    expect(e.getSnapshot().document).toBe(before);
  }
  const modes=[cid+"/mode1",cid+"/mode2"], before=e.execute("variable.list");
  const wanted=modes.map(m=>[mix,direct].map(id=>resolveVariable(before,id,{[cid]:m})));
  e.execute("variable.delete",{variable:"Accent"});
  const after=e.execute("variable.list");
  for (const [i,m] of modes.entries()) expect([mix,direct].map(id=>after.variables.find(v=>v.id===id)?.values[m])).toEqual(wanted[i]);
  e.execute("edit.undo");e.execute("edit.undo");e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(initial);
});

it("copies inherited variables, resets a single mode override and validates metadata atomically", async()=>{
  const e=new EditorEngine();
  await e.executeAsync("file.open",{data:base64Bytes(bytes)});
  const c=String(e.execute("variable.extendCollection",{collection:"Theme"}).id);
  const list=()=>e.execute("variable.list").variables;
  const inherited=list().find(v=>v.collection===c && v.name==="Action")!;
  e.execute("variable.set",{variable:inherited.id,mode:"Dark",value:"Stop"});
  const copy=e.execute("variable.duplicate",{variable:inherited.id}).id;
  expect(list().find(v=>v.id===copy)?.extends).toBeUndefined();
  e.execute("variable.resetOverride",{variable:inherited.id,mode:"Dark"});
  expect(list().find(v=>v.id===inherited.id)?.values[cid+"/mode2"]).toEqual({type:"string",value:"次へ"});
  expect(list().find(v=>v.id===copy)?.values[cid+"/mode2"]).toEqual({type:"string",value:"Stop"});
  e.execute("variable.update",{variable:copy,name:" Site / Action ",description:"Navigation",hiddenFromPublishing:true,scopes:["TEXT_CONTENT"],codeSyntax:{WEB:" --action "}});
  expect(list().find(v=>v.id===copy)).toMatchObject({name:"Site/Action",description:"Navigation",codeSyntax:{WEB:"--action"},scopes:["TEXT_CONTENT"],hiddenFromPublishing:true});
  const before=e.getSnapshot().document;
  expect(()=>e.execute("variable.update",{variable:copy,name:"Edited",codeSyntax:{web:"no"}})).toThrow();
  expect(e.getSnapshot().document).toBe(before);
  e.execute("variable.deleteCollection",{collection:cid});
  expect(list().find(v=>v.id===inherited.id)?.extends).toBeUndefined();
});
