import { expect,it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { fontGeneration } from "../../src/engine/font-generation";
import reference from "../fixtures/font-catalogue.json" with {type:"json"};
import { renamedFont, fontCollection } from "../support/renamedFont";

it("queries bundled families, ordered styles, GSUB and named variable instances without editing",async ()=>{
  const e=new EditorEngine(), before=e.getSnapshot();
  expect(await e.executeAsync("text.fonts")).toEqual(["Inter","Noto Sans Georgian"]);
  expect(e.execute("text.fonts",{family:"Inter"})).toEqual(["Regular","Italic","SemiBold","Bold"]);
  const params={family:"Noto Sans Georgian",axes:true};
  expect(e.execute("text.fonts",params)).toMatchObject({family:params.family,axes:[
    {tag:"wght",name:"Weight",min:100,default:400,max:900,hidden:false},
    {tag:"wdth",name:"Width",min:62.5,default:100,max:100,hidden:false},
  ],instances:expect.arrayContaining([{name:"Bold",variations:{wght:700,wdth:100}}])});
  const features=e.execute("text.fonts",{family:"Inter",features:true,axes:true});
  expect(features).toEqual(reference.interFeatures);
  expect(e.execute("text.fonts",params)).toEqual(reference.georgianAxes);
  expect(e.execute("text.fonts",{family:"Missing",axes:true})).toEqual({family:"Inter",axes:[],instances:[]});
  expect(e.execute("text.fonts",{family:"Missing",features:true})).toEqual(features);
  expect(e.execute("text.fonts",{family:"Missing"})).toEqual([]);
  expect(e.execute("text.rescanFonts")).toEqual({added:[],refitted:[]});
  expect(e.execute("text.fonts",null)).toEqual(["Inter","Noto Sans Georgian"]);
  for (const command of ["text.fonts","text.rescanFonts","text.loadFont"]) {
    await expect(e.executeAsync(command,{axess:true})).rejects.toThrow(/Unknown/);
  }
  expect(e.getSnapshot()).toBe(before);
});

it("imports a file once, refits only matching base or range families and keeps undo document-scoped",async ()=>{
  const e=new EditorEngine(), bytes=await renamedFont();
  const ids:string[]=[];
  for (const name of ["Base","Range","Elsewhere","Fixed"]) {
    ids.push(String((await e.executeAsync("text.create",{text:"Abc",name,x:0,y:0})).id));
  }
  e.execute("node.set",{id:ids[0],props:{fontFamily:"Proof"}});
  e.execute("text.style",{id:ids[1],start:1,end:2,fontFamily:"PROOF"});
  e.execute("node.set",{id:ids[3],props:{fontFamily:"Proof",textAutoResize:"none"}});
  const doc=e.getSnapshot().document,nodes={...doc.nodes};
  for (const id of ids) {
    const node=nodes[id];
    if (node.kind==="text") nodes[id]={...node,width:999};
  }
  await e.executeAsync("file.open",{data:Buffer.from(await encodeFigcraft({...doc,nodes})).toString("base64")});
  const stale=e.getSnapshot().document;
  const generation=fontGeneration(), data="data:font/ttf;base64,"+bytes.toString("base64");
  const results=await Promise.all([e.executeAsync("text.loadFont",{data}),e.executeAsync("text.loadFont",{path:new Blob([new Uint8Array(bytes)])})]);
  expect(results.every(r=>JSON.stringify(r.families)==='["Proof"]')).toBe(true);
  expect(results.map(r=>r.refitted)).toContainEqual(ids.slice(0,2).map(Number));
  expect(results.map(r=>r.refitted)).toContainEqual([]);
  expect(fontGeneration()).toBe(generation+1);
  expect(e.execute("text.fonts",{family:"Proof"})).toEqual(["Regular"]);
  expect(e.execute("node.get",{id:ids[2]})).toMatchObject({width:999});
  expect(e.execute("node.get",{id:ids[3]})).toMatchObject({width:999});
  e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(stale);
  expect(await e.executeAsync("text.loadFont",{data})).toEqual({families:["Proof"],refitted:ids.slice(0,2).map(Number)});
});

it("rejects invalid input and cancels imports when editing access is revoked",async ()=>{
  const e=new EditorEngine(), before=e.getSnapshot();
  for (const input of [{},{path:"/fonts/x.ttf"},{data:"%%%="},{data:"YQ"},{data:"YR=="},{data:"Y Q=="},{data:"bm90IGEgZm9udA=="}]) {
    await expect(e.executeAsync("text.loadFont",input)).rejects.toThrow();
    expect(e.getSnapshot()).toBe(before);
  }
  const request=e.executeAsync("text.loadFont",{path:new Blob([new Uint8Array(await renamedFont("Bold"))])});
  e.setEditable(false);e.setEditable(true);
  await expect(request).rejects.toThrow(/changed/);
  expect(e.execute("text.fonts",{family:"Proof"})).not.toContain("Bold");
});

it("loads every face of a collection and reports adjacent equal families once",async ()=>{
  const e=new EditorEngine();
  const file=fontCollection([await renamedFont(),await renamedFont("Bold")]);
  const data=file.toString("base64");
  expect(await e.executeAsync("text.loadFont",{data,path:"ignored"})).toEqual({families:["Proof"],refitted:[]});
  expect(e.execute("text.fonts",{family:"Proof"})).toEqual(["Regular","Bold"]);
});
