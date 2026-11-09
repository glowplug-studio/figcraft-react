import { newDocument, pageOf, type DocumentNode, type FrameNode } from "../../src/engine/document";
import { imageResource } from "../../src/engine/image-resource";
import { readPaint } from "../../src/engine/solid-paint";
import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";

export function patternPixels(canvas: HTMLCanvasElement) {
  canvas.width = 120;
  canvas.height = 110;
  const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
  const engine = new EditorEngine();
  engine.execute("page.setBackground",{color:"white"});
  function rectangle(x:number, size:number, fill:string) {
    return String(engine.execute("shape.rectangle",{x,y:0,width:size,height:size,props:{fills:[fill]}}).id);
  }
  const source = rectangle(500,10,"red"), dest = rectangle(0,100,"white");
  const point = (x:number,y:number) => [...ctx.getImageData(x,y,1,1).data];
  function sample(...points:[number,number][]) {
    renderDocument(ctx,engine.getSnapshot().document,canvas.width,canvas.height);
    return points.map(([x,y])=>point(x,y));
  }
  const fill = (id:string, src:string, extra:Record<string,unknown>={}) => engine.execute("fill.pattern",{id,source:src,spacing:[10,10],...extra});
  fill(dest,source);
  const grid = sample([5,5],[15,5],[45,45]);
  engine.execute("fill.set",{id:source,color:"blue"});
  const live = sample([45,45]);
  fill(dest,source,{tile:"horizontalHex"});
  const horizontal = sample([15,25],[5,25]);
  fill(dest,source,{tile:"verticalHex"});
  const vertical = sample([25,15],[25,5]);
  fill(dest,source,{scale:2,align:"end"});
  const aligned = sample([85,85],[75,85]);
  const nestedSource = rectangle(440,20,"white"), deepSource = rectangle(400,20,"white");
  fill(nestedSource,source); fill(dest,nestedSource);
  const nested = sample([5,5],[15,5]);
  fill(deepSource,nestedSource); fill(dest,deepSource);
  const capped = sample([5,5]);
  engine.execute("node.set",{id:dest,props:{fills:[{type:"pattern",source:dest}]}});
  const cycle = sample([5,5]);
  engine.execute("node.set",{id:dest,props:{fills:["red",{type:"pattern",source:"9999"}]}});
  const missing=sample([5,5]);
  engine.execute("node.set",{id:dest,props:{fills:["red",{type:"pattern",source,spacing:[10,10],opacity:.5}]}});
  const alpha=sample([5,5],[15,5]);
  const strokes = [[],[100,1]].map(dashes => {
    engine.execute("node.set",{id:dest,props:{fills:[],strokes:[{type:"pattern",source,spacing:[10,10]}],strokeWeight:8,dashes}});
    return sample([5,3],[15,3],[5,15]);
  });
  engine.execute("node.set",{id:dest,props:{strokes:[],rotation:11,fills:[{type:"pattern",source,spacing:[10,10]}]}});
  const second=engine.execute("shape.rectangle",{x:70,y:70,width:24,height:20,props:{fills:[{type:"pattern",source,align:"end",spacing:[10,10]}]}}).id;
  const coords:[number,number][]=[[25,27],[45,12],[73,75],[78,79],[92,83],[88,84]];
  const beforeFlatten=sample(...coords);
  engine.execute("vector.flatten",{ids:[dest,second]});
  const afterFlatten=sample(...coords);
  return {beforeFlatten,afterFlatten,missing,alpha,grid, live, horizontal, vertical, aligned, nested, capped, cycle, strokes};
}

/** Upstream render_depth_tests draws the source chain on a different page. */
export function depthPixels(canvas:HTMLCanvasElement) {
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  function sample(outer:number,inner:number) {
    const initial=newDocument();
    const page=pageOf(initial), nodes:Record<string,DocumentNode>={};
    let counter=3;
    function chain(parent:string,levels:number) {
      const first=String(counter);
      for(let i=0;i<levels;i++) {
        const id=String(counter++);
        nodes[id]={id,kind:"frame",name:"Frame",x:0,y:0,width:100,height:100,fill:"transparent",fills:[],clip:false,parent,children:i+1<levels ? [String(counter)] : []};
        parent=id;
      }
      return {first,last:parent};
    }
    const target=chain("1",outer), source=chain("2",inner);
    nodes["1"]={...page,background:"white",children:[target.first]};
    nodes["2"]={...page,id:"2",children:[source.first]};
    nodes[target.last]={...nodes[target.last] as FrameNode,fills:[readPaint({type:"pattern",source:source.first})]};
    nodes[source.last]={...nodes[source.last] as FrameNode,fills:[readPaint("red",true)]};
    renderDocument(ctx,{...initial,pages:["1","2"],nodes},100,100);
    return [...ctx.getImageData(50,50,1,1).data];
  }
  return [sample(200,40),sample(200,100),sample(1,100)];
}

export async function imagePattern(canvas:HTMLCanvasElement) {
  const img=document.createElement("canvas"); img.width=2; img.height=1;
  const pixels=img.getContext("2d")!;
  pixels.fillStyle="red"; pixels.fillRect(0,0,1,1); pixels.fillStyle="blue"; pixels.fillRect(1,0,1,1);
  const blob=await new Promise<Blob>(resolve=>img.toBlob(data=>resolve(data!)));
  const e=new EditorEngine();
  e.execute("page.setBackground",{color:"white"});
  const frame=String(e.execute("frame.create",{x:500,y:400,width:20,height:10,props:{clip:true,fills:[],opacity:.5,rotation:30}}).id);
  const id=e.execute("shape.rectangle",{parent:frame,x:4,y:0,width:20,height:10,props:{fills:[{type:"image",image:"pixels"}]}}).id;
  e.execute("shape.rectangle",{x:0,y:0,width:100,height:60,props:{fills:[{type:"pattern",source:frame,spacing:[4,0]}]}});
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const doc={...e.getSnapshot().document,images:{pixels:imageResource(new Uint8Array(await blob.arrayBuffer()))}};
  renderDocument(ctx,doc,100,60);
  const point=(x:number)=>[...ctx.getImageData(x,5,1,1).data];
  const start=performance.now();
  while(point(7)[1]>220) {
    if(performance.now()-start>5000) throw Error("Decode did not resume the patterned frame "+id);
    await new Promise<void>(r=>requestAnimationFrame(()=>r()));
  }
  return [point(1),point(7),point(14),point(18),point(22),point(31)];
}

export async function patternFrames(canvas:HTMLCanvasElement) {
  const e = new EditorEngine();
  const source = e.execute("shape.rectangle",{x:4000,y:0,width:8000,height:16,props:{fill:"red"}}).id;
  const target = e.execute("shape.rectangle",{x:0,y:0,width:600,height:400}).id;
  e.execute("fill.pattern",{id:target,source});
  canvas.width=640; canvas.height=480;
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const create=ctx.createPattern.bind(ctx), dimensions:number[][]=[], surfaces:HTMLCanvasElement[]=[];
  ctx.createPattern=(image,mode)=>{
    if (image instanceof HTMLCanvasElement) {dimensions.push([image.width,image.height]);surfaces.push(image);}
    return create(image,mode);
  };
  const draw=()=>renderDocument(ctx,e.getSnapshot().document,canvas.width,canvas.height);
  try {
    draw();
    const coarse=[...ctx.getImageData(45,35,1,1).data];
    e.execute("node.set",{id:source,props:{width:20,height:10}});
    e.execute("fill.pattern",{id:target,source,tile:"horizontalHex",spacing:[10,10]});
    const times:number[]=[];
    for(let i=0;i<65;i++) {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const start=performance.now(); draw(); ctx.getImageData(5,5,1,1);
      if(i>=5) times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);
    return {coarse,dimensions:[dimensions[0],dimensions[1]],released:surfaces.every(s=>!s.width && !s.height),
      frames:times.length,p50:times[29],p95:times[56],max:times[59]};
  } finally {ctx.createPattern=create;}
}
