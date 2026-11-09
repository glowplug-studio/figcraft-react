import {EditorEngine} from "../../src/engine/editor";
import {renderDocument} from "../../src/engine/canvas";
import {encodeFigcraftBlob} from "../../src/engine/file-format";
import type {DocumentNode} from "../../src/engine/document";

export async function prepareTextBenchmark() {
  const e=new EditorEngine();
  await e.executeAsync("text.create",{text:"Label 0",x:4,y:4});
  const initial=e.getSnapshot().document,seed=initial.nodes["2"],page=initial.nodes["1"];
  if (seed.kind!=="text" || page.kind!=="page") throw new Error("Missing fixture text or page");
  const nodes:Record<string,DocumentNode>={...initial.nodes},children=[];
  for (let i=0;i<9999;i++) {
    const id=String(i+2),x=(i%10)*110+4,y=Math.floor(i/10)*80+4;
    nodes[id]={...seed,id,x,y,width:80,text:{...seed.text,characters:"Label "+i}};
    children.push(id);
  }
  nodes["1"]={...page,children};
  const blob=await encodeFigcraftBlob({...initial,nodes},"10001");
  await e.openFile(new File([blob],"text.figcraft"));
  e.execute("view.set",{cx:550,cy:400,vw:1100,vh:800,zoom:1});
  const canvas=document.createElement("canvas");canvas.width=1100;canvas.height=800;
  const ctx=canvas.getContext("2d")!;
  e.execute("text.edit.begin",{id:2,caret:7});
  const draw=()=>renderDocument(ctx,e.getRenderDocument(),1100,800,[],undefined,e.getView());
  await draw();
  return async ()=>{
    const input:number[]=[],frames:number[]=[];
    let notifications=0;const off=e.subscribe(()=>notifications++);
    for (let i=0;i<120;i++) {
      await new Promise<void>(r=>requestAnimationFrame(()=>r()));
      const t=performance.now();
      e.execute("text.edit.caret",{index:6});
      e.execute("text.edit.caret",{index:7,extend:true});
      e.execute("text.edit.insert",{text:i%2===0 ? "Ω" : "0"});
      const applied=performance.now()-t;
      await draw();
      if (i>=10) {input.push(applied);frames.push(performance.now()-t);}
    }
    const rootNotifications=notifications;off();
    const result=e.getRenderDocument().nodes["2"];
    const count=Object.keys(e.getRenderDocument().nodes).length;
    e.execute("text.edit.end");
    const p95=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length*.95)];
    return {nodes:count,visible:100,frames:frames.length,inputP95:p95(input),frameP95:p95(frames),rootNotifications,
      text:result.kind==="text" && result.text.characters};
  };
}
