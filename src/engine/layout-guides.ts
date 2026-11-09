import { rotationDegrees, transformBounds, transformPoint, type Affine } from "./affine";
import { renderColour } from "./colour";
import { convertColour } from "./colour-spaces";
import { layerTransform, pageOf, type Document, type LayerNode } from "./document";
import type { Rectangle } from "./geometry";
import { readGrids, withStyleRef, type LayoutGrid } from "./shared-styles";
import { requiredTargets } from "./arrange";
import { HierarchyDraft } from "./hierarchy";
import { parseIndex } from "./parameters";

type Extent = readonly [number,number,number,number];

export function* guideRects(grid: LayoutGrid, width: number, height: number): Generator<Extent> {
  if (grid.kind === "grid") {
    const step = grid.size >= 1 ? grid.size : 10;
    let n = 0;
    for (let x=0; x<=width && n++<4000; x+=step) yield [x,0,x,height];
    n = 0;
    for (let y=0; y<=height && n++<4000; y+=step) yield [0,y,width,y];
    return;
  }
  const columns = grid.kind === "columns", total = columns ? width : height;
  const gutter = Math.max(0,grid.gutter), offset = Math.max(0,grid.offset);
  const fixed = grid.size > 0 ? grid.size : 60;
  const room = grid.align === "center" ? total : total - offset;
  const count = Math.max(1,Math.min(500, grid.count === 0 && grid.align !== "stretch" ? Math.floor((room+gutter)/(fixed+gutter)) : grid.count));
  const size = grid.align === "stretch" ? Math.max(0,(total-2*offset-gutter*(count-1))/count) : fixed;
  const span = grid.align === "stretch" ? total : size*count + gutter*(count-1);
  const start = grid.align === "center" ? (total-span)/2 : grid.align === "max" ? total-offset-span : offset;
  for (let i=0; i<count; i++) {
    const at = start + i*(size+gutter);
    yield columns ? [at,0,at+size,height] : [0,at,width,at+size];
  }
}

export const showsGuides = (world: Affine) => Math.abs(rotationDegrees(world)) < 1e-6;

const boards = new WeakMap<Document, readonly LayerNode[]>();
export function drawLayoutGuides(ctx:CanvasRenderingContext2D, doc:Document, bounds:Rectangle, zoom:number) {
  let layers = boards.get(doc);
  if (!layers) {
    const guided: LayerNode[] = [];
    for (const id of pageOf(doc).children) {
      const node = doc.nodes[id];
      if (node.kind !== "page" && node.visible !== false && node.grids?.length) guided.push(node);
    }
    layers = guided;
    boards.set(doc,layers);
  }
  if (!layers.length) return;
  ctx.save();
  ctx.lineWidth = 1/zoom;
  const pad = 20/zoom;
  for (const node of layers) {
    const world = layerTransform(node);
    if (!showsGuides(world)) continue;
    const box = transformBounds(world, node.width, node.height);
    if (box.x > bounds.x+bounds.width+pad || box.y > bounds.y+bounds.height+pad ||
        box.x+box.width < bounds.x-pad || box.y+box.height < bounds.y-pad) continue;
    for (const grid of node.grids!) {
      if (!grid.visible) continue;
      const color = doc.colourProfile === "displayP3" ? convertColour(grid.color,"displayP3","srgb") : grid.color;
      ctx.fillStyle = ctx.strokeStyle = renderColour(color);
      for (const [x0,y0,x1,y1] of guideRects(grid,node.width,node.height)) {
        const a = transformPoint(world,{x:x0,y:y0}), b = transformPoint(world,{x:x1,y:y1});
        if (grid.kind === "grid") {
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        } else ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);
      }
    }
  }
  ctx.restore();
}

export const gridSpecs = {
  "grid.add": {label:"Add layout grid",undo:true},
  "grid.remove": {label:"Remove layout grid",undo:true},
  "grid.move": {label:"Move layout grid",undo:true},
} as const;

export function editLayoutGuides(doc:Document, selection:readonly string[], command:string, params:Record<string,unknown>) {
  const ids = requiredTargets(doc,selection,params);
  const grid = command === "grid.add" ? readGrids([params.grid ?? {}],true)[0] : undefined;
  const from = command === "grid.move" ? parseIndex(params.from,"from") : command === "grid.remove" ? parseIndex(params.index,"index") : 0;
  const to = command === "grid.move" ? parseIndex(params.to,"to") : from;
  const draft = new HierarchyDraft(doc);
  for (const id of ids) {
    const node = draft.nodes[id], grids = [...(node.grids ?? [])];
    if (grid) grids.push(grid);
    else if (from >= grids.length || to >= grids.length || command === "grid.move" && from === to) continue;
    else {
      const [item] = grids.splice(from,1);
      if (command === "grid.move") grids.splice(to,0,item);
    }
    const next = grid ? node : withStyleRef(node,"grid",null);
    const {grids:old, ...rest} = next;
    draft.set(grids.length ? {...rest,grids:Object.freeze(grids)} : rest);
  }
  return draft.finish();
}
