import { imageResource } from "../../src/engine/image-resource";
import { renderDocument } from "../../src/engine/canvas";
import { EditorEngine } from "../../src/engine/editor";
import { reserveLayerPixels } from "../../src/engine/mask-renderer";

function scene(canvas: HTMLCanvasElement) {
  canvas.width = 120; canvas.height = 100;
  const ctx = canvas.getContext("2d",{willReadFrequently:true})!;
  const engine = new EditorEngine();
  engine.execute("page.setBackground",{color:"transparent"});
  const rect = (x:number,y:number,width:number,height:number,props:Record<string,unknown>,parent?:string) =>
    String(engine.execute("shape.rectangle",{x,y,width,height,props,parent}).id);
  const set = (id:string,props:Record<string,unknown>) => engine.execute("node.set",{id,props});
  const draw = () => renderDocument(ctx,engine.getSnapshot().document,120,100);
  const pixel = (x:number,y:number) => Array.from(ctx.getImageData(x,y,1,1).data);
  return {ctx,engine,rect,set,draw,pixel};
}
const redShadow = {type:"dropShadow",color:"red",offset:[10,0],radius:0};

export function stackSamples(canvas:HTMLCanvasElement) {
  const {rect,set,draw,pixel} = scene(canvas);
  const id = rect(20,15,20,20,{fill:"rgba(0,0,255,.5)",effects:[redShadow]});
  draw(); const covered = [pixel(25,25),pixel(35,25),pixel(45,25)];
  set(id,{effects:[{...redShadow,showBehind:true}]}); draw(); const behind = pixel(35,25);
  set(id,{fill:"blue",effects:[redShadow,{...redShadow,color:"lime"}]}); draw();
  const order = pixel(45,25);
  set(id,{effects:[redShadow,{...redShadow,color:"lime",visible:false}]}); draw(); const hidden = pixel(45,25);
  set(id,{effects:[{...redShadow,offset:[0,0],radius:6}]}); draw();
  const soft = [39,40,41,42,44,50].map(x=>pixel(x,25));
  return {covered,behind,order,hidden,soft};
}

export function silhouetteSamples(canvas:HTMLCanvasElement) {
  const {engine,rect,set,draw,pixel} = scene(canvas);
  const id = String(engine.execute("shape.ellipse",{x:20,y:20,width:30,height:30,props:{
    fill:"blue",effects:[{...redShadow,offset:[0,0],spread:6}]}}).id);
  draw(); const ellipse = [pixel(15,35),pixel(15,15),pixel(35,15)];
  set(id,{visible:false});
  const frame=String(engine.execute("node.create",{type:"frame",x:20,y:20,width:28,height:28,props:{
    fill:"white",strokes:["lime"],strokeWeight:3,effects:[{...redShadow,type:"innerShadow",offset:[8,0]}]}}).id);
  rect(4,6,8,8,{fill:"blue"},frame); draw();
  const framePixels = [pixel(21,29),pixel(23,29),pixel(25,29),pixel(34,29),pixel(18,29)];
  set(frame,{visible:false});
  const a=rect(35,20,10,15,{fill:"blue"}), b=rect(60,20,10,15,{fill:"blue"});
  const group=String(engine.execute("object.group",{ids:[a,b]}).id);
  set(group,{effects:[{...redShadow,offset:[0,20]},{...redShadow,type:"innerShadow",offset:[2,0],color:"lime"}]});
  draw();
  return {ellipse, framePixels, group:[pixel(35,25),pixel(40,25),pixel(39,45),pixel(52,45),pixel(64,45)]};
}

export function boundsSamples(canvas:HTMLCanvasElement) {
  const {ctx,engine,rect,set,draw,pixel} = scene(canvas);
  const id = rect(-20,10,15,12,{fill:"blue",effects:[{...redShadow,offset:[25,0]}]});
  draw(); const offscreen = pixel(10,15);
  const b = rect(28,10,4,12,{fill:"blue"});
  const group = String(engine.execute("object.group",{ids:[id,b]}).id);
  set(group,{opacity:.5});
  set(id,{effects:[{...redShadow,offset:[0,25]}]});
  engine.execute("transform.move",{id:group,dx:40,dy:0}); draw(); const isolated=pixel(25,40);
  const release=reserveLayerPixels(16384,16384,2);
  draw(); const limited=pixel(25,40); release?.();
  draw(); const restored=pixel(25,40);
  ctx.setTransform(2,0,0,2,0,0); draw(); const zoom=pixel(50,80);
  ctx.resetTransform();
  return {offscreen, isolated, limited, restored, zoom};
}

export async function imageSamples(canvas:HTMLCanvasElement, transparent:boolean) {
  const {ctx,engine,rect,set,draw,pixel} = scene(canvas);
  const tile = document.createElement("canvas"); tile.width=tile.height=40;
  const paint=tile.getContext("2d")!;
  paint.fillStyle="blue"; paint.fillRect(0,0,transparent ? 20 : 40,40);
  const blob=await new Promise<Blob>(resolve=>tile.toBlob(b=>resolve(b!)));
  const resource=imageResource(new Uint8Array(await blob.arrayBuffer()));
  const id=rect(20,20,40,40,{fills:[{type:"image",image:"sample",opacity:.5}],effects:[redShadow]});
  const painted=async()=>{
    const doc={...engine.getSnapshot().document,images:{sample:resource}};
    const ready=new Promise<void>(resolve=>renderDocument(ctx,doc,120,100,[],undefined,undefined,undefined,resolve));
    if (!pixel(25,35)[3]) await ready;
    renderDocument(ctx,doc,120,100);
  };
  await painted();
  const drop=[pixel(25,35),pixel(35,35),pixel(45,35),pixel(65,35)];
  set(id,{fills:[{type:"image",image:"sample"}],effects:[{...redShadow,type:"innerShadow",offset:[-5,0]}]});
  await painted();
  const inner=[pixel(25,35),pixel(38,35),pixel(58,35)];
  draw();
  const release=reserveLayerPixels(16384,16384,2); release?.();
  return {drop,inner,released:!!release};
}

export function scaledOutlines(canvas:HTMLCanvasElement) {
  const {engine,ctx,rect,pixel,draw} = scene(canvas);
  const child=rect(10,10,10,15,{fill:"blue",effects:[{...redShadow,offset:[8,0],spread:2}]});
  const group=String(engine.execute("object.group",{id:child}).id);
  engine.execute("node.set",{id:group,props:{opacity:.5}});
  const original=engine.getSnapshot().document;
  const parent=original.nodes[group], node=original.nodes[child];
  if (parent.kind!=="group" || node.kind==="page") throw Error("Invalid scaled fixture");
  const transformed={...original,nodes:{...original.nodes,[group]:{...parent,transform:[3,0,0,1,10,10] as const}}};
  renderDocument(ctx,transformed,120,100);
  // A local 2-unit spread becomes 6px on x, while the 8-unit shadow offset remains 8px.
  const samples=[pixel(26,16),pixel(48,16),pixel(53,16),pixel(55,16),pixel(42,8)];
  draw();
  return samples;
}
