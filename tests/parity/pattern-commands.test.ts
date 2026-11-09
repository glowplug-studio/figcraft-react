import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { patternSources } from "../../src/engine/pattern-sources";
import type { LayerNode } from "../../src/engine/document";
import { writeFill } from "../../src/engine/fill-commands";
import { newVectorEdit } from "../../src/engine/vector-edit";

const rect = (engine:EditorEngine, props={}) => String(engine.execute("shape.rectangle",props).id);
const layer = (engine:EditorEngine,id:string) => engine.getSnapshot().document.nodes[id] as LayerNode;

it("validates all pattern targets before editing and resets only the requested paint slot",()=>{
  const e=new EditorEngine(), parent=String(e.execute("frame.create").id), child=rect(e,{parent}), other=rect(e,{parent:"1"});
  e.execute("fill.add",{id:other,color:"red"});
  const before=e.getSnapshot().document;
  for (const params of [{id:child,source:child},{ids:[other,parent],source:child},{id:child,source:1},{id:child,source:999},{id:other,source:child,index:42}]) {
    expect(()=>e.execute("fill.pattern",params)).toThrow();
    expect(e.getSnapshot().document).toBe(before);
  }
  e.execute("fill.pattern",{id:other,source:child,index:0,scale:"125",opacity:"25%",tile:"verticalHex",align:"end",spacing:[-4,25]});
  expect(layer(e,other).fills).toMatchObject([{type:"pattern",source:child,scale:100,opacity:.25,spacing:[-4,25],tile:"verticalHex",align:"end"},{type:"solid"}]);
  const map=e.execute("edit.duplicate",{ids:[other,parent],map:true}).map as Record<string,string>;
  expect(layer(e,map[other]).fills?.[0]).toMatchObject({source:child});
  e.execute("edit.undo");
  e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  e.execute("fill.pattern",{id:child,source:parent,scale:"invalid"});
  expect(layer(e,child).fills).toMatchObject([{type:"pattern",source:parent,scale:1}]);
  expect(patternSources(e.getSnapshot().document,[child]).map(n=>n.id)).toEqual([other]);
});

it("keeps file identity through edits and failed opens, rejects matching node IDs after a successful open",async()=>{
  const e=new EditorEngine(), src=rect(e), dest=rect(e), other=rect(e);
  e.execute("fill.pattern",{id:dest,source:src});
  e.execute("fill.copy",{id:dest});
  await expect(e.executeAsync("file.open",{data:"QQ=="})).rejects.toThrow();
  e.execute("fill.paste",{id:other});
  expect(layer(e,other).fills?.at(-1)).toMatchObject({type:"pattern",source:src});
  expect(()=>e.execute("fill.paste",{id:src})).toThrow(/itself/);
  const {data}=await e.executeAsync("file.saveAs",{data:true});
  await e.executeAsync("file.open",{data});
  const before=e.getSnapshot().document;
  expect(()=>e.execute("fill.paste",{id:other})).toThrow(/another file/);
  expect(e.getSnapshot().document).toBe(before);
});

it("remaps copied layer, stroke and region references while retaining sources outside a frame",()=>{
  const e=new EditorEngine(), external=rect(e), frame=String(e.execute("frame.create").id);
  const source=rect(e,{parent:frame}), box=rect(e,{parent:frame});
  const vector=String(e.execute("vector.flatten",{ids:[box]}).id ?? e.getSnapshot().selection[0]);
  e.execute("fill.pattern",{id:vector,source});
  e.execute("stroke.add",{id:vector,paint:{type:"pattern",source:external}});
  e.execute("fill.set",{id:vector,regions:[0],paint:{type:"pattern",source,tile:"horizontalHex"}});
  const doc=e.getSnapshot().document;
  expect(writeFill("fill.pattern",doc,[vector],{source:external,regions:[0]}, {...newVectorEdit(vector),regions:[0]}).nodes[vector])
    .toMatchObject({fills:[{source:external}],network:{regions:[{fills:[{source}]}]}});
  expect(()=>writeFill("fill.pattern",doc,[vector],{source,regions:[1]})).toThrow(/indices/);
  const map=e.execute("edit.duplicate",{ids:[frame],map:true}).map as Record<string,string>;
  expect(layer(e,map[vector])).toMatchObject({fills:[{source:map[source]}],strokes:[{source:external}],network:{regions:[{fills:[{source:map[source]}]}]}});
  const copy=String(e.execute("page.duplicate",{id:"1"}).id);
  const page=e.getSnapshot().document.nodes[copy];
  if (page.kind!=="page") throw Error("Expected copied page");
  const copiedFrame=e.getSnapshot().document.nodes[page.children[1]];
  if(copiedFrame.kind!=="frame") throw Error("Expected copied frame");
  expect(layer(e,copiedFrame.children[1])).toMatchObject({fills:[{source:copiedFrame.children[0]}],strokes:[{source:page.children[0]}],network:{regions:[{fills:[{source:copiedFrame.children[0]}]}]}});
});

it("offers the first 64 eligible page layers in document order",()=>{
  const e=new EditorEngine(), target=rect(e);
  const ids=Array.from({length:70},()=>rect(e));
  expect(patternSources(e.getSnapshot().document,[target,ids[2]]).map(n=>n.id)).toEqual(ids.filter(id=>id!==ids[2]).slice(0,64));
});
