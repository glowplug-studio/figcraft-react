import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";
import { decodeFigcraft } from "../../src/engine/file-format";
import { nodeFills } from "../../src/engine/style-application";

const native=readFileSync(new URL("../fixtures/native-layer-variables.json",import.meta.url));
const base="VariableID:1",accent="VariableID:2";
async function opened() {
  const e=new EditorEngine();
  await e.executeAsync("file.open",{data:base64Bytes(native)});
  return e;
}

it("settles bound native paint alpha in the saved baseline and detaches only edited colours",async()=>{
  const e=await opened(),node=()=>e.getSnapshot().document.nodes[2];
  expect(node().boundVariables).toEqual({fill:accent});
  expect(nodeFills(node())[0]).toMatchObject({opacity:1,colorAlpha:1,color:{a:.375}});
  e.execute("fill.set",{id:2,opacity:.25});
  expect(node().boundVariables).toEqual({fill:accent});
  e.execute("variable.bind",{id:2,field:"fill",variable:null});
  expect(nodeFills(node())[0]).toMatchObject({color:{a:1},opacity:.09375,colorAlpha:.375});
  e.execute("edit.undo");
  expect(node().boundVariables).toEqual({fill:accent});
  e.execute("fill.set",{id:2,color:"#123456"});
  expect(node().boundVariables).toBeUndefined();
});

it("keeps bindings with equal-valued paints, saves raw IDs and folds alpha on variable deletion",async()=>{
  const e=await opened(),node=()=>e.getSnapshot().document.nodes[2];
  e.execute("fill.add",{id:2,paint:nodeFills(node())[0]});
  e.execute("variable.bind",{id:2,field:"fills/1/color",variable:"Accent"});
  e.execute("fill.move",{id:2,from:0,to:1});
  expect(node().boundVariables).toEqual({"fills/0/color":accent,"fills/1/color":accent});
  e.execute("fill.remove",{id:2,index:0});
  expect(node().boundVariables).toEqual({"fills/0/color":accent});
  e.execute("node.set",{id:2,boundVariables:JSON.parse('{"__proto__":"future-id","unknown":"missing"}')});
  e.execute("variable.delete",{variable:"Accent"});
  expect(nodeFills(node())[0]).toMatchObject({color:{a:1},opacity:.375});
  expect(Object.keys(node().boundVariables!).sort()).toEqual(["__proto__","unknown"]);
  const saved=(await decodeFigcraft(await e.nativeSnapshot())).document;
  expect(saved.nodes[2].boundVariables).toEqual(JSON.parse('{"__proto__":"future-id","unknown":"missing"}'));
});

it("moves direct bindings into a style and gives a qualified paint wrapper precedence over the style link",async()=>{
  const e=await opened(),node=()=>e.getSnapshot().document.nodes[2];
  const {id}=e.execute("style.create",{from:2,name:"Token",type:"paint"});
  expect(e.execute("style.list")[0]).toMatchObject({id,bound:{"fills/0/color":accent}});
  expect(node().boundVariables).toBeUndefined();
  e.execute("node.set",{id:2,props:{fillStyle:id,boundVariables:{"fills/0/color":"missing"},fill:{$var:"Theme/Base"}}});
  expect(node().boundVariables).toEqual({fill:base});
  expect(node().styles?.fill ?? null).toBeNull();
  expect(()=>e.execute("node.set",{id:2,props:{fill:{$var:"Spacing"}}})).toThrow();
  expect(()=>e.execute("node.set",{id:2,props:{width:{$var:"Spacing"}}})).toThrow();
  expect(node().boundVariables).toEqual({fill:base});
});

it("updates inherited scalar fields and retains same-value edits while releasing changed fields",async()=>{
  const e=await opened(),node=()=>e.getSnapshot().document.nodes[2];
  for (const field of ["width","opacity"]) e.execute("variable.bind",{id:2,field,variable:"Spacing"});
  e.execute("variable.bind",{id:2,field:"visible",variable:"Enabled"});
  e.execute("variable.setMode",{id:1,collection:"Density",mode:"Comfortable"});
  expect(node()).toMatchObject({width:13.75,opacity:Math.fround(.1375)});
  e.execute("node.set",{id:2,width:13.75});
  expect(node().boundVariables?.width).toBe("VariableID:6");
  e.execute("node.set",{id:2,width:30});
  expect(node().boundVariables?.width).toBeUndefined();
  expect(node().boundVariables?.opacity).toBe("VariableID:6");
  const prior=e.getSnapshot();
  expect(()=>e.execute("variable.bind",{ids:[2,999],field:"width",variable:"Spacing"})).toThrow();
  expect(e.getSnapshot()).toBe(prior);
});

it("keeps a gradient stop with its colour on removal and detaches only the stop edited explicitly",async()=>{
  const e=await opened(),node=()=>e.getSnapshot().document.nodes[2];
  const stops=[{position:0,color:"#000"},{position:.5,color:"#999"},{position:1,color:"#fff"}];
  e.execute("fill.set",{id:2,index:0,paint:{type:"gradient",kind:"linear",stops}});
  e.execute("variable.bind",{id:2,field:"fills/0/stops/2/color",variable:"Base"});
  const gradient=nodeFills(node())[0];
  if (gradient.type!=="gradient") throw new Error("Expected gradient");
  e.execute("fill.set",{id:2,index:0,paint:{...gradient,stops:gradient.stops.slice(1)}});
  expect(node().boundVariables).toEqual({"fills/0/stops/1/color":base});
  e.execute("variable.setMode",{id:1,collection:"Theme",mode:"Dark"});
  const dark=nodeFills(node())[0];
  if (dark.type!=="gradient") throw new Error("Expected gradient");
  expect(dark.stops[1].color.a).toBe(Math.fround(128/255));
  e.execute("fill.set",{id:2,index:0,paint:{...dark,stops:dark.stops.map(s=>({...s,color:"#fff"}))}});
  expect(node().boundVariables).toBeUndefined();
});

it("validates effect-specific fields and reindexes effect and grid bindings through ordered list edits",async()=>{
  const e=await opened(),node=()=>e.getSnapshot().document.nodes[2];
  e.execute("node.set",{id:2,props:{effects:[{type:"glass"},{type:"dropShadow"}],layoutGrids:[{},{}]}});
  expect(()=>e.execute("variable.bind",{id:2,field:"effects/1/refraction",variable:"Spacing"})).toThrow();
  for (const field of ["effects/0/depth","layoutGrids/1/count"]) e.execute("variable.bind",{id:2,field,variable:"Spacing"});
  e.execute("variable.bind",{id:2,field:"effects/1/color",variable:"Base"});
  expect(node().grids?.[1].count).toBe(7);
  e.execute("effect.move",{id:2,from:0,to:1});
  e.execute("grid.remove",{id:2,index:0});
  expect(node().effects?.[1]).toMatchObject({type:"glass",depth:6.5});
  expect(node().boundVariables).toMatchObject({"effects/1/depth":"VariableID:6","effects/0/color":base,"layoutGrids/0/count":"VariableID:6"});
  e.execute("effect.remove",{id:2,index:0});
  expect(node().boundVariables).toMatchObject({"effects/0/depth":"VariableID:6"});
  expect(node().boundVariables?.["effects/0/color"]).toBeUndefined();
});

it("resolves instance property variables after rebuilds and clears the binding on reset",async()=>{
  const e=await opened();
  const {id:main}=e.execute("node.create",{type:"component",name:"Card"});
  e.execute("component.addProperty",{id:main,type:"boolean",name:"Shown",default:false});
  const {id}=e.execute("instance.create",{component:main});
  const instance=()=>e.getSnapshot().document.nodes[String(id)];
  e.execute("variable.bind",{id,field:"componentProperties/Shown",variable:"Enabled"});
  expect(instance()).toMatchObject({props:{Shown:true},boundVariables:{"componentProperties/Shown":"VariableID:5"}});
  e.execute("variable.setMode",{id,collection:"Theme",mode:"Dark"});
  expect(instance()).toMatchObject({props:{Shown:false}});
  expect(()=>e.execute("variable.bind",{id,field:"componentProperties/Shown",variable:"Base"})).toThrow();
  e.execute("component.resetInstance",{id});
  expect(instance().boundVariables).toBeUndefined();
  e.execute("edit.undo");
  expect(instance().boundVariables).toEqual({"componentProperties/Shown":"VariableID:5"});
});

it("uses character fills for copy and layer edits, retaining mixed text on invalid removals and undo",async()=>{
  const e=await opened();
  const {id}=await e.executeAsync("text.create",{text:"Hello"});
  const text=()=>{
    const n=e.getSnapshot().document.nodes[String(id)];
    if (n.kind!=="text") throw new Error("Expected text");
    return n;
  };
  e.execute("text.style",{id,start:1,end:5,textFills:["#ffff00"]});
  const mixed=text();
  expect(()=>e.execute("fill.copy",{id})).toThrow();
  e.execute("fill.remove",{id,index:0});
  expect(text()).toBe(mixed);
  e.execute("fill.set",{id,color:"#0000ff"});
  expect(text().text.runs).toHaveLength(0);
  e.execute("edit.undo");
  expect(text()).toBe(mixed);
  e.execute("text.style",{id,start:0,end:5,textFills:["#00ff00"]});
  e.execute("fill.copy",{id});
  e.execute("fill.paste",{id:2,index:0});
  expect(e.getSnapshot().document.nodes[2].boundVariables).toBeUndefined();
  e.execute("fill.add",{id,color:"#ff00ff"});
  expect(nodeFills(text()).map(p=>p.type==="solid" && p.color.g)).toEqual([1,0]);
  expect(text().text.style.fills).toBeUndefined();
  e.execute("text.style",{id,start:0,end:5,textFills:["#ffaa11"]});
  e.execute("node.set",{id,fill:"#111"});
  expect(text().text.style.fills).toBeUndefined();
});

it("switches a bound component variant and its mirrored children across modes and undo",async()=>{
  const e=await opened();
  e.execute("variable.create",{collection:"Theme",name:"State",type:"string",values:{Light:"Default",Dark:"Variant2"}});
  const {id:first}=e.execute("node.create",{type:"component",name:"Button/Off"});
  e.execute("node.create",{type:"rectangle",name:"Icon",parent:first});
  const {id:second}=e.execute("node.create",{type:"component",name:"Button/On"});
  e.execute("node.create",{type:"ellipse",name:"Icon",parent:second});
  e.execute("component.combineVariants",{ids:[first,second]});
  const {id}=e.execute("instance.create",{component:first});
  const field="componentProperties/Property 1";
  e.execute("variable.bind",{id,field,variable:"State"});
  const initial=e.getSnapshot().document;
  e.execute("variable.setMode",{id,collection:"Theme",mode:"Dark"});
  const switched=e.getSnapshot().document,instance=switched.nodes[String(id)];
  if (instance.kind!=="instance") throw new Error("Expected an instance");
  expect(instance.component).toBe(second);
  expect(switched.nodes[instance.children[0]].kind).toBe("ellipse");
  e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(initial);
  e.execute("variable.set",{variable:"State",mode:"Light",value:"Missing variant"});
  expect(e.getSnapshot().document.nodes[String(id)]).toMatchObject({component:first,boundVariables:{[field]:initial.nodes[String(id)].boundVariables![field]}});
});

it("projects bound effect fields during a scrub, cancellation, commit and undo",async()=>{
  const e=new EditorEngine();
  const data=readFileSync(new URL("../fixtures/native-variable-inspectors.json",import.meta.url));
  await e.executeAsync("file.open",{data:base64Bytes(data)});
  e.execute("select.set",{ids:[2]});
  e.execute("variable.bind",{id:2,field:"effects/0/radius",variable:"Blur size"});
  const before=e.getSnapshot().document,depth=e.getUndoDepth(),shadow=before.nodes[2].effects![0];
  if (shadow.type!=="dropShadow") throw new Error("Expected a drop shadow");
  let publications=0;
  const stop=e.subscribe(()=>publications++);
  for (const commit of [false,true]) {
    const gesture=e.beginEffectPreview(0)!;
    gesture.preview({...shadow,radius:2,spread:5});
    expect(e.getRenderDocument().nodes[2].effects![0]).toMatchObject({radius:18,spread:5});
    expect(e.getSnapshot().document).toBe(before);
    expect(publications).toBe(0);
    if (commit) gesture.commit(); else gesture.cancel();
  }
  stop();
  expect(e.getSnapshot().document.nodes[2].effects![0]).toMatchObject({radius:18,spread:5});
  expect(e.getUndoDepth()).toBe(depth+1);
  e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(before);
});
