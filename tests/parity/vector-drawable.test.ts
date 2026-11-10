import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { renderDrawable } from "../../src/engine/vector-drawable/export";
import cases from "../fixtures/native-vector-drawable.json";

const outlineCases=new Set(["outside stroke","fitted line","closed dash","odd dash","square dash","butt dash",
  "two dash subpaths","curved dash"].map(name=>name+" bestEffort"));

it.each(cases)("exports the pinned Android drawable for $name",async({commands,xml,warnings,name})=>{
  const engine=new EditorEngine();
  for (const [command,input] of commands.slice(0,-1)) {
    if (command==="text.create") await engine.executeAsync(command,input);
    else engine.execute(String(command),input);
  }
  const {document,selection}=engine.getSnapshot();
  const result=await renderDrawable(document,selection,commands.at(-1)![1] as Record<string,unknown>);
  expect(result.warnings).toEqual(warnings);
  const actual=await result.blob.text();
  // The arrangement and stroke libraries may start or subdivide contours differently.
  // The browser suite checks the painted area of each of these paths independently.
  if (outlineCases.has(name)) {
    const attributes=(s:string)=>s.replace(/android:pathData="[^"]+"/g,"");
    expect(attributes(actual)).toBe(attributes(xml));
  } else expect(actual).toBe(xml);
});

it("rejects over-depth drawables before writing paths",async()=>{
  const {deepPatternDocument}=await import("../fixtures/svg-depth");
  const doc=deepPatternDocument(258,1);
  await expect(renderDrawable(doc,["2"],{})).rejects.toThrow(/maximum export depth of 256/);
  expect(await (await renderDrawable(doc,["3"],{})).blob.text()).toContain("<vector");
});

it("preserves XML warnings for direct, separate and zipped export commands",async()=>{
  const engine=new EditorEngine();
  engine.execute("shape.rectangle",{name:"Asset",width:20,height:18,props:{visible:false}});
  engine.execute("export.add",{setting:{format:"vd"}});
  const direct=await engine.executeAsync("file.export",{format:"vectorDrawable"});
  expect(direct).toMatchObject({format:"xml",warnings:["nothing in it could be drawn: the drawable is empty (Asset)"]});
  for (const zip of [true,false]) {
    const result=await engine.executeAsync("file.exportLayers",{zip});
    expect(result.files).toMatchObject([{name:"Asset.xml",warnings:direct.warnings}]);
  }
  const quiet=await engine.executeAsync("file.exportLayers",{vdCompat:"ignore"});
  expect(quiet.files).toMatchObject([{warnings:[]}]);
});
