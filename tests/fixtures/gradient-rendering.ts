import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import type { GradientKind } from "../../src/engine/gradient";

export function gradientPixels(canvas: HTMLCanvasElement) {
  canvas.width = 220; canvas.height = 120;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const engine = new EditorEngine();
  engine.execute("page.setBackground", { color: "white" });
  const id = String(engine.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100 }).id);
  function sample(props: Record<string, unknown>, x: number, y: number) {
    engine.execute("node.set", { id, props });
    renderDocument(context, engine.getSnapshot().document, canvas.width, canvas.height);
    return [...context.getImageData(x, y, 1, 1).data];
  }
  type Pair = [number, number];
  const centre: Pair = [.5,.5], east: Pair = [1,.5], south: Pair = [.5,1];
  const handleRows: [GradientKind, Pair, Pair, Pair, number, number, number, number][] = [
    ["linear",[0,.5],east,[0,1],100,25,50,.255],
    ["linear",[.25,.5],[.75,.5],[.25,1],100,10,50,0],
    ["linear",[.25,.5],[.75,.5],[.25,1],100,90,50,1],
    ["linear",[.5,0],south,[0,0],100,5,75,.755],
    ["linear",[0,0],[1,0],[.5,1],100,75,50,.5025],
    ["radial",centre,east,south,200,150,50,.505],
    ["radial",centre,east,south,200,100,74,.49],
    ["radial",centre,east,south,100,2,2,1],
    ["angular",centre,east,south,100,50,90,.25],
    ["angular",centre,east,south,100,10,50,.5],
    ["angular",centre,east,south,100,50,10,.75],
    ["angular",centre,east,[.5,0],100,50,90,.75],
    ["diamond",centre,east,south,100,75,50,.52],
    ["diamond",centre,east,south,100,62,62,.5],
    ["diamond",centre,east,south,100,2,2,1],
  ];
  const handles = handleRows.map(([kind,from,to,width,box,x,y,t]) => ({
    kind, t, x, y, pixel: sample({ width:box, fills:[{type:"gradient", kind, from, to, width, stops:["black","white"]}] },x,y),
  }));
  const ramp = { type:"linearGradient", from:[0,.5], to:east, stops:["red","blue"] };
  const middle = sample({ fills:[ramp] },49,50);
  const fade = sample({ fills:[{...ramp,stops:["red","#0000ff00"]}] },49,50);
  const opacity = sample({ fills:[{...ramp,stops:["black","black"],opacity:.5}] },50,50);
  const stops = [{position:1,color:"blue"}, {position:.5,color:"red"}, {position:0,color:"red"}, {position:.5,color:"blue"}];
  const hard = [45,55].map(x => sample({fills:[{...ramp,stops}]}, x,50));
  const strokes = [undefined,[100,1]].map(dashes => {
    const props = { fills:[], strokes:[ramp], strokeWeight:10, ...(dashes && { dashes }) };
    return { band:sample(props,49,2), centre:sample(props,49,50) };
  });
  engine.execute("node.set",{id,props:{x:8,y:8,width:76,height:68,fills:[ramp],strokes:[],rotation:10}});
  const other = engine.execute("shape.rectangle",{x:115,y:10,width:90,height:60,props:{fills:[{...ramp,type:"diamondGradient",from:centre,to:east,width:south}]}}).id;
  const readRegions = () => {
    renderDocument(context,engine.getSnapshot().document,canvas.width,canvas.height);
    return [[30,28],[56,44],[148,32],[171,46]].map(([x,y])=>[...context.getImageData(x,y,1,1).data]);
  };
  const beforeFlatten = readRegions();
  engine.execute("vector.flatten",{ids:[id,other]});
  return { handles, middle, fade, opacity, hard, strokes, beforeFlatten, afterFlatten:readRegions() };
}
