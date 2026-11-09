import {renderDocument} from "../../src/engine/canvas";
import {EditorEngine} from "../../src/engine/editor";
import {reserveLayerPixels} from "../../src/engine/mask-renderer";

function scene(canvas:HTMLCanvasElement) {
  canvas.width=210; canvas.height=180;
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const engine=new EditorEngine();
  engine.execute("page.setBackground",{color:"transparent"});
  const id=String(engine.execute("shape.rectangle",{x:24,y:26,width:60,height:60,props:{fill:"#808080"}}).id);
  const set=(effects:Record<string,unknown>[])=>engine.execute("node.set",{id,props:{effects}});
  const draw=()=>{
    renderDocument(ctx,engine.getSnapshot().document,210,180);
    return ctx.getImageData(0,0,210,180).data;
  };
  return {ctx,engine,id,set,draw};
}
export function grainScene(canvas:HTMLCanvasElement) {
  const {set,draw,id}=scene(canvas);
  const noise={type:"noise",size:.5,density:1,color:"red",secondary:"blue"};
  const sample=(data:Uint8ClampedArray,x:number,y:number)=>Array.from(data.slice((y*210+x)*4,(y*210+x)*4+4));
  set([noise]);const mono=sample(draw(),30,30);
  set([{...noise,blend:"multiply",color:"white"}]);const multiply=sample(draw(),30,30);
  set([{...noise,mode:"duo",density:.3}]);
  const duo=draw();const colours:Record<string,number>={};
  for(let y=26;y<86;y++) for(let x=24;x<84;x++) {
    const col=sample(duo,x,y).join(","); colours[col]=(colours[col]??0)+1;
  }
  set([{...noise,mode:"multi",opacity:1,size:2,sizeY:1}]);const multi=draw();
  return {id,mono,multiply,colours,anisotropic:[[24,26],[27,27],[28,26],[24,28]].map(([x,y])=>sample(multi,x,y))};
}

export function grainEdges(canvas:HTMLCanvasElement) {
  const {ctx,set,draw}=scene(canvas);
  const texture={type:"texture",size:.5,radius:10};
  const noise={type:"noise",color:"red",secondary:"green",mode:"duo",density:1,size:.5};
  const outside=(data:Uint8ClampedArray)=>{
    let count=0;
    for(let y=0;y<180;y++) for(let x=0;x<210;x++) if((x<24||x>=84||y<26||y>=86) && data[(y*210+x)*4+3]) count++;
    return count;
  };
  set([texture]); const rough=outside(draw());
  set([{...texture,clipToShape:true}]); const clipped=outside(draw());
  set([noise,texture]); const first=draw();
  set([texture,noise]); const second=draw();
  let changed=0;
  for(let i=0;i<first.length;i+=4) if(first[i]!==second[i]||first[i+1]!==second[i+1]) changed++;
  // Identical page pixels from a viewport patch whose origin is a whole device-pixel offset.
  ctx.setTransform(1.7,0,0,1.7,0,0);const uncut=draw();
  ctx.setTransform(1.7,0,0,1.7,-7,-11);const patch=draw();
  let drift=0;
  for(let y=6;y<157;y++) for(let x=6;x<177;x++) for(let c=0;c<4;c++)
    if(patch[(y*210+x)*4+c]!==uncut[((y+11)*210+x+7)*4+c]) drift++;
  const budget=reserveLayerPixels(16384,16384,2);budget?.();ctx.resetTransform();
  return {rough,clipped,changed,drift,released:!!budget};
}

export async function grainFrames(canvas:HTMLCanvasElement) {
  const {engine,set,draw}=scene(canvas);
  set([{type:"noise",mode:"multi",opacity:.7,density:.7},{type:"texture",size:.5,radius:6}]);
  const times:number[]=[]; let changes=0;
  const off=engine.subscribe(()=>changes++);
  try {
    for(let i=0;i<45;i++) {
      await new Promise<void>(r=>requestAnimationFrame(()=>r()));
      const start=performance.now();
      draw();
      if(i>=5) times.push(performance.now()-start);
    }
  } finally {off();}
  return {frames:times.length,p95:times.sort((a,b)=>a-b)[37],changes};
}
