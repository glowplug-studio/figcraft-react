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
