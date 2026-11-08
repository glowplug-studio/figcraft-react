import {readFileSync} from "node:fs";
import {afterEach, describe, it, expect, vi} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {rectanglePaints, type LayerNode} from "../../src/engine/document";
import {base64Bytes} from "../../src/engine/recovery";
import {decodeFigcraft} from "../../src/engine/file-format";
import {resizeStart,previewResize} from "../../src/engine/transform-preview";
import {worldTransform} from "../../src/engine/hierarchy";
import {transformPoint} from "../../src/engine/affine";
import {ImageCropInteraction} from "../../src/engine/image-crop-interaction";
import {pageToScreen} from "../../src/engine/viewport";

const data=base64Bytes(readFileSync(new URL("../fixtures/images/six-pixels.png",import.meta.url)));
async function setup(mode:string) {
  vi.stubGlobal("createImageBitmap",async()=>({width:3,height:2,close(){}}));
  const engine=new EditorEngine();
  const {id,image}=await engine.executeAsync("image.place",{data,width:120,height:120,mode,x:100,y:100});
  const node=()=>engine.getSnapshot().document.nodes[String(id)] as LayerNode;
  const paint=()=>rectanglePaints(node())[0];
  return {engine,id:String(id),image,node,paint};
}
afterEach(()=>vi.unstubAllGlobals());
describe("native image crop mode and resize",()=>{
  it.each(["fill","fit","crop","tile"])("enters %s through the command and records precisely the required undo",async mode=>{
    const {engine,id,paint}=await setup(mode);
    const before=engine.getSnapshot().document;
    expect(engine.execute("image.crop")).toEqual({id,index:0});
    expect(engine.getSnapshot().crop).toEqual({id,index:0});
    const changed=engine.getSnapshot().document;
    if (mode==="crop") expect(changed).toBe(before);
    else {
      expect(changed).not.toBe(before);
      expect(paint()).toMatchObject({scale_mode:"crop"});
      const p=paint(); if (p.type!=="image") throw Error();
      expect(p.crop?.[0]).toBeCloseTo(mode==="fit"?1:2/3);
      expect(p.crop?.[3]).toBeCloseTo(mode==="fit"?1.5:1);
    }
    engine.execute("image.crop");expect(engine.getSnapshot().document).toBe(changed);
    engine.execute("edit.undo");expect(engine.getSnapshot().crop).toBeUndefined();
    if (mode!=="crop") expect(engine.getSnapshot().document).toBe(before);
  });

  it("uses the top visible fill, accepts an explicit hidden image, and refuses non-images or multiple targets atomically",async()=>{
    const {engine,id,image}=await setup("fit");
    engine.execute("fill.add",{id,paint:{type:"image",image,visible:false}});
    engine.execute("fill.add",{id,color:"#123456"});
    expect(engine.execute("image.crop")).toEqual({id,index:0});
    expect(engine.execute("image.crop",{id,index:1})).toEqual({id,index:1});
    const before=engine.getSnapshot().document;
    for(const p of [{index:2},{index:6},{ids:[]},{ids:[id,id]}]) {
      expect(()=>engine.execute("image.crop",p)).toThrow();expect(engine.getSnapshot().document).toBe(before);
    }
    engine.setPaintPicker({list:"fill",index:1,stop:0});
    expect(engine.getSnapshot().crop).toBeUndefined();expect(engine.pickedCrop()?.paint.image).toBe(image);
  });

  it("holds image pixels in the layer's axes on a rotated edge resize, leaving tile paints intact",async()=>{
    const {engine,id,image}=await setup("fill");
    engine.execute("node.set",{id,props:{rotation:37}});
    engine.execute("fill.add",{id,paint:{type:"image",image,scale_mode:"tile"}});
    const before=engine.getSnapshot().document, start=resizeStart(before,[id],{kind:"edge",index:1})!;
    const point=transformPoint(worldTransform(before,id),{x:60,y:60});
    const {document}=previewResize(before,start,point,false,false,true);
    const node=document.nodes[id] as LayerNode, paints=rectanglePaints(node);
    expect(node.width).toBeCloseTo(60);expect(node.height).toBeCloseTo(120);
    if(paints[0].type!=="image")throw Error();
    expect(paints[0].scale_mode).toBe("crop");expect(paints[0].crop?.[0]).toBeCloseTo(1/3);
    expect(paints[0].crop?.[4]).toBeCloseTo(1/6);
    expect(paints[1]).toBe(rectanglePaints(before.nodes[id] as LayerNode)[1]);
    const normal=previewResize(before,start,point,false,false,false).document.nodes[id] as LayerNode;
    expect(rectanglePaints(normal)[0]).toMatchObject({scale_mode:"fill"});
  });

  it("captures a crop-corner resize through a stroke picker, constrains proportions and supports Shift stretching",async()=>{
    const {engine,image,node}=await setup("fit");
    engine.execute("stroke.add",{paint:{type:"image",image,scale_mode:"crop",crop:[1,0,0,1,0,0]}});
    engine.setPaintPicker({list:"stroke",index:0,stop:0});
    const drag=new ImageCropInteraction(engine), at=(x:number,y:number)=>pageToScreen(engine.getView(),{x,y});
    const before=engine.getSnapshot().document;
    expect(drag.down(at(220,220))).toBe(true);drag.move(at(280,235),false);drag.up();
    expect(node().strokes?.[0]).toMatchObject({crop:[2/3,0,0,2/3,0,0]});
    engine.execute("edit.undo");expect(engine.getSnapshot().document).toBe(before);
    expect(drag.down(at(220,220))).toBe(true);drag.move(at(280,235),true);drag.up();
    const edited=node().strokes![0]; if(edited.type!=="image")throw Error();
    expect(edited.crop?.[0]).toBeCloseTo(2/3);expect(edited.crop?.[3]).toBeCloseTo(120/135);
    const saved=(await decodeFigcraft(await engine.nativeSnapshot())).document;
    expect(saved.nodes[node().id]).toMatchObject({strokes:[{scale_mode:"crop",image}]});
  });
});
