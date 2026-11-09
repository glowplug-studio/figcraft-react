import { renderDocument } from "../../src/engine/canvas";
import { blendModes } from "../../src/engine/blend";
import { EditorEngine } from "../../src/engine/editor";

export function layerBlendPixels(canvas:HTMLCanvasElement) {
  canvas.width=120; canvas.height=120;
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const e=new EditorEngine();
  const bottom=e.execute("shape.rectangle",{props:{fill:"#cc6633"}}).id;
  const top=e.execute("shape.rectangle",{props:{fill:"#66ccee"}}).id;
  const sample=(x:number,y:number)=>[...ctx.getImageData(x,y,1,1).data];
  const draw=()=>renderDocument(ctx,e.getSnapshot().document,120,120);
  const layers=blendModes.map(mode=>{
    e.execute("node.set",{id:top,props:{blend:mode}});
    draw();
    return sample(50,50);
  });
  e.execute("node.set",{id:bottom,props:{fill:"yellow"}});
  e.execute("node.set",{id:top,props:{visible:false}});
  const frame=e.execute("frame.create",{x:20,y:20,width:50,height:50,props:{fills:[],clip:true,cornerRadius:10}}).id;
  e.execute("shape.rectangle",{parent:frame,x:-10,y:-10,props:{fill:"cyan",blend:"multiply"}});
  draw();
  const pass=[sample(50,50),sample(15,25),sample(20,20)];
  e.execute("node.set",{id:frame,props:{blend:"normal"}});
  draw();
  return {layers,pass,isolated:sample(50,50)};
}
