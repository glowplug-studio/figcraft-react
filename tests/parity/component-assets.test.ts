import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";

function layer(e: EditorEngine, type: string, name: string, x: number, y: number, width: number, height: number, parent=1) {
  return e.execute("node.create",{type,name,parent,props:{x,y,width,height}}).id;
}

it("lists individual variants in id order and hides the outer asset atomically",()=>{
  const e = new EditorEngine();
  layer(e,"component","UI / Buttons / A",0,0,100,100);
  layer(e,"component","UI / Buttons / B",150,0,100,100);
  e.execute("component.combineVariants",{ids:[2,3]});
  e.execute("instance.place",{component:4,x:550,y:250});
  e.execute("select.none");
  expect(e.execute("component.list")).toEqual([
    {id:2,name:"Property 1=Default",type:"COMPONENT",page:1,folder:["Page 1","UI / Buttons"],label:"Property 1=Default",instances:1},
    {id:3,name:"Property 1=Variant2",type:"COMPONENT",page:1,folder:["Page 1","UI / Buttons"],label:"Property 1=Variant2",instances:0},
    {id:4,name:"UI / Buttons",type:"COMPONENT_SET",page:1,folder:["Page 1","UI"],label:"Buttons",instances:0},
  ]);
  const before = e.getSnapshot();
  expect(()=>e.execute("component.hideWhenPublishing",{ids:[2,5]})).toThrow();
  expect(e.getSnapshot()).toBe(before);
  expect(e.execute("component.hideWhenPublishing",{ids:[3,2,3]})).toEqual({ids:["4"],hidden:true});
  expect(e.getSnapshot().document.nodes["5"].name).toBe("UI / Buttons");
  e.execute("node.set",{id:4,props:{name:"._  "}});
  e.execute("component.hideWhenPublishing",{id:3});
  expect(e.getSnapshot().document.nodes["4"].name).toBe("Component");
});

it("places into instance slots and keeps other instance content and frame edges out of the destination",()=>{
  const e = new EditorEngine();
  layer(e,"component","Card",0,0,180,140);
  layer(e,"frame","Body",10,10,90,80,2);
  layer(e,"rectangle","Icon",3,3,20,20,3);
  layer(e,"component","Badge",210,0,18,16);
  e.execute("component.makeSlot",{id:3});
  e.execute("instance.place",{component:2,x:490,y:170});
  e.execute("select.none");
  expect(e.execute("instance.place",{component:5,x:445,y:145})).toEqual({id:"9",parent:"7"});
  expect(e.getSnapshot().document.nodes["9"]).toMatchObject({x:26,y:27,parent:"7"});
  expect(e.getSnapshot().document.nodes["7"].overrides).toContain("slot");
  expect(e.execute("instance.place",{component:2,x:10,y:10})).toMatchObject({parent:"1"});
  expect(e.execute("instance.place",{component:5,x:580,y:240})).toMatchObject({parent:"1"});
  expect(()=>e.execute("instance.place",{component:5,x:Infinity,y:5})).toThrow();
});

it("prefers a matching family over the nested instance and preserves the undo boundary for a same-main swap",()=>{
  const e = new EditorEngine();
  layer(e,"component","A",0,0,100,100);
  layer(e,"component","B",150,0,100,100);
  layer(e,"component","Inner",300,0,50,40);
  layer(e,"rectangle","Icon",2,2,12,12,4);
  e.execute("instance.create",{parent:2,component:4,x:4,y:4});
  e.execute("component.combineVariants",{ids:[2,3]});
  e.execute("instance.place",{component:2,x:550,y:250});
  expect(e.execute("instance.swapAt",{component:2,x:510,y:210})).toEqual({id:"9",component:"2"});
  e.execute("edit.undo");
  expect(e.getSnapshot().selection).toEqual(["9"]);
  expect(e.execute("instance.swapAt",{component:4,x:510,y:210})).toEqual({id:"10",component:"4"});
  expect(e.execute("instance.swapAt",{component:3,x:510,y:210})).toEqual({id:"9",component:"3"});
  expect(()=>e.execute("instance.swapAt",{component:3,x:600,y:300})).toThrow(/no instance/i);
});
