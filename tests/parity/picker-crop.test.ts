import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { rectanglePaints, type LayerNode } from "../../src/engine/document";
import { pickerCropTarget } from "../../src/engine/image-commands";
import { base64Bytes } from "../../src/engine/recovery";

// Restates native crates/ui-egui/src/crop_image_tests.rs at bad07e44 (upstream 8330ffb3, a54eafc0, #2150):
// `crop_in_the_colour_picker_only_sets_the_mode_where_crop_image_does_not_apply` and its `crop_on_canvas` checks.
const data=base64Bytes(readFileSync(new URL("../fixtures/images/six-pixels.png",import.meta.url)));
afterEach(()=>vi.unstubAllGlobals());

it("crops on the canvas only one layer's own image fill, as native crop_on_canvas does",async ()=>{
  vi.stubGlobal("createImageBitmap",async()=>({width:3,height:2,close(){}}));
  const engine=new EditorEngine();
  const {id}=await engine.executeAsync("image.place",{data,width:200,height:100,x:0,y:0});
  const layer=String(id), rect=String((engine.execute("shape.rectangle",{x:300,y:0,width:50,height:50}) as {id:string}).id);
  const picture=rectanglePaints(engine.getSnapshot().document.nodes[layer] as LayerNode)[0];
  const doc=()=>engine.getSnapshot().document, fill={list:"fill" as const,index:0};
  expect(pickerCropTarget(doc(),[layer],fill,false)).toEqual({id:layer,index:0});
  expect(pickerCropTarget(doc(),[rect],fill,false),"a solid fill").toBeUndefined();
  expect(pickerCropTarget(doc(),[layer],{list:"fill",index:1},false),"no fill there").toBeUndefined();
  expect(pickerCropTarget(doc(),[layer],{...fill,styleId:"S:1"},false),"a style").toBeUndefined();
  expect(pickerCropTarget(doc(),[layer],fill,true),"a region's fill in vector edit mode").toBeUndefined();
  engine.execute("stroke.add",{ids:[layer],paint:picture});
  expect(pickerCropTarget(doc(),[layer],{list:"stroke",index:0},false),"a stroke").toBeUndefined();
  engine.execute("fill.set",{ids:[rect],index:0,paint:picture});
  expect(pickerCropTarget(doc(),[layer,rect],fill,false),"two layers").toBeUndefined();
  expect(pickerCropTarget(doc(),[rect],fill,false)).toEqual({id:rect,index:0});
  expect(pickerCropTarget(doc(),["1"],fill,false),"the page").toBeUndefined();
});
