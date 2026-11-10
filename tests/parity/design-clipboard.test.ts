import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {expect,it} from "vitest";
import {hitRectangle, layersAt} from "../../src/engine/selection";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft} from "../../src/engine/file-format";

const archive=(name:string)=>unzipSync(readFileSync(new URL("../fixtures/"+name+".zip",import.meta.url)));
const cases=archive("native-design-clipboard"),files=archive("native-fig-imports");
it.each(Object.keys(cases).filter(p=>p.endsWith(".json")))("pastes external layers against native receipts and saved drawing for %s",async filename=>{
  const stem=filename.slice(0,-5),[name,route]=stem.split("__"),engine=new EditorEngine();
  const raw=Buffer.from(files[name+".fig"] ?? cases["copied-card.fig"]).toString("base64").replace(/=+$/,"");
  const encoded=raw.slice(0,8)+"\n"+raw.slice(8),html='<span data-buffer="<!--(figma)'+encoded+'(/figma)-->"></span>';
  if (route==="frame") {
    engine.execute("frame.create",{x:1000,y:0,width:800,height:600,name:"Host"});
    engine.execute("select.set",{ids:[2]});
  }
  const receipts=JSON.parse(new TextDecoder().decode(cases[filename])),before=engine.getSnapshot().document;
  const paste=engine.executeAsync("edit.pasteDesignLayers",route==="bare" ? {data:encoded} : {html,...(route==="here" && {x:72.25,y:-19})});
  if (receipts[0].error) {
    await expect(paste).rejects.toThrow(receipts[0].error);
    expect(engine.getSnapshot().document).toBe(before);
    return;
  }
  expect(await paste).toEqual(receipts[0]);
  if (route==="repeat") expect(engine.execute("edit.paste")).toEqual(receipts[1]);
  const expected=await decodeFigcraft(cases[stem+".figcraft"]);
  const saved=await engine.saveFile();
  expect((await decodeFigcraft(saved.data)).document).toEqual(expected.document);
  expect(engine.getSnapshot().selection.map(Number)).toEqual(receipts.at(-1).ids.filter((id:number)=>expected.document.nodes[String(id)]));
  if (route!=="repeat") {
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toEqual(before);
  }
});

it.each([
  [{}, "pass `html` or `data`"],
  [{html:"<b>hi</b>"}, "the HTML holds no copied design layers"],
  [{html:"(figma)ZmlnLQ"}, "the HTML holds no copied design layers"],
  [{html:"(figma)SGVsbG8=(/figma)"}, "the HTML holds no copied design layers"],
  [{data:"Zm=="}, "`data` is not base64"],
  [{data:"data:text/plain;base64,ZmlnLQ=="}, "`data` is not base64"],
  [{data:Buffer.from("PK not a zip").toString("base64")}, "the data is not copied design layers"],
] as const)("rejects %j and preserves the existing layer clipboard",async(params,reason)=>{
  const engine=new EditorEngine();
  engine.execute("frame.create",{name:"Original",width:12,height:12});
  engine.execute("edit.copy");
  const before=engine.getSnapshot().document;
  await expect(engine.executeAsync("edit.pasteDesignLayers",params)).rejects.toThrow(reason);
  expect(engine.getSnapshot().document).toBe(before);
  expect(engine.execute("edit.paste")).toEqual({ids:[3]});
});

it("cancels a pending design paste when editing access is revoked",async()=>{
  const engine=new EditorEngine(), before=engine.getSnapshot().document;
  const pending=engine.executeAsync("edit.pasteDesignLayers",{data:Buffer.from(cases["copied-card.fig"]).toString("base64")});
  engine.setEditable(false);
  await expect(pending).rejects.toThrow("Paste was cancelled");
  expect(engine.getSnapshot().document).toBe(before);
  expect(engine.hasCopiedLayers()).toBe(false);
});

it.each([["shown","3"],["hidden","2"]])("deep hits respect the %s Section in the native document",async(name,expected)=>{
  const sections=archive("native-section-contents");
  const {document}=await decodeFigcraft(sections[name+".figcraft"]);
  expect(hitRectangle(document,{x:60,y:60},true)).toBe(expected);
  expect(layersAt(document,{x:60,y:60},0,[]).layers.map(node=>node.id)).toEqual(name==="shown" ? [2,3] : [2]);
});
