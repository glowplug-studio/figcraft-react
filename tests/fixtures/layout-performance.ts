import { newDocument, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { readAutoLayout } from "../../src/engine/auto-layout";
import { LayoutSpacingInteraction } from "../../src/engine/layout-spacing-interaction";
import { MoveInteraction } from "../../src/engine/move-interaction";

export async function prepareLayout(canvas: HTMLCanvasElement, grid: boolean, dense: boolean) {
  const base = newDocument(), nodes: Record<string,DocumentNode> = {...base.nodes};
  const parents: string[] = [], frameCount = dense ? 1 : 100;
  let next = 2;
  for (let i=0; i<frameCount; i++) {
    const id = String(next++), children: string[] = [];
    parents.push(id);
    const count = dense ? 9998 : i === 0 ? 98 : 99;
    for (let j=0; j<count; j++) {
      const child = String(next++);
      children.push(child);
      nodes[child] = {id: child, parent:id, kind:"rectangle", name:child, width:40, height:30,
        x:j%10*50, y:Math.floor(j/10)*40, fill:"#c0c8d0"};
    }
    nodes[id] = {id, parent:"1", kind:"frame", name:"Board "+i, width:490, height:Math.ceil(count/10)*40-10,
      x:i*2000, y:0, fill:"#ffffff", clip:true, children,
      layout:readAutoLayout({mode:grid ? "grid" : "horizontal",grid_columns:10,grid_rows:Math.ceil(count/10),
        wrap:!grid,padding:[0,0,0,0],gap:10,cross_gap:10})};
  }
  nodes[1] = {...base.nodes[1],kind:"page",parent:null,background:"#f5f5f5",children:parents};
  const engine = new EditorEngine();
  await engine.executeAsync("file.open",{data:base64Bytes(await encodeFigcraft({...base,nodes},String(next)))});
  const width = 600, height = 400;
  canvas.width=width; canvas.height=height;
  engine.execute("view.set",{cx:width/2,cy:height/2,vw:width,vh:height,zoom:1});
  const context = canvas.getContext("2d")!, handles = new LayoutSpacingInteraction(engine);
  const moving = new MoveInteraction(engine, message => { throw Error(message); });
  const modifiers = {altKey:false,ctrlKey:false,shiftKey:false,metaKey:false};
  engine.execute("select.set",{id:grid ? "2" : "3"});
  return async () => {
    const began = grid ? handles.down({x:45,y:15}) : moving.down({x:20,y:15},modifiers);
    if (!began) throw Error("Layout gesture did not start");
    const original = engine.getSnapshot().document;
    let publications=0;
    engine.subscribe(()=>publications++);
    const input: number[] = [], frame: number[] = [];
    for (let i=0; i<70; i++) {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const t = performance.now();
      if (grid) handles.move({x:45+(i%10),y:15},false);
      else moving.move({x:20+(i%10)*50,y:55+Math.floor(i/10)*40},modifiers);
      const elapsed=performance.now()-t;
      renderDocument(context,engine.getRenderDocument(),width,height,engine.getRenderSelection(),undefined,engine.getView());
      if (grid) handles.draw(context); else moving.draw(context);
      if (i>=10) {input.push(elapsed); frame.push(performance.now()-t);}
    }
    const previewChanged = engine.getRenderDocument() !== original;
    if (grid) handles.cancel(); else moving.cancel();
    const p95 = (sample:number[]) => sample.sort((a,b)=>a-b)[Math.ceil(sample.length*.95)-1];
    return {nodes:Object.keys(nodes).length,frames:frameCount,measured:frame.length,previewChanged,
      restored:engine.getRenderDocument()===original,publications,inputP95:p95(input),frameP95:p95(frame)};
  };
}
