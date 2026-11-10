import { SvgShadows } from "./svg-shadows";
import { setDocumentProfile } from "./document-profile";
import { reversedRuns } from "./paint-runs";
import { glyphPaintPaths, liveSvgText } from "./svg-text";
import { patternCell } from "./pattern";
import { identity, inverse, multiply, transformPoint, type Affine } from "./affine";
import { booleanResult, maskOutline, paintedStrokePath } from "./boolean-result";
import { toCssHex, type Colour } from "./colour";
import { convertColour } from "./colour-spaces";
import { mapVectorPath, roundedRect, zeroCorners, type PathCommand, type Radii } from "./corners";
import { isFrameLike, isLeaf, layerBlend, layerTransform, rectanglePaints, type Document, type DocumentNode, type LayerNode } from "./document";
import { ellipsePath, fullSweep } from "./ellipse";
import { exportRegion } from "./export-area";
import { fileExportSetting, type ExportSetting } from "./export-settings";
import { sortedStops } from "./gradient";
import { subtreeIds, worldTransform } from "./hierarchy";
import { imageTransform } from "./image-placement";
import { base64Bytes } from "./recovery";
import { isClosedShape, shapePath, strokeGeometry } from "./shape-path";
import type { Paint } from "./solid-paint";
import { cubicLength } from "./cubic";
import { bandCaps, dashPattern, lineDashes, defaultStroke, hasVisibleStroke } from "./stroke";
import { svgBlend, svgMatrix, svgNumber as num, svgPath, xmlText } from "./svg-format";
import { documentTextReady, prepareDocumentText } from "./text-node-layout";
import { vectorPaintRegions } from "./vector-presentation";

export function checkVectorDepth(doc: Document, roots: readonly string[]) {
  for (const root of roots) {
    const stack = [{ids:[root] as readonly string[], at:0}];
    while (stack.length) {
      const frame = stack[stack.length-1];
      if (frame.at === frame.ids.length) { stack.pop(); continue; }
      const id = frame.ids[frame.at++], node = doc.nodes[id];
      if (!node || node.kind !== "page" && node.visible === false) continue;
      if (stack.length > 257) throw new Error("cannot export layer " + root + ": layer " + id + " exceeds the maximum export depth of 256; select an inner layer or reduce nesting");
      if (!isLeaf(node) && node.children.length) stack.push({ids:node.children,at:0});
    }
  }
}

type Path = readonly PathCommand[];
const mapped = (path: Path, matrix: Affine) => mapVectorPath(path,point=>transformPoint(matrix,point));
const attr = (key:string,value:string) => ' ' + key + '="' + value + '"';
const refAttr = (key:string,id?:string) => id ? attr(key,'url(#'+id+')') : '';
const clipElement = (body:string,clip?:string) => clip ? '<g'+refAttr('clip-path',clip)+'>'+body+'</g>' : body;

function outline(doc: Document, node: DocumentNode): Path | undefined {
  if (node.kind === "page" || node.kind === "group") return;
  if (node.kind !== "booleanOp") return shapePath(node);
  const v = booleanResult(doc,node);
  return v ? shapePath(v) : [];
}

function simpleStroke(node: LayerNode): Path | undefined {
  const stroke = node.stroke ?? defaultStroke;
  if (stroke.sides || stroke.widthProfile?.points.length || stroke.brush || !(stroke.weight > 0) ||
    !["none","round","square"].includes(stroke.capStart) || !["none","round","square"].includes(stroke.capEnd) ||
    node.kind === "vector" && node.network.vertices.some(v => v.join && v.join !== stroke.join || v.cap !== undefined)) return;
  if (stroke.align === "center") return ["text","booleanOp","group"].includes(node.kind) ? undefined : strokeGeometry(node);
  if (stroke.dashes.length) return;
  const d = (stroke.align === "inside" ? -1 : 1) * stroke.weight / 2;
  const width = node.width + 2*d, height = node.height + 2*d;
  if (width <= 0 || height <= 0) return;
  let path: Path;
  if (node.kind === "ellipse" && !node.inner && fullSweep(node.sweep)) path = ellipsePath(width,height,node);
  else if (["rectangle","frame","component","instance"].includes(node.kind) && !node.corners?.smoothing) {
    const corners = node.corners ?? zeroCorners;
    if (corners.radii.some(r => r > 0 && r+d <= 0)) return;
    const radii = corners.radii.map(r => r > 0 ? r+d : 0) as unknown as Radii;
    path = roundedRect(width,height,{radii,smoothing:0});
  } else return;
  return mapped(path,[1,0,0,1,-d,-d]);
}

function dashedPieces(path:Path,dashes:readonly number[]) {
  const pattern=dashPattern(dashes);
  if (!pattern) return [{d:svgPath(path),attrs:""}];
  const result:{d:string;attrs:string}[]=[];
  let start=0;
  while (start<path.length) {
    let end=start+1;
    while (end<path.length && path[end][0]!=="M") end++;
    const part=path.slice(start,end), closed=part.at(-1)?.[0]==="Z";
    let length=0, pen={x:0,y:0};
    if (!closed) for (const c of part) {
      if (c[0]==="M") pen={x:c[1],y:c[2]};
      if (c[0]==="L") { length+=Math.hypot(c[1]-pen.x,c[2]-pen.y); pen={x:c[1],y:c[2]}; }
      if (c[0]==="C") {
        const to={x:c[5],y:c[6]};
        length+=cubicLength([pen,{x:c[1],y:c[2]},{x:c[3],y:c[4]},to]);
        pen=to;
      }
    }
    const fitted=lineDashes(length,closed,pattern);
    const attrs=attr("stroke-dasharray",fitted.pattern.map(num).join(" "))+(fitted.offset>0 ? attr("stroke-dashoffset",num(fitted.offset)) : "");
    result.push({d:svgPath(part),attrs});
    start=end;
  }
  return result;
}

class SvgWriter {
  readonly defs: string[] = [];
  private used = new Set<string>();
  private suffix = new Map<string,number>();
  private serial = 0;
  private patternDepth = 0;
  private patternEffects = new Map<string,boolean>();
  private depth = -1;
  private shadows: SvgShadows;
  constructor(private doc: Document, private settings: ExportSetting, private roots:readonly string[], private origin:Affine) {
    this.shadows=new SvgShadows(doc,this.defs,prefix=>this.id(prefix));
  }
  private id(prefix: string) {
    let id: string;
    do { id = prefix + ++this.serial; } while (this.used.has(id));
    this.used.add(id);
    return id;
  }
  private layerId(name: string) {
    const base = Array.from(name).slice(0,200).join("").replace(/[\s\p{Cc}]/gu,"_").replace(/[\ufffe\uffff]/gu,"") || "layer";
    let k = this.suffix.get(base) ?? 1, id: string;
    do { id = k === 1 ? base : base + "_" + k; k++; } while (this.used.has(id));
    this.used.add(id); this.suffix.set(base,k);
    return xmlText(id);
  }
  private hex(c: Colour) { return toCssHex(convertColour(c,this.doc.colourProfile ?? "srgb","srgb")).slice(0,7); }
  private async paint(p: Paint, w: number, h: number) {
    if (!p.visible || p.opacity <= 0) return;
    const style = svgBlend(p.blend);
    const alpha = (value:number,key="fill-opacity") => value < .999 ? attr(key,num(value)) : "";
    if (p.type === "solid") return attr("fill",this.hex(p.color)) + alpha(p.color.a * p.opacity) + style;
    if (p.type === "gradient") {
      const id = this.id("paint");
      const stops = sortedStops(p.stops).map(s=>'<stop'+attr("offset",num(s.position))+attr("stop-color",this.hex(s.color))+alpha(s.color.a*p.opacity,"stop-opacity")+'/>').join("");
      const [x,y] = [p.from[0]*w,p.from[1]*h], [tx,ty] = [p.to[0]*w,p.to[1]*h];
      if (p.kind === "linear") this.defs.push('<linearGradient'+attr("id",id)+attr("x1",num(x))+attr("y1",num(y))+attr("x2",num(tx))+attr("y2",num(ty))+' gradientUnits="userSpaceOnUse">'+stops+'</linearGradient>');
      else this.defs.push('<radialGradient'+attr("id",id)+' cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"'+attr("gradientTransform",svgMatrix([tx-x,ty-y,p.width[0]*w-x,p.width[1]*h-y,x,y]))+'>'+stops+'</radialGradient>');
      return refAttr("fill",id) + style;
    }
    if (p.type === "image") {
      const resource = this.doc.images?.[p.image];
      if (!resource?.width || !resource.height) return;
      let blob = resource.bytes;
      if (!["image/png","image/jpeg","image/webp","image/gif"].includes(blob.type)) {
        const { decodeImageBitmap } = await import("./image-decode");
        const bitmap = await decodeImageBitmap(resource);
        try {
          const canvas = new OffscreenCanvas(bitmap.width,bitmap.height);
          canvas.getContext("2d")!.drawImage(bitmap,0,0);
          blob = await canvas.convertToBlob({type:"image/png"});
        } finally { bitmap.close(); }
      }
      const id = this.id("pattern"), image = this.id("image"), scale = p.scale_mode === "tile" ? 1 : 4;
      const transform = imageTransform(p,resource.width,resource.height,w,h);
      this.defs.push('<pattern'+attr("id",id)+' patternUnits="userSpaceOnUse"'+attr("width",num(resource.width*scale))+attr("height",num(resource.height*scale))+attr("patternTransform",svgMatrix(transform))+'><image'+attr("id",image)+attr("width",String(resource.width))+attr("height",String(resource.height))+attr("href","data:"+blob.type+";base64,"+base64Bytes(new Uint8Array(await blob.arrayBuffer())))+'/></pattern>');
      return refAttr("fill",id) + alpha(p.opacity) + style;
    }
    const source = this.doc.nodes[p.source];
    if (!source || source.kind === "page") return;
    const cell = patternCell(p,source.width,source.height,w,h);
    if (!cell) return;
    const tiles: string[] = [];
    let withEffects=this.patternEffects.get(source.id);
    if (withEffects===undefined) {
      withEffects=subtreeIds(this.doc,source.id).some(id=>this.doc.nodes[id].effects?.some(e=>e.visible));
      this.patternEffects.set(source.id,withEffects);
    }
    if (withEffects) {
      const {renderPatternTile}=await import("./canvas");
      const tile=await renderPatternTile(this.doc,source,cell,this.depth,this.patternDepth);
      if (!tile) return;
      tiles.push('<image width="'+num(cell.size[0])+'" height="'+num(cell.size[1])+'" preserveAspectRatio="none" href="data:image/png;base64,'+base64Bytes(new Uint8Array(await tile.arrayBuffer()))+'"/>');
    } else if (this.patternDepth < 2) {
      this.patternDepth++;
      try {
        for (const [x,y] of cell.tiles) {
          const placement = multiply([cell.scale,0,0,cell.scale,x,y],inverse(layerTransform(source)));
          tiles.push(await this.node(source.id,placement));
        }
      } finally { this.patternDepth--; }
    }
    const id = this.id("pattern");
    this.defs.push('<pattern'+attr("id",id)+' patternUnits="userSpaceOnUse"'+attr("width",num(cell.size[0]))+attr("height",num(cell.size[1]))+
      attr("patternTransform","translate("+num(cell.origin[0])+" "+num(cell.origin[1])+")")+'>'+tiles.join("")+'</pattern>');
    return refAttr("fill",id) + alpha(p.opacity) + style;
  }
  private async paths(path: Path | string, xf: Affine, paints: readonly Paint[], width:number,height:number,rule:CanvasFillRule="nonzero") {
    const d = typeof path === "string" ? path : svgPath(path);
    const elements: string[] = [];
    for (const paint of paints) {
      const attrs = await this.paint(paint,width,height);
      if (attrs) elements.push('<path'+attr("transform",svgMatrix(xf))+attr("d",d)+attrs+(rule === "evenodd" ? ' fill-rule="evenodd"' : '')+'/>');
    }
    return elements.join("");
  }
  private async strokes(node: LayerNode, xf: Affine) {
    if (!hasVisibleStroke(node)) return "";
    const s = node.stroke ?? defaultStroke, paints = node.strokes ?? [];
    const path = this.settings.svgSimplifyStroke === false ? undefined : simpleStroke(node);
    if (!path) {
      const area = paintedStrokePath(this.doc,node) ?? [];
      const even = !!s.sides || (!s.dashes.length && isClosedShape(node) && s.align !== "center");
      return this.paths(area,xf,paints,node.width,node.height,even ? "evenodd" : "nonzero");
    }
    const out = [];
    const pieces=dashedPieces(path,s.dashes);
    for (const p of paints) {
      const paint = await this.paint(p,node.width,node.height);
      if (!paint) continue;
      const startCap=bandCaps(s)[0];
      const cap = startCap === "round" || startCap === "square" ? attr("stroke-linecap",startCap) : "";
      const join = s.join !== "miter" ? attr("stroke-linejoin",s.join) : s.miterLimit !== 4 ? attr("stroke-miterlimit",num(Math.max(1,s.miterLimit))) : "";
      for (const piece of pieces) out.push('<path'+attr("transform",svgMatrix(xf))+attr("d",piece.d)+' fill="none"'+paint.replace(" fill="," stroke=").replace(" fill-opacity="," stroke-opacity=")+attr("stroke-width",num(s.weight))+cap+join+piece.attrs+'/>');
    }
    return out.join("");
  }
  async node(id: string, parent: Affine, inherited?: string, maskRoot?: string): Promise<string> {
    if (this.depth >= 256) return "";
    this.depth++;
    try { return await this.layer(id,parent,inherited,maskRoot); }
    finally { this.depth--; }
  }
  private async layer(id:string,parent:Affine,inherited?:string,maskRoot?:string):Promise<string> {
    const n = this.doc.nodes[id];
    if (!n || n.kind !== "page" && n.visible === false || n.isMask && id !== maskRoot) return "";

    const xf = n.kind === "page" ? parent : multiply(parent,layerTransform(n));
    let attrs = this.settings.svgIdAttribute ? attr("id",this.layerId(n.name)) : "";
    const blend = n.kind === "page" ? n.blend ?? "passThrough" : layerBlend(n);
    const active = n.effects?.some(e=>e.visible);
    let grains="", backdrop="", behind="", filter="";
    if (active && n.kind!=="page") {
      const hasImages=n.effects?.some(e=>e.visible && e.type!=="dropShadow" && (e.type!=="layerBlur" || e.blurType==="progressive"));
      if (hasImages) {
        const images=await import("./svg-effect-images");
        if (images.rasterWhole(this.doc,n)) {
          const rendered=await images.wholeEffectImage(this.doc,n,this.origin,this.depth);
          if (rendered) {
            const opacity=(n.opacity ?? 1)<.999 ? attr("opacity",num(n.opacity!)) : "";
            backdrop=await images.backdropImage(this.doc,n,this.roots,this.origin,opacity);
            return '<g'+attrs+svgBlend(blend)+refAttr("clip-path",inherited)+'>'+backdrop+rendered+'</g>';
          }
        }
        grains=await images.grainImages(this.doc,n,this.origin,this.depth);
        backdrop=await images.backdropImage(this.doc,n,this.roots,this.origin);
      }
      ({behind,filter}=this.shadows.outer(n,xf,inherited));
    }
    if ((n.opacity ?? 1) < .999) attrs += attr("opacity",num(n.opacity!));
    const style = svgBlend(blend) || (grains || blend === "normal" && !isLeaf(n) && n.kind !== "booleanOp" && n.children.length ? ' style="isolation:isolate"' : "");
    attrs += style+filter;
    const isolate = active || !!style || (n.opacity ?? 1) < .999 || isLeaf(n) || n.kind === "booleanOp" || !n.children.length;
    if (isolate) attrs += refAttr("clip-path",inherited);
    const clip = isolate ? undefined : inherited;
    const path = outline(this.doc,n), body: string[] = [backdrop];
    const live = n.kind === "text" && this.settings.svgOutlineText === false && !n.text.path;
    const styledGlyphs = n.kind === "text" && !live ? glyphPaintPaths(n) : undefined;
    if (live) {
      body.push(clipElement(await liveSvgText(n,xf,p=>this.paint(p,n.width,n.height)),clip));
    } else if (styledGlyphs && n.kind === "text") {
      for (const span of styledGlyphs) body.push(clipElement(await this.paths(span.d,xf,span.paints,n.width,n.height),clip));
    } else if (n.kind === "vector") {
      for (const region of vectorPaintRegions(n)) {
        const box = region.space;
        const d = box ? mapped(region.path,inverse(box.transform)) : region.path;
        body.push(clipElement(await this.paths(d,box ? multiply(xf,box.transform) : xf,region.paints,box?.width ?? n.width,box?.height ?? n.height,region.rule),clip));
      }
    } else if (path && n.kind !== "page" && isClosedShape(n)) {
      body.push(clipElement(await this.paths(path,xf,rectanglePaints(n),n.width,n.height,n.kind === "booleanOp" ? "evenodd" : "nonzero"),clip));
    }
    if (path && active && n.kind !== "page") {
      const even=n.kind==="booleanOp" || n.kind==="vector" && n.network.regions.some(region=>region.winding==="evenOdd");
      for (const e of n.effects ?? []) if (e.visible && e.type==="innerShadow")
        body.push(this.shadows.inner(e,{path,rule:even ? "evenodd" : "nonzero"},xf));
    }
    if (!isLeaf(n) && n.kind !== "booleanOp" && n.children.length) {
      let kidClip = clip;
      if (isFrameLike(n) && n.clip && path) {
        kidClip = this.id("clip");
        this.defs.push('<clipPath'+attr("id",kidClip)+refAttr("clip-path",clip)+'><path'+attr("d",svgPath(mapped(path,xf)))+'/></clipPath>');
      }
      const order = isFrameLike(n) && n.layout?.reverseZ ? reversedRuns(this.doc,n.children) : undefined;
      for (let cursor=0; cursor<(order?.length ?? n.children.length); cursor++) {
        const index = order ? order[cursor] : cursor;
        const childId = n.children[index];
        const child = this.doc.nodes[childId];
        if (child?.isMask && child.kind !== "page" && child.visible !== false) {
          if (child.maskType === "vector") {
            const cid = this.id("clip"), shape = maskOutline(this.doc,child,0);
            this.defs.push('<clipPath'+attr("id",cid)+'><path'+(shape ? attr("transform",svgMatrix(multiply(xf,layerTransform(child))))+attr("d",svgPath(shape.path))+(shape.rule === "evenodd" ? ' clip-rule="evenodd"' : '') : ' d=""')+'/></clipPath>');
            body.push('<g'+refAttr("clip-path",cid)+'>');
          } else {
            const mid = this.id("mask"), content = await this.node(childId,xf,undefined,childId);
            this.defs.push('<mask'+attr("id",mid)+' maskUnits="userSpaceOnUse"'+(child.maskType === "luminance" ? '' : ' style="mask-type:alpha"')+'>'+content+'</mask>');
            body.push('<g'+refAttr("mask",mid)+'>');
          }
          let end = index+1;
          while (end<n.children.length && !this.doc.nodes[n.children[end]]?.isMask) {
            body.push(await this.node(n.children[end++],xf,kidClip));
          }
          body.push('</g>');
          if (!order) cursor=end-1;
        } else body.push(await this.node(childId,xf,kidClip));
      }
    }
    if (n.kind !== "page" && hasVisibleStroke(n)) body.push(clipElement(await this.strokes(n,xf),clip));
    return behind+'<g'+attrs+'>'+body.join("")+grains+'</g>';
  }
}

export async function renderSvgExport(doc:Document, selection:readonly string[], p:Record<string,unknown>, saved?:ExportSetting) {
  const setting = saved ?? fileExportSetting({...p,format:"svg"});
  doc=setDocumentProfile(doc,"srgb",true);
  if (!documentTextReady(doc)) await prepareDocumentText(doc);
  const {area,drawn} = exportRegion(doc,selection,p,roots=>checkVectorDepth(doc,roots));
  const origin: Affine = [1,0,0,1,-area.x,-area.y], writer = new SvgWriter(doc,setting,drawn,origin);
  const nodes: string[] = [];
  for (const id of drawn) {
    const parent = doc.nodes[id]?.parent;
    nodes.push(await writer.node(id,multiply(origin,parent ? worldTransform(doc,parent) : identity)));
  }
  const width = num(Math.max(0,area.width)), height = num(Math.max(0,area.height));
  const defs = writer.defs.length ? "<defs>"+writer.defs.join("")+"</defs>" : "";
  return new Blob(['<svg width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" fill="none" xmlns="http://www.w3.org/2000/svg">',...nodes,defs,'</svg>\n'],{type:"image/svg+xml"});
}
