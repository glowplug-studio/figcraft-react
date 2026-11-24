import { expect,it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { FontLibrary } from "../../src/engine/font-library";
import { readFontFaces } from "../../src/engine/font-source";
import native from "../fixtures/native-loaded-font-priority.json" with {type:"json"};
import { retitledFont } from "../support/renamedFont";

type Font=["Bold"|"Italic"|"Regular"|"SemiBold",string,string];

for (const scene of native.cases) {
  it("a font loaded with text.loadFont wins over built-in and earlier loaded faces as native does: "+scene.name,async ()=>{
    const e=new EditorEngine();
    for (const step of scene.steps) {
      const font=(step.params as {font?:Font}).font;
      const params=font ? {data:(await retitledFont(...font)).toString("base64")} : step.params;
      const receipt=await e.executeAsync(step.command,params);
      // Native has no embedded fonts, so its Inter lists only the loaded style; the port keeps its built-in ones.
      if (step.command==="text.fonts" && scene.name==="builtin") expect(receipt).toContain("Regular");
      else if (step.command==="node.get") {
        const {width,height,fontFamily,fontStyle}=receipt as Record<string,unknown>;
        expect({width,height,fontFamily,fontStyle}).toEqual(step.receipt);
      } else if (step.command==="text.create") expect(Number((receipt as {id:string}).id)).toBe((step.receipt as {id:number}).id);
      else expect(receipt).toEqual(step.receipt);
    }
  });
}

it("keeps a loaded face ahead of faces added after it and of other styles' built-in faces",async ()=>{
  const face=async (source:Font[0],style:string,family="Brand Sans")=>(await readFontFaces(await retitledFont(source,family,style)))[0];
  const db=new FontLibrary();
  const builtIn=await face("Regular","Regular"), bold=await face("Bold","Bold");
  db.add(builtIn); db.add(bold);
  expect(db.find("Brand Sans","Regular")).toBe(builtIn);
  const loaded=await face("SemiBold","Regular");
  db.addLoaded(loaded);
  expect(db.find("Brand Sans","Regular")).toBe(loaded);
  expect(db.find("Brand Sans","Bold")).toBe(bold);
  const latest=await face("Bold","Regular");
  db.addLoaded(latest);
  expect(db.find("Brand Sans","Regular")).toBe(latest);
  db.add(await face("Italic","Regular"));
  expect(db.find("Brand Sans","Regular")).toBe(latest);
  // Loading the same face again does not move it ahead of a later load.
  db.addLoaded(loaded);
  expect(db.find("Brand Sans","Regular")).toBe(latest);
});
