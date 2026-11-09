import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft} from "../../src/engine/file-format";

const bytes=(name:string)=>readFileSync(new URL("../fixtures/native-swap-"+name+".figcraft",import.meta.url));

it.each(["complete","partial"])("matches a %s native library swap, including history replay",async scenario=>{
  const e=new EditorEngine();
  const paths=new Map<string,string>();
  for (const name of ["Ocean","Forest"]) {
    const link=await e.pickLibrary(new File([bytes(name.toLowerCase())],name+".figcraft"));
    if (typeof link.path!=="string") throw Error("Missing library path");
    paths.set(link.path,"/versions/"+name+".figcraft");
  }
  const saved=async()=>{
    const {document}=await decodeFigcraft(await e.nativeSnapshot());
    return {...document,libraryLinks:document.libraryLinks?.map(l=>({...l,path:paths.get(l.path)}))};
  };
  e.execute("library.place",{library:"Ocean",component:"Button",x:0,y:0});
  await e.executeAsync("text.set",{id:6,characters:"Buy"});
  e.execute("shape.rectangle",{x:0,y:80,width:15,height:15});
  e.execute("library.applyStyle",{library:"Ocean",style:"Brand",ids:[7]});
  e.execute("shape.rectangle",{x:50,y:80,width:15,height:15});
  e.execute("library.bindVariable",{library:"Ocean",variable:"accent",field:"fill",ids:[8]});
  const partial=scenario==="partial";
  if (partial) {
    e.execute("library.place",{library:"Ocean",component:"Only in A",x:300,y:0});
    e.execute("library.extendCollection",{library:"Ocean",collection:"Theme"});
  }
  const before=await saved(),depth=e.getUndoDepth();
  for (const to of ["Missing","Ocean"]) expect(()=>e.execute("library.swap",{from:"Ocean",to})).toThrow();
  expect(e.getUndoDepth()).toBe(depth);
  expect(e.execute("library.swap",{from:"Ocean",to:"Forest"})).toEqual({components:1,styles:1,variables:1,
    removed:!partial,unmatched:partial ? ["component Only in A","extended collection Theme (extended)"] : []});
  const native=async(stage:string)=>(await decodeFigcraft(bytes(scenario+"-"+stage))).document;
  expect(await saved()).toEqual(await native("swapped"));
  e.execute("edit.undo");expect(await saved()).toEqual(before);
  e.execute("edit.redo");expect(await saved()).toEqual(await native("redo"));
});
