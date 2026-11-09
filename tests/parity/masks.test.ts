import { expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";

it("uses the lowest selected sibling as the mask and keeps the wrapper on release",()=>{
  const e=new EditorEngine();
  const rect=(x:number,size=50)=>String(e.execute("shape.rectangle",{x,y:x,width:size,height:size}).id);
  const mask=rect(0), b=rect(10),c=rect(20),top=rect(200,10),before=e.getSnapshot().document;
  const group=String(e.execute("object.mask",{ids:[c,mask,b]}).id);
  const after=e.getSnapshot().document;
  expect(after.nodes[group]).toMatchObject({name:"Mask group",children:[mask,b,c],x:0,y:0,width:50,height:50});
  expect(after.nodes[after.currentPage]).toMatchObject({children:[group,top]});
  expect(after.nodes[mask].isMask).toBe(true); expect(e.getSnapshot().selection).toEqual([group]);
  for (const id of [mask,b,c]) expect(worldTransform(after,id)).toEqual(worldTransform(before,id));
  e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  e.execute("edit.redo"); e.execute("object.releaseMask",{id:mask});
  expect(e.getSnapshot().document.nodes[mask].parent).toBe(group);
  expect(e.getSnapshot().document.nodes[group]).toMatchObject({x:0,y:0,width:70,height:70});
  e.execute("object.mask",{id:mask}); expect(e.getSnapshot().document.nodes[mask].isMask).toBe(true);
  e.execute("object.mask",{id:mask}); expect(e.getSnapshot().document.nodes[mask].isMask).toBeUndefined();
});

it("refits group bounds to mask runs on hide, reorder, move and insertion below the mask",()=>{
  const e=new EditorEngine();
  const rect=(x:number,y:number,width:number,height:number)=>String(e.execute("shape.rectangle",{x,y,width,height}).id);
  const m=rect(0,0,50,40), c=rect(-30,-30,200,200);
  const g=String(e.execute("object.mask",{ids:[m,c]}).id);
  const bounds=()=>e.execute("node.get",{id:g,fields:["absoluteBounds"]})?.absoluteBounds;
  expect(bounds()).toEqual({x:0,y:0,width:50,height:40});
  e.execute("transform.move",{ids:[c],dx:10,dy:0}); expect(bounds()).toEqual({x:0,y:0,width:50,height:40});
  e.execute("transform.move",{ids:[m],dx:10,dy:0}); expect(bounds()).toEqual({x:10,y:0,width:50,height:40});
  const u=rect(-40,0,10,10); e.execute("node.reparent",{id:u,parent:g,index:0});
  expect(bounds()).toEqual({x:-40,y:0,width:100,height:40});
  e.execute("node.set",{id:m,props:{visible:false}});
  expect(bounds()).toEqual({x:-40,y:-30,width:220,height:200});
  e.execute("node.set",{id:m,props:{visible:true}});
  e.execute("node.reorder",{id:c,index:0});
  expect(bounds()).toEqual({x:-40,y:-30,width:220,height:200});
});

it("retains mask types across release and native files, validates tags and omits native defaults",async()=>{
  const e=new EditorEngine(), id=String(e.execute("shape.ellipse").id);
  const info=()=>e.execute("node.get",{id,fields:["isMask","maskType"]});
  for (const type of ["alpha","vector","luminance"] as const) {
    e.execute("node.set",{id,props:{isMask:true,maskType:type.toUpperCase()}});
    expect(info()).toMatchObject({isMask:true,maskType:type});
    for (const enabled of [true,false]) {
      if (!enabled) {e.execute("object.releaseMask",{id}); expect(info()).not.toHaveProperty("maskType");}
      const bytes=await encodeFigcraft(e.getSnapshot().document);
      const wire=JSON.parse(strFromU8(unzipSync(bytes)["document.json"])).nodes[id];
      expect(wire.is_mask).toBe(enabled || undefined);
      expect(wire.mask_type).toBe(type==="alpha" ? undefined : type);
      const restored=(await decodeFigcraft(bytes)).document.nodes[id];
      expect(restored.isMask??false).toBe(enabled); expect(restored.maskType??"alpha").toBe(type);
    }
  }
  const saved=unzipSync(await encodeFigcraft(e.getSnapshot().document));
  const root=JSON.parse(strFromU8(saved["document.json"]));
  for(const props of [{mask_type:"Alpha"},{mask_type:null},{is_mask:"yes"}]) {
    const copy=structuredClone(root); Object.assign(copy.nodes[id],props);
    await expect(decodeFigcraft(zipSync({...saved,"document.json":strToU8(JSON.stringify(copy))}))).rejects.toThrow(/mask/);
  }
  const before=e.getSnapshot().document;
  for (const props of [{isMask:"yes"},{maskType:null},{maskType:"sparkly"}]) {
    expect(()=>e.execute("node.set",{id,props:{opacity:.2,...props}})).toThrow();
    expect(e.getSnapshot().document).toBe(before);
  }
  for (const cmd of ["object.mask","object.releaseMask"]) {
    for(const params of [{ids:[id,"bad"]},{ids:"bad"},{id:[id]},{ids:[id,"99999"]}]) {
      expect(()=>e.execute(cmd,params)).toThrow(); expect(e.getSnapshot().document).toBe(before);
    }
  }
});
