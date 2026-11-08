import { type Document, type DocumentNode, newDocument, pageOf } from "../../src/engine/document";
import { CanvasImages } from "../../src/engine/image-renderer";
import { readPaint } from "../../src/engine/solid-paint";
import { imageResource, type ImageResource } from "../../src/engine/image-resource";
import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import { base64Bytes } from "../../src/engine/recovery";

export async function imagePixels(canvas: HTMLCanvasElement) {
  canvas.width = 256; canvas.height = 160;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const engine = new EditorEngine();
  engine.execute("page.setBackground", { color: "white" });
  const source = document.createElement("canvas"); source.width = 60; source.height = 40;
  const input = source.getContext("2d")!;
  const colours = ["red", "#00ff00", "blue", "blue", "#00ff00", "red"];
  colours.forEach((c, i) => { input.fillStyle = c; input.fillRect(i%3*20,Math.floor(i/3)*20,20,20); });
  const png = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), "image/png"));
  const { id, image } = await engine.executeAsync("image.place", { data: base64Bytes(new Uint8Array(await png.arrayBuffer())), x: 20, y: 20 });
  const paint = { type: "image", image };
  function change(props: Record<string, unknown>) { engine.execute("node.set", { id, props }); }
  function render() { renderDocument(ctx, engine.getSnapshot().document, canvas.width, canvas.height); }
  const pixel = (x: number, y: number) => [...ctx.getImageData(x,y,1,1).data];
  render();
  const start = performance.now();
  while (pixel(28,28)[1] > 5) {
    if (performance.now()-start > 5000) throw new Error("Image decode did not repaint the standalone canvas");
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  change({ width: 80, height: 80, fills: [{ ...paint, scale_mode: "fit" }] }); render();
  const fit = [pixel(28,24), pixel(28,43), pixel(90,79)];
  change({ fills: [{ ...paint, scale_mode: "fill", opacity: .5 }] }); render();
  const fill = [pixel(24,30),pixel(96,30),pixel(60,90)];
  change({ fills: [{ ...paint, scale_mode: "crop", crop: [1,0,0,1,-.5,0] }] }); render();
  const crop = [pixel(35,35),pixel(73,35)];
  change({ width: 60, height: 40, fills: [{ ...paint, scale_mode: "tile", scale: .5, rotation: -1 }] }); render();
  const tile = [pixel(24,24),pixel(34,24),pixel(44,24),pixel(24,34)];
  change({ fills: [], strokes: [{ ...paint, scale_mode: "fill" }], strokeWeight: 8, strokeAlign: "outside" }); render();
  const stroke = [pixel(16,29), pixel(84,49), pixel(37,36)];
  change({ dashes: [100,1] }); render();
  const maskedStroke = [pixel(16,29), pixel(37,36)];
  change({ fills: [paint], strokes: [], rotation: 13 });
  const second = engine.execute("shape.rectangle", { x:130, y:35, width:60, height:40, props:{ fills:[{ ...paint, rotation:2 }] } }).id;
  const samples = () => [pixel(33,30),pixel(66,47),pixel(139,42),pixel(180,62)];
  render(); const beforeFlatten = samples();
  engine.execute("vector.flatten", { ids:[id,second] }); render();
  return { fit, fill, crop, tile, stroke, maskedStroke, beforeFlatten, afterFlatten:samples() };
}

/** Two 6000 × 8 opposite-phase striped images, as in the native large-image fixture. */
export async function largeImagePaints(canvas:HTMLCanvasElement) {
  const engine = new EditorEngine();
  for (let phase=0;phase<2;phase++) {
    const source=document.createElement("canvas");
    source.width=6000; source.height=8;
    const ctx=source.getContext("2d")!;
    ctx.fillStyle="white"; ctx.fillRect(0,0,6000,8);
    ctx.fillStyle="black";
    for(let x=phase;x<6000;x+=2) ctx.fillRect(x,0,1,8);
    const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));
    await engine.executeAsync("image.place",{data:base64Bytes(new Uint8Array(await blob.arrayBuffer())),x:0,y:phase*16,width:6000,height:8});
  }
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const sizes:number[][]=[], original=globalThis.createImageBitmap;
  globalThis.createImageBitmap = new Proxy(original, {
    async apply(fn, receiver, args) {
      const img:ImageBitmap = await Reflect.apply(fn, receiver, args);
      sizes.push([img.width,img.height]);
      return img;
    }
  });
  try {
    let scale=.25, dirty=true;
    function render() {
      dirty=false;
      ctx.setTransform(scale,0,0,scale,0,0);
      renderDocument(ctx,engine.getSnapshot().document,canvas.width/scale,canvas.height/scale,[],undefined,undefined,undefined,()=>{dirty=true;});
    }
    async function settle(count:number) {
      const start=performance.now();
      while(sizes.length<count || dirty) {
        if(dirty) render();
        if(performance.now()-start>5000) throw Error("Image cache did not finish decoding");
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
    }
    canvas.width=1500;canvas.height=8;
    await settle(2);
    const small=sizes.slice(), warmTimes:number[]=[];
    for(let frame=0;frame<60;frame++){
      const start=performance.now(); render();warmTimes.push(performance.now()-start);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    const warm=sizes.length, p95=warmTimes.sort((a,b)=>a-b)[56];
    canvas.width=4200;canvas.height=56;scale=2;dirty=true;
    await settle(4);
    const mismatch=(phase:number)=>{
      const data=ctx.getImageData(0,phase*32+7,4200,1).data;
      let count=0;
      for(const offset of [0,4000]) for(let i=offset;i<offset+200;i++){
        const black=(Math.floor(i/2)%2)===phase;
        if(black ? data[i*4]>=8 : data[i*4]<=247) count++;
      }
      return count;
    };
    return {small,warm,sizes,mismatches:[mismatch(0),mismatch(1)],p95};
  } finally {globalThis.createImageBitmap=original;}
}

function solidBmp(r: number, g: number, b: number, width = 1) {
  const stride = Math.ceil(width * 3 / 4) * 4, data = new Uint8Array(54 + stride), view = new DataView(data.buffer);
  data.set([66,77]); view.setUint32(2,data.length,true); view.setUint32(10,54,true); view.setUint32(14,40,true);
  view.setUint32(18,width,true); view.setUint32(22,1,true); view.setUint16(26,1,true); view.setUint16(28,24,true);
  for (let x=0;x<width;x++) data.set([b,g,r],54+x*3);
  return imageResource(data);
}

/** Count decoded bitmap lifetimes while every source occupies a separate visible cell. */
export async function imageCachePressure(canvas: HTMLCanvasElement) {
  const columns = 33, count = 264;
  canvas.width = columns * 2; canvas.height = Math.ceil(count / columns) * 2;
  const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
  const initial = newDocument(), page = pageOf(initial), children: string[] = [];
  const nodes: Record<string, DocumentNode> = {}, images: Record<string,ImageResource> = {};
  for (let i = 0; i < count; i++) {
    const key = String(i+2);
    const paint = readPaint({type:"image", image:key});
    images[key] = solidBmp(8 + i % 240,40,151);
    nodes[key] = {kind:"rectangle",id:key,name:key,parent:page.id,x:(i%columns)*2,y:Math.floor(i/columns)*2,width:2,height:2,fill:"#000000",fills:[paint]};
    children.push(key);
  }
  const scene: Document = {...initial,images,nodes:{...nodes,[page.id]:{...page,children}}};
  const live = new Set<ImageBitmap>(), make = globalThis.createImageBitmap, close = ImageBitmap.prototype.close;
  let decoded = 0, peak = 0, dirty = true;
  globalThis.createImageBitmap = new Proxy(make,{async apply(fn, receiver, args) {
    const result: ImageBitmap = await Reflect.apply(fn,receiver,args);
    live.add(result); decoded++; peak = Math.max(peak, live.size);
    return result;
  }});
  ImageBitmap.prototype.close = function() {live.delete(this); return close.call(this);};
  try {
    const draw = () => { dirty=false; renderDocument(ctx,scene,canvas.width,canvas.height,[],undefined,undefined,undefined,()=>{dirty=true;}); };
    const matches = () => {
      const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      return children.every((_,i) => {
        const at = 4 * (Math.floor(i/columns)*2*canvas.width + (i%columns)*2);
        return pixels[at] === 8 + i % 240 && pixels[at+1] === 40 && pixels[at+2] === 151;
      });
    };
    const start = performance.now();
    while (!matches()) {
      if (dirty) draw();
      if (performance.now()-start > 10000) throw Error("Incomplete pressure frame");
      await new Promise<void>(resolve => requestAnimationFrame(()=>resolve()));
    }
    const cold = decoded;
    for (let i=0; i<3; i++) {draw(); await new Promise<void>(resolve => requestAnimationFrame(()=>resolve()));}
    const retained = live.size;
    renderDocument(ctx,newDocument(),canvas.width,canvas.height);
    return {cold, decoded, peak, retained, afterClose:live.size};
  } finally { globalThis.createImageBitmap=make; ImageBitmap.prototype.close=close; }
}

/** Scaled-down native byte budget, including one bitmap that must be held alone. */
export async function imageBytePressure(canvas: HTMLCanvasElement) {
  const cache = new CanvasImages(12), ctx = canvas.getContext("2d")!;
  const resources = Object.fromEntries(["a","b","c","d","wide"].map((key,i) => [key, solidBmp(i,0,0,key==="wide"?4:1)]));
  const names = new Map(Object.entries(resources).map(([name,resource])=>[resource.bytes,name]));
  const created: string[] = [], original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = new Proxy(original,{async apply(fn,receiver,args) {
    created.push(names.get(args[0])!);
    return Reflect.apply(fn,receiver,args);
  }});
  try {
    cache.begin(resources,()=>{});
    for (const image of ["a","b","c","a","d","b","wide","wide","a"]) {
      const paint = readPaint({type:"image",image});
      if (paint.type !== "image") throw Error("Expected image paint");
      let pending;
      do { pending = cache.paint(ctx,paint,4,1); if (pending) await pending; } while (pending);
    }
    return created;
  } finally {cache.clear(); globalThis.createImageBitmap=original;}
}

export async function interruptedImagePage(canvas: HTMLCanvasElement) {
  canvas.width = 24; canvas.height = 16;
  const ctx = canvas.getContext("2d",{willReadFrequently:true})!;
  const initial = newDocument(), page = pageOf(initial);
  const common = {x:0,y:0,width:12,height:12,fill:"#000000",name:"Image"};
  const frame = {...common,id:"2",parent:page.id,kind:"frame" as const,children:["3"],x:2,y:2,opacity:.5,clip:true,fills:[]};
  const child = {...common,id:"3",parent:"2",kind:"rectangle" as const,width:20,fills:[readPaint({type:"image",image:"asset"})]};
  const nodes = {[page.id]:{...page,background:"#ffffff",children:["2"]},"2":frame,"3":child};
  const old = {...initial,images:{asset:solidBmp(255,0,0)},nodes};
  const next = {...initial,images:{asset:solidBmp(0,0,255)},nodes};
  const original = globalThis.createImageBitmap;
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve=>{started=resolve;});
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const decoded: ImageBitmap[] = [];
  globalThis.createImageBitmap = new Proxy(original,{async apply(fn,receiver,args) {
    if (args[0] === old.images.asset.bytes) {started(); await gate;}
    const bitmap: ImageBitmap = await Reflect.apply(fn,receiver,args);
    decoded.push(bitmap);
    return bitmap;
  }});
  try {
    renderDocument(ctx,old,24,16);
    await waiting;
    renderDocument(ctx,next,24,16);
    release();
    const pixel = (x:number,y:number) => [...ctx.getImageData(x,y,1,1).data];
    const start = performance.now();
    while (pixel(5,5)[0] > 140 || pixel(5,5)[2] !== 255) {
      if (performance.now() - start > 5000) throw Error("Replacement image did not finish");
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    const inside = pixel(5,5), clipped = pixel(16,5);
    renderDocument(ctx,initial,24,16);
    return {inside,clipped,released:decoded.map(b=>b.width)};
  } finally {release();globalThis.createImageBitmap=original;}
}
