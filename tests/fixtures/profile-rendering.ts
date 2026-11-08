import { renderDocument } from "../../src/engine/canvas";
import { newDocument, type DocumentNode } from "../../src/engine/document";
import { solidPaint } from "../../src/engine/solid-paint";
import { colour } from "../../src/engine/colour";

export async function profileFrames(canvas: HTMLCanvasElement) {
  const base = newDocument(), nodes: Record<string, DocumentNode> = {}, children: string[] = [];
  for (let i = 0; i < 9999; i++) {
    const id = String(i + 2);
    children.push(id);
    nodes[id] = {id, kind:"rectangle", name:"Colour", parent:"1", x:i < 100 ? 80 * (i%10) : 15000+i,
      y:i < 100 ? 60 * Math.floor(i/10) : 15000, width:60, height:50, fill:"#20e060"};
  }
  const page = base.nodes["1"];
  if (page.kind !== "page") throw Error("Missing page");
  nodes["1"] = {...page, children};
  // A translucent P3 red over a P3 green distinguishes proofing before and after the blend.
  nodes["2"] = {...nodes["2"], kind:"rectangle",parent:"1",x:0,y:0,width:60,height:50,fill:"transparent",
    fills:[solidPaint(colour(0,1,0)), solidPaint(colour(1,0,0,.5))]};
  const doc = {...base, colourProfile:"displayP3" as const, nodes};
  canvas.width=1200; canvas.height=800;
  const ctx=canvas.getContext("2d")!, timings: number[]=[];
  for (let i=0;i<65;i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    renderDocument(ctx, doc, 1200, 800, [], undefined, {cx:600+(i%10),cy:400,zoom:1,vw:1200,vh:800});
    if (i>=10) timings.push(performance.now()-start);
  }
  return {pixel:[...ctx.getImageData(20,20,1,1).data], p95:timings.sort((a,b)=>a-b)[Math.floor(.95*timings.length)]};
}
