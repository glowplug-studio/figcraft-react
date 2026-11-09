import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { layerSizing, readAutoLayout } from "../../src/engine/auto-layout";
import { newDocument, type DocumentNode, type FrameNode } from "../../src/engine/document";
import { executeStructure } from "../../src/engine/structure";

function makeFrame(children: number[][]) {
  const e=new EditorEngine();
  e.execute("node.create",{type:"frame",name:"Board",width:300,height:200});
  for (const [x,y] of children) e.execute("node.create",{type:"rectangle",parent:2,width:20,height:10,x,y});
  return e;
}

it("adds layout in place, preserves mask runs, infers padding and keeps empty frame dimensions", () => {
  const e=makeFrame([[80,10],[60,10],[40,10],[20,10],[0,10]]);
  e.execute("node.set",{id:4,isMask:true}); e.execute("node.set",{id:6,isMask:true,visible:false});
  e.execute("node.create",{type:"frame",width:41,height:32});
  const before=e.getSnapshot().document;
  expect(e.execute("layout.add",{ids:[2,8]})).toEqual({ids:[2,8]});
  expect(e.getSnapshot().document.nodes[2]).toMatchObject({children:["3","4","5","6","7"],layout:{mode:"horizontal",gap:7,padding:[10,200,180,0]}});
  expect(e.getSnapshot().document.nodes[8]).toMatchObject({width:41,height:32});
  expect(layerSizing(e.getSnapshot().document.nodes[8] as FrameNode)).toEqual({horizontal:"fixed",vertical:"fixed"});
  e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
});

it("suggests nested rows, retains exact placement, removes all nested layouts and undoes each command", () => {
  const e=makeFrame([[5,6],[32,6],[5,24],[32,24]]);
  const before=e.getSnapshot().document;
  expect(e.execute("layout.suggest",{id:2})).toEqual({ids:[2]});
  const suggested=e.getSnapshot().document;
  expect(suggested.nodes[2]).toMatchObject({width:300,height:200,children:["7","8"],layout:{mode:"vertical",gap:8}});
  for(const id of [7,8]) expect(suggested.nodes[id]).toMatchObject({kind:"frame",clip:false,width:47,height:10,
    sizing:{horizontal:"hug",vertical:"hug"},layout:{mode:"horizontal",gap:7}});
  expect(e.execute("layout.removeAll",{ids:[2,7]})).toEqual({removed:[2,7,8]});
  for(const id of [2,7,8]) expect(e.getSnapshot().document.nodes[id]).not.toHaveProperty("layout");
  e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(suggested);
  e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
});

it("reports overlap without moving layers, supports forced directions and converts groups without wrapping", () => {
  const e=makeFrame([[0,0],[2,1]]);
  const before=e.getSnapshot().document;
  expect(e.execute("layout.suggest",{id:2})).toEqual({ids:[2],warnings:['"Board": its layers overlap along both axes, so no auto layout was added']});
  expect(e.getSnapshot().document).toBe(before);
  expect(e.execute("layout.suggest",{id:2,direction:"row"})).toMatchObject({warnings:['"Board": its layers don\'t separate along the direction asked for, so they are laid out in one list']});
  e.execute("edit.undo");
  e.execute("object.group",{ids:[3,4]});
  expect(e.execute("layout.add",{id:5})).toEqual({ids:[5]});
  expect(e.getSnapshot().document.nodes[5]).toMatchObject({kind:"frame",clip:false,children:["3","4"]});
  expect(e.execute("layout.add",{id:5,direction:"grid"})).toEqual({ids:[6]});
  expect(e.getSnapshot().document.nodes[6]).toMatchObject({kind:"frame",clip:false,children:["5"],layout:{mode:"grid"}});
});

it("falls back to one list beyond 1,000 items and preserves all children", () => {
  const base=newDocument(), ids=Array.from({length:1001},(_,i)=>String(i+3));
  const nodes:Record<string,DocumentNode>={...base.nodes};
  nodes[1]={...base.nodes[1],children:["2"]} as DocumentNode;
  nodes[2]={id:"2",parent:"1",kind:"frame",name:"Large",fill:"transparent",width:4001,height:10,x:0,y:0,clip:false,children:ids};
  ids.forEach((id,i)=>{nodes[id]={id,parent:"2",kind:"rectangle",name:id,fill:"transparent",width:2,height:2,x:i*4,y:0};});
  const out=executeStructure("layout.suggest",{...base,nodes},["2"],1004n,{});
  expect(out.result).toEqual({ids:[2],warnings:['"Large": it has too many layers to analyse, so its layers are laid out in one list']});
  expect((out.document.nodes[2] as FrameNode).children).toEqual(ids);
  expect((out.document.nodes[2] as FrameNode).layout).toMatchObject({...readAutoLayout({}),gap:2,padding:[0,0,8,0]});
});
