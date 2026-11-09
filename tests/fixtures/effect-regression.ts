import { renderDocument } from "../../src/engine/canvas";
import { newDocument, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { readEffect } from "../../src/engine/effects";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";

export async function prepareEffectEdits(canvas: HTMLCanvasElement) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = {...initial.nodes}, children: string[] = [];
  for (let i = 0; i < 9998; i++) {
    const id = String(i + 2);
    children.push(id);
    nodes[id] = {id, parent:"1", kind:"rectangle", name:"Backdrop", width:40, height:32,
      x:i < 100 ? i % 10 * 60 : 3000 + i, y:i < 100 ? Math.floor(i / 10) * 45 : 3000, fill:"#247a82"};
  }
  const id = "10000";
  children.push(id);
  const glass = readEffect({type:"glass",depth:14,dispersion:.6,frost:2}, "archive");
  if (glass.type !== "glass") throw new Error("Expected glass");
  nodes[id] = {id,parent:"1",kind:"ellipse",name:"Glass",x:150,y:100,width:76,height:48,start:0,sweep:Math.PI*2,inner:0,
    fills:[],fill:"transparent",effects:[glass,readEffect({type:"dropShadow",radius:3,offset:[2,2]}, "archive")]};
  nodes["1"] = {...initial.nodes["1"],kind:"page",parent:null,background:"#fcf8ef",children};
  const engine = new EditorEngine();
  await engine.executeAsync("file.open",{data:base64Bytes(await encodeFigcraft({...initial,nodes}, "10001"))});
  engine.execute("select.set",{ids:[id]});
  const width = canvas.width = 800, height = canvas.height = 500;
  const ctx = canvas.getContext("2d",{willReadFrequently:true})!;
  const draw = () => renderDocument(ctx,engine.getRenderDocument(),width,height);
  const base = engine.getSnapshot().document;
  let publications = 0;
  engine.subscribe(()=>publications++);
  return async () => {
    const gesture = engine.beginEffectPreview(0)!;
    const inputs: number[] = [], frames: number[] = [];
    for (let i = 0; i < 120; i++) {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const start = performance.now();
      gesture.preview({...glass,splay: i / 120});
      const input = performance.now() - start;
      draw();
      if (i >= 10) { inputs.push(input); frames.push(performance.now() - start); }
    }
    const pixel = Array.from(ctx.getImageData(151,124,1,1).data);
    gesture.cancel();
    const p95 = (t: number[]) => t.sort((a,b)=>a-b)[Math.floor(.95 * t.length)];
    return {nodes:Object.keys(base.nodes).length,frames:frames.length,inputP95:p95(inputs),frameP95:p95(frames),
      publications,restored:engine.getRenderDocument() === base,pixel};
  };
}

// Compare the retained part of a band against the whole view. Upstream
// glass_cut_tests includes a backdrop halo before comparing any pixels.
export function cutGlass(radius: number, smoothing: number, scale: number, huge: boolean) {
  const engine = new EditorEngine();
  const colours = ["#e03030","#2040e0","#20c060","#f0c830"];
  for (let i = 0; i < 32; i++) engine.execute("shape.rectangle",{x:i*12, y:0, width:12,height:350,props:{fill:colours[i%4]}});
  engine.execute("shape.rectangle",{x:18.25,y:19.125,width:huge?1600:165,height:huge?1100:112,
    props:{fills:[],cornerRadius:radius,cornerSmoothing:smoothing,effects:[
      {type:"glass",depth:15,lightAngle:25,lightIntensity:.9,frost:3,refraction:.7,splay:.4,dispersion:1}]}});
  const doc = engine.getSnapshot().document, width = 330, height = 250;
  const render = (top: number, h: number) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = h;
    const ctx = canvas.getContext("2d",{willReadFrequently:true})!;
    renderDocument(ctx,doc,width,h,[],undefined,{cx:width/(2*scale),cy:(top+h/2)/scale,zoom:scale,vw:width,vh:h});
    const pixels = ctx.getImageData(0,0,width,h).data;
    canvas.width=canvas.height=0;
    return pixels;
  };
  const full = render(0,height), margin = Math.ceil((1.5*3 + .7*15*(1+.16))*scale+3)+1;
  const examples: number[][] = [];
  let different = 0, worst = 0;
  for (const top of [64,100,140]) {
    const part = render(top-margin,32+2*margin);
    for (let k = 0; k < 32*width*4; k++) {
      const delta = Math.abs(full[top*width*4+k]-part[margin*width*4+k]);
      if (delta) { if (examples.length < 12) examples.push([top,Math.floor(k/4)%width,top+Math.floor(k/(width*4)),delta]);different++; }
      worst = Math.max(worst,delta);
    }
  }
  return {different,worst,...(different && {examples})};
}

/** Seven native effect records on the same striped background, reading left to right. */
export function effectSamples(canvas: HTMLCanvasElement) {
  const engine = new EditorEngine(), width = canvas.width = 384, height = canvas.height = 176;
  engine.execute("page.setBackground",{color:"#faf8ee"});
  for (let x=0;x<width;x+=16) engine.execute("shape.rectangle",{x,y:0,width:8,height,props:{fill:"#b5cbd1"}});
  const effects = [
    {type:"dropShadow",radius:4,offset:[7,4],color:"#5a1834"},
    {type:"innerShadow",radius:4,offset:[6,4],color:"#3b182b"},
    {type:"layerBlur",blurType:"progressive",startRadius:0,radius:9},
    {type:"backgroundBlur",radius:11},
    {type:"noise",mode:"duo",size:.8,density:.65,color:"#8bcfc0",secondary:"#194954"},
    {type:"texture",size:1,radius:5},
    {type:"glass",depth:16,frost:1,dispersion:.7,lightAngle:-35,lightIntensity:.8,refraction:.8,splay:.5},
  ];
  effects.forEach((e,i)=>engine.execute("shape.rectangle",{x:14+i%4*96,y:14+Math.floor(i/4)*86,
    width:62,height:55,props:{cornerRadius:10,...(i===3 || i===6?{fills:[]}:{fill:"#3e8590"}),effects:[e]}}));
  renderDocument(canvas.getContext("2d")!,engine.getSnapshot().document,width,height);
}
