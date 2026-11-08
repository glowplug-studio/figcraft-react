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
