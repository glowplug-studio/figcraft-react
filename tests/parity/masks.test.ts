import { expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { hitRectangle } from "../../src/engine/selection";
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

it("passes clicks through a masked-out group and lists only the visible hit stack",()=>{
  const e=new EditorEngine();
  const rect=(x:number,size:number)=>String(e.execute("shape.rectangle",{x,y:x,width:size,height:size}).id);
  const back=rect(60,40),mask=rect(0,50),content=rect(0,100);
  const hit=(x:number,y:number,deep=true)=>hitRectangle(e.getSnapshot().document,{x,y},deep);
  const stack=(x:number,y:number)=>e.execute("select.layersAt",{x,y}).layers.map(n=>[String(n.id),n.type,n.depth]);
  expect(hit(75,75)).toBe(content);
  const group=String(e.execute("object.mask",{ids:[mask,content]}).id);
  expect(hit(75,75)).toBe(back); expect(hit(75,10)).toBeUndefined();
  expect(hit(25,25)).toBe(content); expect(hit(25,25,false)).toBe(group);
  expect(stack(75,75)).toEqual([[back,"RECTANGLE",0]]);
  expect(stack(25,25)).toEqual([[group,"GROUP",0],[content,"RECTANGLE",1],[mask,"RECTANGLE",1]]);
  e.execute("node.set",{id:mask,props:{locked:true,opacity:0,maskType:"luminance",fill:"black"}});
  expect(hit(25,25)).toBe(content);expect(stack(25,25)).toEqual([[group,"GROUP",0],[content,"RECTANGLE",1]]);
  e.execute("node.set",{id:mask,props:{visible:false}});
  expect(hit(75,75)).toBe(content);
  expect(()=>e.execute("select.layersAt",{x:"left",y:0})).toThrow();
  expect(stack(2000,2000)).toEqual([]);
});

it("uses exact ellipse coverage, transformed subtrees and hidden mask boundaries at page level",()=>{
  const e=new EditorEngine(), hit=(x:number,y:number)=>hitRectangle(e.getSnapshot().document,{x,y},true);
  const rect=(x:number,y:number,size:number,props:Record<string,unknown>={})=>String(e.execute("shape.rectangle",{x,y,width:size,height:size,props}).id);
  const back=rect(0,0,200);
  const a=String(e.execute("shape.ellipse",{x:20,y:20,width:20,height:20}).id);
  const b=rect(60,20,20);
  const g=String(e.execute("object.group",{ids:[a,b]}).id);
  e.execute("node.set",{id:g,props:{isMask:true}});
  const c=rect(0,0,200);
  expect([hit(30,30),hit(20,20),hit(47,30),hit(70,30)]).toEqual([c,back,back,c]);
  e.execute("transform.move",{id:g,dx:0,dy:25});
  expect([hit(30,30),hit(30,55),hit(47,55),hit(70,55)]).toEqual([back,c,back,c]);
  e.execute("node.set",{id:b,props:{isMask:true}});
  expect(hit(70,55)).toBe(b); // The nested mask is selectable, but cannot supply coverage to its parent.
  e.execute("node.set",{id:g,props:{locked:true}});
  expect(hit(70,55)).toBe(back);
  const boundary=rect(120,20,20,{isMask:true,visible:false});
  const top=rect(0,0,200);
  expect(hit(150,150)).toBe(top);
  e.execute("node.set",{id:boundary,props:{visible:true}});
  expect(hit(150,150)).toBe(back);expect(hit(130,30)).toBe(top);
});

it("lists a clipped frame and its overlapping children in native tree order without publishing selection",()=>{
  const e=new EditorEngine();
  const frame=String(e.execute("frame.create",{x:10,y:10,width:50,height:50,props:{clip:true,name:"Board"}}).id);
  const rect=(x:number)=>String(e.execute("shape.rectangle",{parent:frame,x,y:0,width:80,height:30}).id);
  const a=rect(0), b=rect(10);
  const g=String(e.execute("object.group",{ids:[a,b]}).id),top=rect(0);
  const before=e.getSnapshot();
  const stack=e.execute("select.layersAt",{x:30,y:25}).layers;
  expect(stack.map(n=>[String(n.id),n.depth])).toEqual([[frame,0],[top,1],[g,1],[b,2],[a,2]]);
  expect(stack[0]).toMatchObject({id:Number(frame),type:"FRAME",name:"Board"});
  expect(e.execute("select.layersAt",{x:75,y:25})).toEqual({layers:[]});
  expect(e.getSnapshot()).toBe(before);
});

it("retains large native identifiers in the layer stack and clips each geometry traversal at its own depth",async()=>{
  const {layersAt}=await import("../../src/engine/selection");
  const {maskOutline}=await import("../../src/engine/boolean-result");
  const engine=new EditorEngine();
  const id=String(engine.execute("shape.rectangle",{width:10,height:10}).id);
  const doc=engine.getSnapshot().document, leaf=doc.nodes[id];
  if(leaf.kind!=="rectangle") throw Error("Expected a rectangle");
  const large="18446744073709551614";
  const page=doc.nodes[doc.currentPage];
  if(page.kind!=="page") throw Error("Expected a page");
  const base={...doc,nodes:{...doc.nodes,[page.id]:{...page,children:[large]},[large]:{...leaf,id:large}}};
  expect(layersAt(base,{x:5,y:5},0,[]).layers[0].id).toBe(large);
  expect(maskOutline(base,leaf,64)?.path.length).toBeGreaterThan(0);
  expect(maskOutline(base,leaf,65)).toBeUndefined();
  const nodes={...base.nodes};
  for(let depth=0;depth<2000;depth++){
    const group=String(depth+100);
    nodes[group]={...leaf,id:group,parent:depth===0?page.id:String(depth+99),kind:"group",children:[depth===1999?large:String(depth+101)]};
  }
  nodes[large]={...leaf,id:large,parent:"2099"};
  nodes[page.id]={...page,children:["100"]};
  expect(layersAt({...doc,nodes},{x:5,y:5},0,[]).layers).toEqual([]);
});
