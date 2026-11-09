import { type Document as DesignDocument, type VectorNode } from "../../src/engine/document";
import { type VectorRegion } from "../../src/engine/vector-network";
import { renderDocument } from "../../src/engine/canvas";
import { EditorEngine } from "../../src/engine/editor";
import { imageResource } from "../../src/engine/image-resource";
import { reserveLayerPixels } from "../../src/engine/mask-renderer";

function scene(canvas: HTMLCanvasElement, width=120, height=100) {
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const engine=new EditorEngine();
  engine.execute("page.setBackground",{color:"transparent"});
  const rect=(x:number,y:number,width:number,height:number,props:Record<string,unknown>,parent?:string) =>
    String(engine.execute("shape.rectangle",{x,y,width,height,props,parent}).id);
  const set=(id:string,props:Record<string,unknown>)=>engine.execute("node.set",{id,props});
  const draw=()=>renderDocument(ctx,engine.getSnapshot().document,width,height);
  const sample=(x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data);
  return {ctx,engine,rect,set,draw,sample};
}

/** Native render/tests.rs samples, plus the boundaries between adjacent sibling runs. */
export function siblingPixels(canvas:HTMLCanvasElement) {
  const {engine,rect,set,draw,sample}=scene(canvas);
  rect(0,0,120,100,{fill:"#f5f5f5"});
  const mask=String(engine.execute("shape.ellipse",{x:0,y:0,width:50,height:50,props:{isMask:true,fill:"black"}}).id);
  rect(0,0,100,100,{fill:"black"});
  const second=rect(60,0,20,50,{isMask:true,fill:"white"});
  rect(50,0,60,100,{fill:"blue"});
  const pixels=()=>{draw();return [[25,25],[2,2],[80,80],[70,20],[99,20]].map(([x,y])=>sample(x,y));};
  const opaque=pixels();
  set(mask,{opacity:0,maskType:"vector",fill:"transparent"});
  const vector=pixels();
  set(mask,{maskType:"alpha"});
  const transparent=pixels();
  set(second,{visible:false});
  const hidden=pixels();
  set(mask,{visible:true,x:300,maskType:"vector"});
  set(second,{visible:true,x:400});
  return {opaque,vector,transparent,hidden,offscreen:pixels()};
}

export function luminancePixels(canvas:HTMLCanvasElement) {
  const {rect,set,draw,sample}=scene(canvas);
  const mask=rect(5,5,80,70,{isMask:true,maskType:"luminance"});
  rect(0,0,90,80,{fill:"red"});
  rect(20,10,70,60,{fill:"blue"});
  const bytes=["white","black","red","#00ff00","blue","#808080"].map(fill=>{
    set(mask,{fill}); draw(); return sample(25,25);
  });
  set(mask,{fill:"red",opacity:0.5});
  draw(); const halfRed=sample(25,25);
  set(mask,{maskType:"alpha",fill:"black",opacity:0.5});
  draw(); const halfAlpha=[sample(10,25),sample(25,25),sample(87,25)];
  set(mask,{maskType:"luminance",opacity:1,fills:[{type:"gradient",kind:"linear",from:[0,0.5],to:[1,0.5],
    stops:[{position:0,color:"white"},{position:.49,color:"white"},{position:.51,color:"black"},{position:1,color:"black"}]}]});
  draw();
  return {bytes,halfRed,halfAlpha,gradient:[sample(20,25),sample(70,25)]};
}

export function nestedPixels(canvas:HTMLCanvasElement) {
  const {engine,rect,set,draw,sample}=scene(canvas);
  const frame=String(engine.execute("frame.create",{x:15,y:15,width:70,height:70,props:{fills:[],clip:true}}).id);
  const a=rect(-10,5,30,30,{fill:"white"},frame);
  const b=rect(40,5,30,30,{fill:"white"},frame);
  const mask=String(engine.execute("object.group",{ids:[a,b]}).id);
  set(mask,{isMask:true,opacity:.5});
  const inner=String(engine.execute("frame.create",{parent:frame,x:-5,y:12,width:70,height:10,props:{fills:[],clip:true}}).id);
  rect(0,0,100,10,{isMask:true,maskType:"luminance",fill:"#808080"},inner);
  rect(0,0,100,20,{fill:"blue"},inner);
  const pixels=()=>{draw();return [[14,30],[18,30],[45,30],[60,30],[60,45]].map(([x,y])=>sample(x,y));};
  const alpha=pixels();set(mask,{maskType:"vector",opacity:0}); const vector=pixels();
  set(a,{visible:false});return {alpha,vector,hiddenChild:pixels()};
}

/** Measure real backing stores and compare one fractional ellipse against full-view compositing. */
export function boundedPixels(canvas:HTMLCanvasElement) {
  const {ctx,rect,engine,draw}=scene(canvas,3000,2000);
  engine.execute("shape.ellipse",{x:100.25,y:200.25,width:40,height:40,props:{isMask:true,fill:"white"}});
  rect(90,190,60,60,{fill:"blue"});
  const contexts:HTMLCanvasElement[]=[];
  const sizes:number[][]=[];
  const original=Document.prototype.createElement;
  Document.prototype.createElement=function(tag:string,options?:ElementCreationOptions) {
    const result=original.call(this,tag,options);
    if (result instanceof HTMLCanvasElement) contexts.push(result);
    return result;
  };
  const drawImage=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(source:CanvasImageSource,...coords:number[]) {
    if (source instanceof HTMLCanvasElement) sizes.push([source.width,source.height]);
    Reflect.apply(drawImage,this,[source,...coords]);
  };
  try {draw();} finally {Document.prototype.createElement=original; CanvasRenderingContext2D.prototype.drawImage=drawImage;}
  const cut=ctx.getImageData(0,0,3000,2000).data;
  rect(0,0,3000,2000,{fill:"transparent"});
  draw(); const whole=ctx.getImageData(0,0,3000,2000).data;
  let different=0;
  for(let i=0;i<cut.length;i++) if(cut[i]!==whole[i]) different++;
  return {sizes,released:contexts.every(c=>!c.width && !c.height),different};
}

export async function imageMask(canvas:HTMLCanvasElement) {
  const {ctx,engine,rect,draw,sample}=scene(canvas);
  const tile=document.createElement("canvas");
  tile.width=tile.height=2;
  const paint=tile.getContext("2d")!;
  paint.fillStyle="white";paint.fillRect(0,0,1,2);
  const blob=await new Promise<Blob>(resolve=>tile.toBlob(b=>resolve(b!)));
  const resource=imageResource(new Uint8Array(await blob.arrayBuffer()));
  rect(10,10,80,80,{isMask:true,fills:[{type:"image",image:"tile"}]});
  rect(0,0,100,100,{fill:"blue"});
  const doc={...engine.getSnapshot().document,images:{tile:resource}};
  renderDocument(ctx,doc,120,100);
  // A suspended image paint still holds its mask and content layers. Replacing the document must release them.
  const fullBudget=()=>reserveLayerPixels(16384,16384,2);
  const whilePending=fullBudget();
  whilePending?.();
  draw();
  const afterCancel=fullBudget();
  afterCancel?.();
  renderDocument(ctx,doc,120,100);
  const started=performance.now();
  while(!sample(25,50)[3]) {
    if(performance.now()-started>4000) throw new Error("Image mask did not resume");
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  }
  const afterDraw=fullBudget();
  afterDraw?.();
  return {heldDuringDecode:!whilePending,releasedOnCancel:!!afterCancel,releasedOnDraw:!!afterDraw,
    pixels:[sample(25,50),sample(82,50),sample(5,5)]};
}

export function outlinePixels(canvas:HTMLCanvasElement) {
  const {ctx,engine,rect,set,draw,sample}=scene(canvas);
  const vector=String(engine.execute("vector.create",{path:"M0 0H100V80H0Z M25 20H75V60H25Z"}).id);
  set(vector,{isMask:true,maskType:"vector",opacity:0,fill:"transparent"});
  rect(0,0,100,80,{fill:"blue"});
  const pixels=()=>[sample(10,40),sample(50,40),sample(90,40)];
  draw(); const solid=pixels();
  engine.execute("vector.fillRule",{id:vector,rule:"evenOdd"});
  draw(); const hole=pixels();
  const boolean=scene(canvas);
  const bottom=boolean.rect(0,0,90,80,{fill:"black"}), cut=boolean.rect(30,20,40,40,{fill:"black"});
  const group=String(boolean.engine.execute("bool.subtract",{ids:[bottom,cut]}).id);
  boolean.set(group,{isMask:true,maskType:"vector"});
  boolean.rect(0,0,100,80,{fill:"blue"});
  boolean.draw(); const subtraction=pixels();
  boolean.set(group,{maskType:"alpha",fill:"white",blend:"multiply"});
  boolean.draw(); const booleanAlpha=pixels();
  const stroke=scene(canvas);
  const shape=stroke.rect(10,10,80,60,{isMask:true,fills:[],strokes:["white"],strokeWeight:8,dashes:[12,8]});
  stroke.rect(0,0,120,100,{fill:"blue"});
  stroke.draw(); const painted=ctx.getImageData(5,7,90,6).data;
  stroke.set(shape,{maskType:"vector"});stroke.draw();
  return {solid,hole,subtraction,booleanAlpha,painted:painted.some((v,i)=>i%4===3 && v>0),
    strokeGaps:painted.some((v,i)=>i%4===3 && v===0),strokeInterior:sample(50,40)};
}

export async function maskFrames(canvas:HTMLCanvasElement) {
  const {engine,rect,draw,sample}=scene(canvas,640,360);
  for (let i=0;i<24;i++) {
    const x=(i%8)*80,y=Math.floor(i/8)*110;
    rect(x,y,60,80,{fill:"#808080",maskType:["alpha","vector","luminance"][i%3],isMask:true});
    rect(x-1,y-1,65,85,{fill:"blue"});
  }
  const times:number[]=[],hits:number[]=[];
  let changes=0;
  const off=engine.subscribe(()=>changes++);
  try {
    for (let i=0;i<65;i++) {
      await new Promise<void>(done=>requestAnimationFrame(()=>done()));
      const start=performance.now();
      engine.execute("select.layersAt",{x:(i%8)*80+20,y:20});
      const picked=performance.now();
      draw();sample(5,5);
      if(i>=5) {hits.push(picked-start);times.push(performance.now()-picked);}
    }
  } finally {off();}
  return {frames:times.length,changes,drawP95:times.sort((a,b)=>a-b)[56],hitP95:hits.sort((a,b)=>a-b)[56]};
}

export function nestedBudget(canvas:HTMLCanvasElement) {
  const {rect,draw,sample}=scene(canvas,50,50);
  rect(0,0,50,50,{isMask:true,fill:"white"});
  rect(0,0,50,50,{fill:"red"});
  rect(0,0,50,50,{fill:"blue",opacity:.5});
  draw();const unrestricted=sample(25,25);
  // Reserve all but the four surfaces needed by the mask run. No large canvas is allocated.
  const release=reserveLayerPixels(2**29-50*50*4,1,1)!;
  try {draw();} finally {release();}
  const limited=sample(25,25);
  draw();
  return {unrestricted,limited,restored:sample(25,25)};
}

export function styledVectorPixels(canvas:HTMLCanvasElement) {
  const {ctx,engine,rect,set,sample}=scene(canvas);
  const mask=String(engine.execute("vector.create",{path:"M0 0H40V40H0Z M60 0H100V40H60Z"}).id);
  set(mask,{isMask:true,maskType:"vector",fill:"blue",opacity:0});
  rect(0,0,120,100,{fill:"blue"});
  const doc=engine.getSnapshot().document, node=doc.nodes[mask] as VectorNode;
  const [left,right]=node.network.regions[0].loops;
  const inherited:VectorRegion={loops:[left],winding:"nonZero",paintSpace:{width:40,height:40,transform:[1,0,0,1,0,0]}};
  const absent:VectorRegion={loops:[right],winding:"nonZero",fills:[]};
  const rotated:DesignDocument={...doc,nodes:{...doc.nodes,[mask]:{...node,transform:[0,1,-1,0,50,0],
    network:{...node.network,regions:[inherited,absent]}}}};
  renderDocument(ctx,rotated,120,100);
  return [sample(20,20),sample(20,50),sample(20,80),sample(55,20)];
}
