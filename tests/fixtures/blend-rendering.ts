import { renderDocument } from "../../src/engine/canvas";
import { blendModes } from "../../src/engine/blend";
import { imageResource } from "../../src/engine/image-resource";
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

export function paintBlendPixels(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 120;
  const ctx = canvas.getContext("2d", {willReadFrequently: true})!;
  const engine = new EditorEngine();
  const bottom = "#cc6633", top = "#66ccee";
  engine.execute("page.setBackground", {color: "white"});
  const id = engine.execute("shape.rectangle", {x:20, y:20, width:60, height:60}).id;
  const set = (props: Record<string,unknown>) => engine.execute("node.set", {id, props});
  const sample = (x:number,y:number) => [...ctx.getImageData(x,y,1,1).data];
  const draw = () => renderDocument(ctx,engine.getSnapshot().document,120,120);
  function stack(command: "fill.set" | "stroke.set", y: number) {
    return blendModes.map(blend => {
      engine.execute(command, {id, index:1, blend});
      draw();
      return sample(50,y);
    });
  }
  set({fills:[bottom,top]});
  const fills = stack("fill.set",50);
  set({fills:[],strokes:[bottom,top],strokeWeight:8});
  const strokes = stack("stroke.set",22);
  set({dashes:[100,1]});
  const dashed = stack("stroke.set",22);
  engine.execute("stroke.set",{id,index:1,blend:"plusDarker"});
  draw();
  const mask = [sample(50,22),sample(50,50),sample(10,10)];
  draw();
  const repeated = [sample(50,22),sample(50,50),sample(10,10)];

  engine.execute("page.setBackground",{color:bottom});
  set({strokes:[],fills:[{type:"solid",color:top,blend:"multiply"}]});
  const isolation = [1,.9995,.5].map(opacity => {
    set({opacity}); draw(); return sample(50,50);
  });
  engine.execute("page.setBackground",{color:"transparent"});
  set({opacity:1, fills:[{type:"solid",color:"red",opacity:.25},
    {type:"solid",color:"blue",opacity:.5,blend:"plusDarker"}]});
  draw();
  return {fills,strokes,dashed,mask,repeated,isolation,partial:sample(50,50)};
}

export async function paintSourcePixels(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 120;
  const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
  const engine = new EditorEngine();
  const bottom = "#cc6633", top = "#66ccee";
  engine.execute("page.setBackground",{color:bottom});
  const source = engine.execute("shape.rectangle",{x:400,y:0,width:8,height:8,props:{fill:top}}).id;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 2;
  const pixels = tile.getContext("2d")!;
  pixels.fillStyle = top; pixels.fillRect(0,0,2,2);
  const blob = await new Promise<Blob>(resolve=>tile.toBlob(data=>resolve(data!)));
  const images = {tile:imageResource(new Uint8Array(await blob.arrayBuffer()))};
  const frame = engine.execute("frame.create",{x:20,y:20,width:60,height:60,props:{fills:[],clip:true,cornerRadius:12}}).id;
  const id = engine.execute("shape.rectangle",{parent:frame,x:0,y:0,width:60,height:60}).id;
  const sample = (x:number,y:number) => [...ctx.getImageData(x,y,1,1).data];
  const sets = [];
  for (const paint of [{type:"gradient",kind:"linear",stops:[top,top]},
    {type:"pattern",source}, {type:"image",image:"tile"}]) {
    for (const blend of ["multiply","plusDarker"]) {
      for (const contour of ["fill","stroke","dash"]) {
        const fill = contour === "fill";
        const item = {...paint,blend};
        engine.execute("node.set",{id,props:{fills:fill?[item]:[],strokes:fill?[]:[item],
          dashes:contour==="dash"?[100,1]:[],strokeWeight:8}});
        const doc = {...engine.getSnapshot().document,images};
        renderDocument(ctx,doc,120,120);
        const centreY = fill ? 50 : 22;
        if (paint.type === "image") {
          const start = performance.now();
          while (sample(50,centreY)[0]===204) {
            if (performance.now()-start > 4000) throw Error("Image failed to composite on "+contour+" with "+blend);
            await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          }
        }
        sets.push({paint:paint.type,blend,contour,inside:sample(50,centreY),
          corner:sample(20,20),outside:sample(10,10),middle:sample(50,50)});
      }
    }
  }
  // Flatten turns the rotated paint stacks into regions whose blend sees the page backdrop.
  engine.execute("node.set",{id,props:{rotation:12,strokes:[],fills:[{type:"pattern",source,blend:"plusDarker"}]}});
  const second = engine.execute("shape.rectangle",{parent:frame,x:42,y:40,width:12,height:12,
    props:{fills:[{type:"gradient",kind:"linear",stops:[top,top],blend:"multiply"}]}}).id;
  function regionPixels() {
    renderDocument(ctx,engine.getSnapshot().document,120,120);
    return [sample(40,40),sample(67,66),sample(21,21),sample(10,10)];
  }
  const before = regionPixels();
  engine.execute("vector.flatten",{ids:[id,second]});
  return {sets,before,after:regionPixels()};
}
