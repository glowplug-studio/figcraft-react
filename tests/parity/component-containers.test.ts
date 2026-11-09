import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";
import { hitRectangle } from "../../src/engine/selection";

const capture = (name: string) => readFileSync(new URL("../fixtures/native-component-" + name + ".json", import.meta.url));
const open = async (source: Uint8Array) => {
  const engine = new EditorEngine();
  await engine.executeAsync("file.open", {data:base64Bytes(source)});
  return engine;
};

describe("native component containers", () => {
  it.each(["instance","propagated","variants"])("preserves the captured native %s tree through archive save and reopen", async name => {
    const source = capture(name), engine = await open(source);
    const first = engine.getSnapshot().document;
    const archive = await encodeFigcraft(first);
    expect((await decodeFigcraft(archive)).document).toEqual(first);
    const native = JSON.parse(source.toString("utf8"));
    const wire = JSON.parse(strFromU8(unzipSync(archive)["document.json"]));
    for (const [id,n] of Object.entries(native.nodes)) {
      if (id === "1") expect(wire.nodes[id].children).toEqual(native.nodes[id].children);
      else expect(wire.nodes[id]).toMatchObject(n as object);
    }
  });

  it("inspects native component kinds, looks up their main and uses frame geometry for hit tests",async () => {
    const engine = await open(capture("instance"));
    expect(engine.execute("node.get",{id:2,fields:["type","clip","childCount"]})).toEqual({id:2,type:"COMPONENT",clip:true,children:[{id:3,type:"RECTANGLE"}]});
    expect(engine.execute("node.get",{id:4,fields:["type","mainComponent","mainComponentName","clip"]}))
      .toEqual({id:4,type:"INSTANCE",mainComponent:2,mainComponentName:"Card",clip:true,children:[{id:5,type:"RECTANGLE"}]});
    const document=engine.getSnapshot().document;
    expect(hitRectangle(document,{x:165,y:26})).toBe("5");
    expect(hitRectangle(document,{x:210,y:60})).toBe("4");
    const set=await open(capture("variants"));
    expect(set.execute("node.get",{id:3,fields:["type","clip","childCount"]})).toEqual({id:3,type:"COMPONENT_SET",clip:true,children:[{id:2,type:"COMPONENT",clip:true},{id:4,type:"COMPONENT",clip:true}]});
  });

  it("keeps property definitions, display order and arbitrary nested instance values lossless",async () => {
    const file=JSON.parse(capture("instance").toString("utf8"));
    Object.assign(file.nodes[2],{description:"Control",props:{Swap:{type:"instanceSwap",default:"LARGE"},Show:{type:"boolean",default:false}},prop_order:["Show","Missing","Swap","Show"]});
    file.nodes[4].props=JSON.parse('{"Swap":"LARGE","Nested":[true,null,{"__proto__":"LARGE"}]}');
    const source=Buffer.from(JSON.stringify(file).replaceAll('"LARGE"',"18446744073709551615"));
    const engine=await open(source);
    expect(engine.execute("node.get",{id:2,fields:["description","componentPropertyDefinitions"]})).toMatchObject({
      description:"Control",componentPropertyDefinitions:{Swap:{type:"instanceSwap",default:"18446744073709551615"},Show:{type:"boolean",default:false}}});
    expect(engine.execute("node.get",{id:4,fields:["componentProperties"]})).toEqual({
      id:4,children:[{id:5}],componentProperties:JSON.parse('{"Swap":"18446744073709551615","Nested":[true,null,{"__proto__":"18446744073709551615"}]}')});
    const wire=strFromU8(unzipSync(await encodeFigcraft(engine.getSnapshot().document))["document.json"]);
    expect(wire.match(/18446744073709551615/g)).toHaveLength(3);
    expect(wire).toContain('"__proto__":18446744073709551615');
    expect(wire).toContain('"prop_order":["Show","Missing","Swap","Show"]');
  });

  it("creates numbered main components from node.create with native frame defaults", () => {
    const engine=new EditorEngine();
    engine.execute("node.create",{type:"Component",props:{width:120,clip:false}});
    engine.execute("node.create",{type:"component"});
    expect(engine.getSnapshot().document.nodes["2"]).toMatchObject({kind:"component",name:"Component 1",width:120,clip:false,props:{}});
    expect(engine.getSnapshot().document.nodes["3"]).toMatchObject({name:"Component 2",width:100,height:100,fill:"#ffffff",clip:true});
  });

  it("converts a frame in place and wraps a single leaf at its original bounds",() => {
    const engine=new EditorEngine();
    engine.execute("node.create",{type:"frame",name:"Card"});
    engine.execute("node.create",{type:"rectangle",name:"Marker",parent:2});
    expect(engine.execute("component.create",{id:2})).toEqual({id:"2"});
    expect(engine.getSnapshot().document.nodes["2"]).toMatchObject({kind:"component",clip:true,children:["3"]});
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document.nodes["2"].kind).toBe("frame");
    engine.execute("node.create",{type:"rectangle",name:"Icon",props:{x:10,y:5,width:25,height:20}});
    const {id}=engine.execute("component.create");
    const wrapper=engine.getSnapshot().document.nodes[String(id)];
    expect(wrapper).toMatchObject({kind:"component",name:"Icon",fill:"transparent",clip:true,x:10,y:5,width:25,height:20});
    expect(engine.getSnapshot().selection).toEqual([id]);
  });

  it("rolls back multiple creation when a selected descendant belongs to an instance",async () => {
    const engine=await open(capture("instance")), before=engine.getSnapshot();
    expect(()=>engine.execute("component.createMultiple",{ids:[2,5]})).toThrow(/inside an instance/);
    expect(engine.getSnapshot()).toBe(before);
    expect(engine.getUndoDepth()).toBe(0);
    expect(engine.execute("component.createMultiple",{ids:[2,4]}).ids).toHaveLength(2);
    expect(engine.getUndoDepth()).toBe(1);
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toBe(before.document);
  });
});

describe("native instance creation",() => {
  it("places the instance beside the main when either coordinate is absent and preserves mirror IDs on redo",async () => {
    const engine=await open(capture("instance")), initial=engine.getSnapshot().document;
    expect(engine.execute("instance.create",{component:2,x:999})).toEqual({id:"6"});
    expect(engine.getSnapshot().document.nodes["6"]).toMatchObject({kind:"instance",component:"2",source:"2",x:160,y:0,children:["7"]});
    expect(engine.getSnapshot().document.nodes["7"]).toMatchObject({kind:"rectangle",parent:"6",source:"3",width:12});
    const created=engine.getSnapshot().document;
    expect(engine.getSnapshot().selection).toEqual(["6"]);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(initial);
    engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(created);
  });

  it("chooses the nearest top-left variant and names its instance after the set",async () => {
    const file=JSON.parse(capture("variants").toString("utf8"));
    file.nodes[4].transform=[1,0,0,1,10,5];
    const engine=await open(Buffer.from(JSON.stringify(file)));
    expect(engine.execute("instance.create",{component:3,x:-14,y:26})).toEqual({id:"5"});
    expect(engine.getSnapshot().document.nodes["5"]).toMatchObject({kind:"instance",component:"4",source:"4",x:-14,y:26,name:"Card"});
  });

  it("rejects directly and transitively recursive instances before publishing any edits",() => {
    const engine=new EditorEngine();
    for(const name of ["A","B","C"]) engine.execute("node.create",{type:"component",name});
    engine.execute("instance.create",{component:3,parent:2});
    engine.execute("instance.create",{component:4,parent:3});
    const initial=engine.getSnapshot(), depth=engine.getUndoDepth();
    for(const [component,parent] of [[2,4],[3,3],[2,2]]) {
      expect(()=>engine.execute("instance.create",{component,parent})).toThrow(/can't contain itself/);
      expect(engine.getSnapshot()).toBe(initial); expect(engine.getUndoDepth()).toBe(depth);
    }
    expect(()=>engine.execute("instance.create",{component:4,parent:5})).toThrow(/edit its main component/);
    expect(engine.getSnapshot()).toBe(initial);
  });

  it("rolls back swap defaults that would make a host contain itself and leaves its next id free",async () => {
    const file=JSON.parse(capture("variants").toString("utf8"));
    file.nodes[2].props={Icon:{type:"instanceSwap",default:4}};
    const engine=await open(Buffer.from(JSON.stringify(file)));
    const before=engine.getSnapshot();
    expect(()=>engine.execute("instance.create",{component:2,parent:4})).toThrow(/"Property 1=Variant2" → "Property 1=Variant2"/);
    expect(engine.getSnapshot()).toBe(before);
    expect(engine.getUndoDepth()).toBe(0);
    expect(engine.execute("instance.create",{component:2})).toEqual({id:"5"});
  });

  it("breaks equal corner distances by the top-most variant and exact ties by child order",async () => {
    const file=JSON.parse(capture("variants").toString("utf8"));
    file.nodes[2].transform=[1,0,0,1,10,20];
    for(const [x,y,expected] of [[15,15,"4"],[10,20,"2"]] as const) {
      file.nodes[4].transform=[1,0,0,1,x,y];
      const engine=await open(Buffer.from(JSON.stringify(file)));
      engine.execute("instance.create",{component:3});
      expect(engine.getSnapshot().document.nodes["5"]).toMatchObject({component:expected});
    }
  });

  it("duplicates a main as a linked instance with the native descendant map but keeps a variant copy as a main",async () => {
    const engine=await open(capture("instance"));
    expect(engine.execute("edit.duplicate",{ids:[2],map:true})).toEqual({ids:["6"],map:{"2":"6","3":"7"}});
    expect(engine.getSnapshot().document.nodes["6"]).toMatchObject({kind:"instance",name:"Card",component:"2",source:"2",x:220});
    expect(engine.getSnapshot().document.nodes["7"]).toMatchObject({source:"3",parent:"6"});
    const variants=await open(capture("variants"));
    expect(variants.execute("edit.duplicate",{ids:[4],map:true})).toEqual({ids:["5"],map:{"4":"5"}});
    expect(variants.getSnapshot().document.nodes["5"]).toMatchObject({kind:"component",name:"Property 1=Variant2",parent:"3"});
    expect(variants.getSnapshot().document.nodes["5"].source).toBeUndefined();
  });

  it("binds visible and text defaults and excludes slots from the instance's value map",async () => {
    const file=JSON.parse(capture("instance").toString("utf8"));
    file.nodes[2].props={Show:{type:"boolean",default:false},Caption:{type:"text",default:"New\r\nlabel"},Content:{type:"slot"}};
    file.nodes[3]={...file.nodes[3],type:"text",characters:"Original",prop_refs:{visible:"Show",characters:"Caption"}};
    const engine=await open(Buffer.from(JSON.stringify(file)));
    engine.execute("instance.create",{component:2});
    expect(engine.getSnapshot().document.nodes["6"]).toMatchObject({props:{Show:false,Caption:"New\r\nlabel"}});
    expect(Object.keys((engine.getSnapshot().document.nodes["6"] as import("../../src/engine/document").InstanceNode).props)).toEqual(["Show","Caption"]);
    expect(engine.getSnapshot().document.nodes["7"]).toMatchObject({visible:false,text:{characters:"New\nlabel"},source:"3"});
    expect(engine.getSnapshot().document.nodes["7"].propRefs).toBeUndefined();
  });
});

describe("component edit transactions", () => {
  it("propagates changes, keeps explicit same-value overrides, and clears a changed value set back to its main",async () => {
    const engine = await open(capture("instance"));
    const edit = (id: number, props: Record<string,unknown>) => engine.execute("node.set",{id,props});
    edit(5,{name:"Marker"}); // Explicitly keeping the current value is significant to node.set.
    edit(3,{name:"Dot",fill:"#224466"});
    expect(engine.getSnapshot().document.nodes["5"]).toMatchObject({name:"Marker",fill:"#224466",overrides:["name"]});
    edit(5,{name:"Dot"});
    expect(engine.getSnapshot().document.nodes["5"].overrides).toBeUndefined();
    edit(3,{name:"Moved"});
    expect(engine.getSnapshot().document.nodes["5"].name).toBe("Moved");
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document.nodes["5"].name).toBe("Dot");
    engine.execute("edit.redo");
    const openAgain=await open(await encodeFigcraft(engine.getSnapshot().document));
    expect(openAgain.getSnapshot().document.nodes["5"]).toMatchObject({source:"3",name:"Moved"});
  });

  it("refuses a mixed edit, a duplicate and a rotation gesture inside an instance without consuming history or ids",async () => {
    const engine=await open(capture("instance"));
    engine.execute("node.set",{id:3,props:{opacity:0.5}});
    engine.execute("edit.undo");
    const before=engine.getSnapshot();
    expect(()=>engine.execute("node.set",{ids:[3,5],props:{x:71}})).not.toThrow(); // Both main and copy moved together.
    engine.execute("edit.undo");
    const restored=engine.getSnapshot();
    expect(restored.document).toBe(before.document);
    expect(()=>engine.execute("node.set",{ids:[2,5],props:{x:17}})).toThrow(/position comes from the main/);
    expect(()=>engine.execute("edit.duplicate",{ids:[5]})).toThrow(/inside the instance/);
    engine.beginInteraction();
    engine.previewRotate(["5"],45,{x:160,y:20});
    expect(()=>engine.commitInteraction()).toThrow(/position comes from the main/);
    expect(engine.interacting).toBe(false);
    expect(engine.getUndoDepth()).toBe(0);
    expect(engine.getSnapshot()).toBe(restored);
    expect(engine.execute("edit.redo")).toEqual({redone:true});
    expect(engine.execute("node.create",{type:"rectangle"})).toEqual({id:"6"});
  });

  it("retains mirror ids through reordering, propagates additions and removes main children while Delete hides a mirror",async () => {
    const engine=await open(capture("instance"));
    engine.execute("node.create",{type:"rectangle",name:"Second",parent:2});
    expect(engine.getSnapshot().document.nodes["7"]).toMatchObject({source:"6",parent:"4"});
    engine.execute("node.reparent",{ids:[6],parent:2,index:0});
    expect(engine.getSnapshot().document.nodes["4"]).toMatchObject({children:["7","5"]});
    expect(engine.execute("edit.delete",{id:5})).toEqual({deleted:[],hidden:["5"]});
    expect(engine.getSnapshot().document.nodes["5"]).toMatchObject({visible:false,overrides:["visible"]});
    expect(engine.execute("edit.delete",{id:3})).toEqual({deleted:["3"],hidden:[]});
    expect(engine.getSnapshot().document.nodes["5"]).toBeUndefined();
    expect(engine.getSnapshot().document.nodes["4"]).toMatchObject({children:["7"]});
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document.nodes["5"]).toMatchObject({source:"3",visible:false});
  });

  it("allocates new mirrors through nested and standalone instances in native order",() => {
    const engine = new EditorEngine();
    engine.execute("node.create",{type:"component",name:"Outer"});
    engine.execute("node.create",{type:"component",name:"Inner"});
    engine.execute("node.create",{type:"rectangle",parent:3,name:"Mark"});
    engine.execute("instance.create",{component:3,parent:2});
    engine.execute("instance.create",{component:2});
    engine.execute("instance.create",{component:2});
    engine.execute("instance.create",{component:3});
    expect(engine.execute("edit.duplicate",{ids:[4]})).toEqual({ids:["15"]});
    const nodes = engine.getSnapshot().document.nodes;
    for (const [id,parent,source] of [["16","5","15"],["17","13","15"],["18","8","16"],["19","11","16"]]) {
      expect(nodes[id]).toMatchObject({name:"Mark",parent,source});
    }
    engine.execute("node.set",{id:4,props:{name:"Changed"}});
    for (const id of ["6","9","12","14"]) expect(engine.getSnapshot().document.nodes[id].name).toBe("Changed");
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document.nodes).toBe(nodes);
  });

  it("makes edited slot content independent and retains it when the main rebuilds",async () => {
    const file=JSON.parse(capture("instance").toString("utf8"));
    file.nodes[2].props={Body:{type:"slot"}};
    file.nodes[3]={...file.nodes[3],type:"frame",prop_refs:{slot:"Body"},children:[6]};
    file.nodes[5]={...file.nodes[5],type:"frame",children:[7]};
    file.nodes[6]={id:6,parent:3,type:"rectangle",name:"Default",width:10,height:20};
    file.nodes[7]={...file.nodes[6],id:7,parent:5,source:6};
    file.next_id=8;
    const engine=await open(Buffer.from(JSON.stringify(file)));
    engine.execute("node.create",{type:"rectangle",parent:5,name:"Placed"});
    expect(engine.getSnapshot().document.nodes["5"].overrides).toEqual(["slot"]);
    expect(engine.getSnapshot().document.nodes["7"].source).toBeUndefined();
    engine.execute("node.set",{id:6,props:{name:"New default"}});
    engine.execute("node.set",{id:2,props:{name:"Changed main"}});
    expect(engine.getSnapshot().document.nodes["5"]).toMatchObject({source:"3",children:["7","8"]});
    expect(engine.getSnapshot().document.nodes["7"].name).toBe("Default");
    expect(engine.execute("edit.delete",{id:7})).toEqual({deleted:["7"],hidden:[]});
  });
});

describe("instance commands",() => {
  it("resets a child group, resets the whole instance while keeping its size, and pushes only supported overrides",async () => {
    const e = await open(capture("instance"));
    const edit = (id: number,props: Record<string,unknown>)=>e.execute("node.set",{id,props});
    edit(4,{width:230,name:"Custom card"});
    edit(5,{fill:"#776611",name:"Mine"});
    expect(e.execute("component.resetOverride",{id:5,group:"name"})).toEqual({changed:true});
    expect(e.getSnapshot().document.nodes[5]).toMatchObject({name:"Marker",fill:"#776611",overrides:["fills"]});
    expect(e.execute("component.pushChanges",{id:5})).toEqual({layers:1});
    expect(e.getSnapshot().document.nodes[3]).toMatchObject({fill:"#776611"});
    expect(e.getSnapshot().document.nodes[5].overrides).toBeUndefined();
    expect(e.execute("component.resetInstance",{ids:[5,4]})).toEqual({ids:["4","4"]});
    expect(e.getSnapshot().document.nodes[4]).toMatchObject({name:"Card",width:230,overrides:["size"]});
    expect(e.execute("component.resetOverride",{id:4,group:"size"})).toEqual({changed:true});
    expect(e.getSnapshot().document.nodes[4]).toMatchObject({width:120});
    expect(e.execute("component.resetOverride",{id:4,group:"size"})).toEqual({changed:false});
  });

  it("restores a missing main at the instance position with its old ids and relinks the other instances",async () => {
    const e = await open(capture("instance"));
    e.execute("instance.create",{component:2,x:300,y:90});
    e.execute("node.set",{id:5,props:{name:"Independent"}});
    e.execute("edit.delete",{id:2});
    expect(()=>e.execute("component.goToMain",{id:5})).toThrow(/deleted/);
    expect(e.execute("component.restoreMain",{id:6})).toEqual({id:"2"});
    expect(e.getSnapshot().selection).toEqual(["2"]);
    expect(e.getSnapshot().document.nodes[2]).toMatchObject({kind:"component",children:["3"],x:300,y:90});
    expect(e.getSnapshot().document.nodes[4]).toMatchObject({kind:"instance",component:"2"});
    expect(e.getSnapshot().document.nodes[5]).toMatchObject({name:"Independent",source:"3"});
    expect(e.getSnapshot().document.nodes[6]).toBeUndefined();
    e.execute("edit.undo");
    expect(e.getSnapshot().document.nodes[6].kind).toBe("instance");
    expect(e.getSnapshot().document.nodes[2]).toBeUndefined();
  });

  it("detaches the outer instance in place, rebases nested sources onto their own main and rolls back rejected nested detaches",() => {
    const e = new EditorEngine();
    for (const name of ["First","Outer"]) e.execute("node.create",{type:"component",name});
    e.execute("node.create",{type:"rectangle",parent:2,name:"Marker"});
    e.execute("instance.create",{component:2,parent:3});
    e.execute("instance.create",{component:3});
    const before = e.getSnapshot(), depth = e.getUndoDepth();
    expect(()=>e.execute("component.detach",{ids:[8]})).toThrow(/outer instance first/);
    expect(e.getSnapshot()).toBe(before); expect(e.getUndoDepth()).toBe(depth);
    expect(e.execute("component.detach",{ids:[2,7]})).toEqual({ids:["7"]});
    const nodes = e.getSnapshot().document.nodes;
    expect(nodes[7]).toMatchObject({kind:"frame",children:["8"]});
    expect(nodes[7].source).toBeUndefined();
    expect(nodes[8]).toMatchObject({kind:"instance",source:"2",component:"2"});
    expect(nodes[9]).toMatchObject({source:"4"});
    e.execute("node.set",{id:4,props:{name:"Changed"}});
    expect(e.getSnapshot().document.nodes[9].name).toBe("Changed");
  });

  it("locates a main across pages and fits the viewport without recording a history entry",async () => {
    const file = JSON.parse(capture("instance").toString("utf8"));
    file.pages.push(6); file.next_id=7;
    file.nodes[1].children=[4];
    file.nodes[2].parent=6;
    file.nodes[6]={...file.nodes[1],id:6,name:"Assets",children:[2]};
    const e=await open(Buffer.from(JSON.stringify(file)));
    expect(e.execute("component.goToMain",{id:5})).toEqual({id:"2"});
    expect(e.getSnapshot()).toMatchObject({selection:["2"],document:{currentPage:"6"}});
    expect(e.getView()).toMatchObject({cx:60,cy:35,zoom:2});
    expect(e.getUndoDepth()).toBe(0);
  });

  it("restores a slot's default content and clears a selection removed by the rebuild",async () => {
    const file=JSON.parse(capture("instance").toString("utf8"));
    file.nodes[2].props={Body:{type:"slot"}};
    file.nodes[3]={...file.nodes[3],type:"frame",prop_refs:{slot:"Body"},children:[]};
    file.nodes[5]={...file.nodes[5],type:"frame",children:[]};
    const e=await open(Buffer.from(JSON.stringify(file)));
    e.execute("node.create",{type:"component",name:"Badge"});
    expect(e.execute("instance.slotInsert",{id:4,slot:"Body",component:6})).toEqual({id:"7",slot:"5"});
    expect(e.execute("instance.resetSlot",{id:4,slot:"Body"})).toEqual({id:"5",changed:true});
    expect(e.getSnapshot().selection).toEqual([]);
    expect(e.getSnapshot().document.nodes[7]).toBeUndefined();
    expect(e.execute("instance.resetSlot",{id:5})).toEqual({id:"5",changed:false});
  });
});

it("drops differing variant paint overrides, preserves text overrides and matches renamed copies by their source names",async () => {
  const e = await open(capture("variant-overrides"));
  e.execute("instance.create",{component:2,x:450,y:30});
  e.execute("node.set",{id:10,props:{fill:"#ff0000",name:"Renamed"}});
  e.execute("node.set",{id:11,props:{characters:"Custom caption"}});
  e.execute("instance.swap",{id:9,component:5});
  expect(e.getSnapshot().document.nodes[9]).toMatchObject({component:"5",source:"5",x:450,y:30,children:["10","11"]});
  expect(e.getSnapshot().document.nodes[10]).toMatchObject({source:"6",fill:"#33ff99",name:"Renamed",overrides:["name"]});
  expect(e.getSnapshot().document.nodes[11]).toMatchObject({source:"7",text:{characters:"Custom caption"}});
  const reopened=await open(await encodeFigcraft(e.getSnapshot().document));
  expect(reopened.getSnapshot().document.nodes[11]).toMatchObject({source:"7",text:{characters:"Custom caption"}});
});

it("applies typed values to bound layers and describes native slots without changing history",async () => {
  const e=await open(capture("typed"));
  const before=e.getSnapshot(), depth=e.getUndoDepth();
  expect(e.execute("component.properties",{id:7})).toEqual({component:2,set:null,conflicts:[],properties:[
    {name:"Shown",type:"boolean",default:true,value:true},
    {name:"Caption",type:"text",default:"",value:""},
    {name:"Icon",type:"instanceSwap",default:5,value:5,preferred:[]},
    {name:"Body",type:"slot",preferred:[5],value:{layer:10,edited:false,layers:0}},
  ]});
  expect(e.getSnapshot()).toBe(before);
  expect(e.getUndoDepth()).toBe(depth);
  e.execute("instance.setProperties",{id:7,properties:{Shown:"false",Caption:42,Icon:"1:5"}});
  expect(e.getSnapshot().document.nodes[8]).toMatchObject({visible:false});
  expect(e.getSnapshot().document.nodes[9]).toMatchObject({text:{characters:"42"}});
  const edited=e.getSnapshot();
  expect(()=>e.execute("instance.setProperties",{ids:[7,2],properties:{Shown:true}})).toThrow(/not an instance/);
  expect(()=>e.execute("instance.setProperties",{id:7,properties:{Shown:"yes"}})).toThrow(/boolean/);
  expect(()=>e.execute("instance.setProperties",{id:7,properties:{Body:"text"}})).toThrow(/slot/);
  expect(e.getSnapshot()).toBe(edited);
  e.execute("instance.slotInsert",{id:7,slot:"Body",component:5});
  expect(e.execute("component.properties",{id:7})).toMatchObject({properties:expect.arrayContaining([
    {name:"Body",type:"slot",preferred:[5],value:{layer:10,edited:true,layers:1}},
  ])});
});

it("exposes visible nested instances, accepts their own properties and restores exposure on undo",async () => {
  const e=await open(capture("typed"));
  e.execute("node.create",{type:"component",name:"Outer"});
  e.execute("instance.create",{component:2,parent:11});
  e.execute("instance.create",{component:11});
  expect(e.execute("component.exposeInstance",{id:12})).toEqual({id:12,exposed:true});
  expect(e.execute("instance.exposed",{id:16})).toEqual({instances:[{id:17,name:"Card"}]});
  e.execute("instance.setProperties",{id:17,properties:{Caption:"Nested"}});
  expect(e.getSnapshot().document.nodes[19]).toMatchObject({text:{characters:"Nested"}});
  e.execute("node.set",{id:12,props:{visible:false}});
  expect(e.execute("instance.exposed",{id:16})).toEqual({instances:[]});
  e.execute("edit.undo");
  expect(e.execute("instance.exposed",{id:16})).toEqual({instances:[{id:17,name:"Card"}]});
  expect(()=>e.execute("component.exposeInstance",{id:17})).toThrow(/main component/);
});

it("builds a bound nested swap through its placing main before matching descendants by name",async () => {
  const e=await open(capture("bound-swap"));
  expect(e.execute("instance.create",{component:8})).toEqual({id:"12"});
  const nodes=e.getSnapshot().document.nodes;
  expect(nodes[13]).toMatchObject({kind:"instance",name:"B",component:"5",source:"9",children:["16","15"]});
  expect(nodes[14]).toBeUndefined();
  expect(nodes[15]).toMatchObject({source:"7",text:{characters:"Alpha"}});
  expect(nodes[16]).toMatchObject({source:"6",name:"Mark"});
  e.execute("instance.setProperties",{id:12,properties:{Type:2}});
  expect(e.getSnapshot().document.nodes[13]).toMatchObject({component:"2"});
});
