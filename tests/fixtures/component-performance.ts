import { newDocument, type DocumentNode } from "../../src/engine/document";
import { newComponentKind } from "../../src/engine/component-properties";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { assetDropSlot, assetSwapTarget } from "../../src/engine/component-assets";
import { worldRenderBounds } from "../../src/engine/render-bounds";
import nativeThumbnails from "./native-asset-thumbnails.json";
import { renderAssetThumbnail, renderDocument } from "../../src/engine/canvas";

export async function prepareComponents(canvas:HTMLCanvasElement, mains:number) {
  const base = newDocument(), nodes:Record<string,DocumentNode> = {...base.nodes};
  const roots:string[] = [];
  for (let block=0;block<1000;block++) {
    const id = String(2+block*10), isMain = block < mains;
    const main = String(2+(block%mains)*10);
    const frame = {id,parent:"1",name:"Card "+(block%mains),x:(block%50)*72,y:Math.floor(block/50)*66,
      width:64,height:54,fill:"#ffffff",clip:true,children:Array.from({length:9},(_,i)=>String(Number(id)+i+1))};
    roots.push(id);
    nodes[id] = isMain ? {...frame,...newComponentKind} : {...frame,kind:"instance",component:main,source:main,props:{}};
    for (const [i,child] of frame.children.entries()) {
      nodes[child] = {id:child,parent:id,kind:"rectangle",name:"Part "+i,x:(i%3)*20,y:Math.floor(i/3)*18,
        width:14,height:12,fill:"#8090a0",...(!isMain && {source:String(Number(main)+i+1)})};
    }
  }
  nodes["1"] = {...base.nodes["1"],kind:"page",parent:null,children:roots,background:"#f5f5f5"};
  const engine = new EditorEngine();
  await engine.executeAsync("file.open",{data:base64Bytes(await encodeFigcraft({...base,nodes},"10002"))});
  const doc = engine.getSnapshot().document, first = doc.nodes["2"];
  if (first.kind !== "component") throw Error("Missing main");
  canvas.width = 640; canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  const view = {cx:320,cy:220,vw:640,vh:400,zoom:1};
  const p95 = (samples:number[])=>samples.sort((a,b)=>a-b)[Math.floor(samples.length*.95)];
  return async ()=>{
    const inputs:number[] = [],frames:number[] = [];
    let publications=0, hits=0;
    const unsubscribe = engine.subscribe(()=>publications++);
    for (let i=0;i<70;i++) {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const start = performance.now(), point = {x:4+(i%8)*72,y:4+(2+i%4)*66};
      if (assetSwapTarget(doc,point,first)) hits++;
      assetDropSlot(doc,point);
      const resolved = performance.now();
      renderDocument(ctx,doc,640,400,[],undefined,view);
      if (i>=10) {inputs.push(resolved-start);frames.push(performance.now()-start);}
    }
    unsubscribe();
    const started = performance.now();
    engine.execute("node.set",{id:"3",props:{opacity:.42}});
    const editMs = performance.now()-started;
    const edited = engine.getSnapshot().document;
    const changedCopies = Object.values(edited.nodes).filter(node=>node.source === "3" && node.kind === "rectangle" && Math.abs((node.opacity ?? 1)-.42)<1e-7).length;
    engine.execute("edit.undo");
    return {nodes:Object.keys(doc.nodes).length,instances:1000-mains,hits,publications,inputP95:p95(inputs),frameP95:p95(frames),
      editMs,changedCopies,restored:engine.getSnapshot().document.nodes === doc.nodes};
  };
}

export async function compareThumbnails(canvas:HTMLCanvasElement) {
  const results=[];
  for (const fixture of nativeThumbnails) {
    const e=new EditorEngine();
    for (const [command,params] of fixture.steps) e.execute(String(command),params);
    const doc=e.getSnapshot().document, id=String(fixture.id);
    const bounds=worldRenderBounds(doc,id)!;
    await renderAssetThumbnail(canvas,doc,id,fixture.side,new AbortController().signal);
    const ctx=canvas.getContext("2d")!;
    results.push({name:fixture.name,bounds:[bounds.x,bounds.y,bounds.x+bounds.width,bounds.y+bounds.height],
      size:[canvas.width,canvas.height],pixels:fixture.samples.map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data))});
  }
  return results;
}
