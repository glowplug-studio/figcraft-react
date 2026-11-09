import {expect,it} from "vitest";
import cases from "../fixtures/native-text-path-hits.json";
import {EditorEngine} from "../../src/engine/editor";
import {textPathAt} from "../../src/engine/text-path-commands";
import {worldTransform} from "../../src/engine/hierarchy";
import {transformPoint} from "../../src/engine/affine";
import {prepareText} from "../../src/engine/text-node-layout";

it("finds the frontmost first subpath at six screen pixels and restores an unused source",async ()=>{
  await prepareText();
  const e=new EditorEngine();
  const id=String(e.execute("vector.create",{path:"M0 0L200 0M0 100L200 100",x:40,y:100,props:{fill:"#ff0000"}}).id);
  e.execute("effect.add",{ids:[id],type:"dropShadow"});
  e.execute("shape.rectangle",{x:60,y:80,width:100,height:60});
  const doc=e.getSnapshot().document, depth=e.getUndoDepth();
  const hit=textPathAt(doc,{x:90,y:103},1);
  expect(hit).toEqual({pathId:id,startFraction:.25});
  expect(textPathAt(doc,{x:90,y:107},1)).toBeUndefined();
  expect(textPathAt(doc,{x:90,y:107},.5)).toBeDefined();
  expect(textPathAt(doc,{x:90,y:200},1)).toBeUndefined();
  e.beginTextEdit(hit!).finish();
  expect(e.getSnapshot().document).toBe(doc);
  expect(e.getUndoDepth()).toBe(depth);
  const session=e.beginTextEdit(hit!);
  e.execute("text.edit.insert",{text:"Along"});
  session.finish();
  const node=e.getSnapshot().document.nodes[session.node().id];
  expect(node).toMatchObject({kind:"text",width:200,text:{characters:"Along",path:{start:.25}}});
  expect(e.execute("node.get",{id:node.id})).toMatchObject({fills:[{color:"#FF0000"}],effects:[{type:"dropShadow"}]});
  expect(e.getSnapshot().document.nodes[id]).toBeUndefined();
  e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(doc);
});

it("measures in world space and preserves the distance along a non-uniformly scaled source",()=>{
  const e=new EditorEngine(), id=String(e.execute("vector.create",{path:"M0 0L100 100L200 100",x:0,y:0}).id);
  const doc=e.getSnapshot().document, source=doc.nodes[id];
  const scaled={...doc,nodes:{...doc.nodes,[id]:{...source,transform:[10,0,0,1,0,0] as const}}};
  const hit=textPathAt(scaled,{x:500,y:55},1);
  expect(hit?.pathId).toBe(id);
  expect(hit?.startFraction).toBeCloseTo((.500495* Math.sqrt(2))/(1+Math.sqrt(2)),5);
});

it("skips locked shapes, masked regions and the children of a rotated clipping frame outside its clip",()=>{
  const e=new EditorEngine();
  const m=e.execute("shape.ellipse",{x:0,y:0,width:50,height:50}).id;
  const r=e.execute("shape.rectangle",{x:0,y:0,width:100,height:100}).id;
  e.execute("object.mask",{ids:[m,r]});
  e.execute("shape.rectangle",{x:400,y:100,width:100,height:100,props:{locked:true}});
  const f=e.execute("frame.create",{x:300,y:0,width:100,height:100,props:{clip:true}}).id;
  const l=String(e.execute("vector.create",{path:"M0 0L40 0",x:-60,y:50,parent:f}).id);
  e.execute("node.set",{id:f,props:{rotation:45}});
  const doc=e.getSnapshot().document, hidden=transformPoint(worldTransform(doc,l),{x:20,y:0});
  for (const point of [{x:100,y:50},{x:400,y:150},hidden]) expect(textPathAt(doc,point,1)).toBeUndefined();
});

it("matches all 432 captured native pointer decisions and fractional starting offsets",()=>{
  for (const {command,points} of cases) {
    const e=new EditorEngine();
    const id=String(e.execute(String(command[0]),command[1]).id);
    for (const [x,y,zoom,start] of points) {
      const hit=textPathAt(e.getSnapshot().document,{x:x!,y:y!},zoom!);
      if (start===null) expect(hit).toBeUndefined();
      else {
        expect(hit?.pathId).toBe(id);
        expect(hit?.startFraction).toBeCloseTo(start,12);
      }
    }
  }
});
