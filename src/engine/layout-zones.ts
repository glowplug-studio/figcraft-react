import { transformBounds, transformPoint } from "./affine";
import { layerTransform, type Document, type FrameNode } from "./document";
import type { Point, Rectangle } from "./geometry";
import { gridGeometry } from "./grid-layout";
import { worldTransform } from "./hierarchy";
import { pageToScreen, type Viewport } from "./viewport";

type PaddingKey = "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft";
export interface LayoutZone {
  key: PaddingKey | "gap" | "crossGap";
  vertical: boolean;
  value: number;
  rect: Rectangle;
}
export interface LayoutZones {
  bands: LayoutZone[];
  gaps: LayoutZone[];
  tracks: [Point, Point][];
}

export function layoutZones(doc: Document, frame: FrameNode, view: Viewport): LayoutZones | undefined {
  const layout = frame.layout, matrix = worldTransform(doc, frame.id);
  if (!layout || Math.abs(Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI) > .01) return;
  const screen = (x: number, y: number) => pageToScreen(view, transformPoint(matrix, {x,y}));
  const rect = (x0: number, y0: number, x1: number, y1: number): Rectangle => {
    const a = screen(x0,y0), b = screen(x1,y1);
    return {x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(b.x-a.x), height: Math.abs(b.y-a.y)};
  };
  const [top,right,bottom,left] = layout.padding, w = frame.width, h = frame.height;
  const bands: LayoutZone[] = [
    {key:"paddingTop",vertical:true,value:top,rect:rect(0,0,w,Math.max(4,top))},
    {key:"paddingRight",vertical:false,value:right,rect:rect(w-Math.max(4,right),0,w,h)},
    {key:"paddingBottom",vertical:true,value:bottom,rect:rect(0,h-Math.max(4,bottom),w,h)},
    {key:"paddingLeft",vertical:false,value:left,rect:rect(0,0,Math.max(4,left),h)},
  ];
  const gaps: LayoutZone[] = [], tracks: [Point,Point][] = [];
  const autoMain = layout.mode !== "grid" && layout.mainAlign.startsWith("space");
  const autoCross = layout.wrap && layout.contentAlign === "spaceBetween";
  function addGap(key: "gap" | "crossGap", vertical: boolean, box: Rectangle, distance: number) {
    if (box.width <= .5 || box.height <= .5) return;
    const automatic = key === "gap" ? autoMain : autoCross;
    gaps.push({key, vertical, rect:box, value:automatic ? distance : layout![key]});
  }
  if (layout.mode === "grid") {
    const {columns,rows} = gridGeometry(doc,frame);
    const x0 = columns[0][0], x1 = columns.at(-1)![1], y0 = rows[0][0], y1 = rows.at(-1)![1];
    for (const [i,[a,b]] of columns.entries()) {
      if (i) addGap("gap",false,rect(columns[i-1][1],y0,a,y1),layout.gap);
      tracks.push([screen(a,y0),screen(a,y1)], [screen(b,y0),screen(b,y1)]);
    }
    for (const [i,[a,b]] of rows.entries()) {
      if (i) addGap("crossGap",true,rect(x0,rows[i-1][1],x1,a),layout.crossGap);
      tracks.push([screen(x0,a),screen(x1,a)], [screen(x0,b),screen(x1,b)]);
    }
    return {bands,gaps,tracks};
  }

  const vertical = layout.mode === "vertical";
  const flowRect = (a: number, b: number, c: number, d: number) => vertical ? rect(b,a,d,c) : rect(a,b,c,d);
  type Line = {boxes: Rectangle[]; min: number; max: number};
  const lines: Line[] = [];
  for (const id of frame.children) {
    const child = doc.nodes[id];
    if (child.kind === "page" || child.visible === false || child.childLayout?.absolute) continue;
    const box = transformBounds(layerTransform(child), child.width, child.height);
    const b = vertical ? {x:box.y,y:box.x,width:box.height,height:box.width} : box;
    let line = lines.at(-1);
    const previous = line?.boxes.at(-1);
    if (!line || (layout.wrap && previous && b.x < previous.x + previous.width - 1e-6)) {
      line = {boxes:[],min:Infinity,max:-Infinity};
      lines.push(line);
    }
    line.boxes.push(b);
    line.min = Math.min(line.min,b.y);
    line.max = Math.max(line.max,b.y+b.height);
  }
  for (const line of lines) {
    const y0 = layout.wrap ? line.min : vertical ? left : top;
    const y1 = layout.wrap ? line.max : vertical ? w-right : h-bottom;
    for (let j=1; j<line.boxes.length; j++) {
      const a = line.boxes[j-1], end = a.x+a.width, start = line.boxes[j].x;
      addGap("gap",vertical,flowRect(end,y0,start,y1),start-end);
    }
  }
  for (let i=1; i<lines.length; i++) {
      const line = lines[i], previousEnd = lines[i-1].max;
      addGap("crossGap",!vertical,flowRect(vertical ? top : left,previousEnd,vertical ? h-bottom : w-right,line.min),line.min-previousEnd);
  }
  return {bands,gaps,tracks};
}
