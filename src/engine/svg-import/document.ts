import { identity,inverse,multiply,transformBounds,type Affine } from "../affine";
import { blendFromName } from "../blend";
import type { PathCommand } from "../corners";
import type { Rectangle } from "../geometry";
import { TAU } from "../ellipse";
import { isLeaf,newDocument,withLayerTransform,withRectanglePaints,type Document as Drawing,type LayerNode,type GroupNode,type LayerProperties } from "../document";
import { HierarchyDraft } from "../hierarchy";
import { worldRenderBounds } from "../render-bounds";
import type { Paint } from "../solid-paint";
import { defaultStroke } from "../stroke";
import { networkFromPath } from "../vector-network";
import { pathBounds } from "../vector-path";
import { elementPath,closedForFill,placedPrimitive,transformPath,translated } from "./geometry";
import { needsTextOutlines,svgGlyphOutlines } from "./outlined-text";
import { svgText } from "./text";
import { svgPattern,type TileContext,type TileCache } from "./pattern";
import { svgImages } from "./image";
import { withImageResource } from "../image-import";
import { readPaint } from "../solid-paint";
import { resolveSvgColours } from "./colour";
import { svgFilter } from "./filter";
import type { Effect } from "../effects";
import { localReference,svgGradient,type PaintTarget } from "./gradient";
import { inlinePaint,svgStroke } from "./paint";
import { elementMatrix,svgCascade,svgLength,svgOpacity,transformList,viewBox,viewportTransform,type SvgStyle,type SvgUnits } from "./style";
import { svgBytes,svgXml,svgNamespace } from "./xml";

const layerName=(id:string|null,whenEmpty:string)=>id ? id.replace(/_x([0-9a-f]{2})_/gi,(m,h:string)=>{
  const c=parseInt(h,16);
  return c<32 || c>=127 && c<=159 ? m : String.fromCharCode(c);
}) : whenEmpty;
const maxLayers=100000;
const sharedStroke={...defaultStroke,align:"center" as const};

export async function importSvg(doc:Drawing,next:bigint,data:Uint8Array,name:string,x:number,y:number,centre=false,checkCurrent?:()=>void) {
  const root=svgXml(await svgBytes(data));
  return importTree(doc,next,root,name,x,y,centre,{
    count:0,traversed:0,lastYield:performance.now(),checkCurrent,embeddedDepth:0,patternDepth:0,resolveImage:svgImages(),
    sheets:new WeakMap(),notes:new Set(),visited:new Set(),tiles:new WeakMap(),
  });
}
interface ImportWork {
  count:number;traversed:number;lastYield:number;checkCurrent?:()=>void;embeddedDepth:number;patternDepth:number;resolveImage:ReturnType<typeof svgImages>;
  sheets:WeakMap<Document,ReturnType<typeof svgCascade>>;notes:Set<string>;visited:Set<Element>;tiles:TileCache;
}
interface ImportedSvg {document:Drawing;nextId:bigint;id:string;warnings:string[]}
async function importTree(doc:Drawing,next:bigint,root:Element,name:string,x:number,y:number,centre:boolean,
  work:ImportWork,tile?:TileContext):Promise<ImportedSvg> {
  const draft=new HierarchyDraft(doc),{sheets,notes,visited,resolveImage}=work;
  const cascade=(el:Element,parent?:SvgStyle)=>{
    let evaluate=sheets.get(el.ownerDocument);
    if (!evaluate) {
      resolveSvgColours(el.ownerDocument.documentElement,profile,note=>notes.add(note));
      evaluate=svgCascade(el.ownerDocument.documentElement);sheets.set(el.ownerDocument,evaluate);
    }
    return evaluate(el,parent);
  };
  let resources=doc;
  const children=new Map<string,string[]>();
  const profile=doc.colourProfile ?? "srgb";
  const fresh=()=>{const allocated=draft.allocateId(next); next=allocated.nextId; return allocated.id;};
  const base=(id:string,parent:string,name:string,w=0,h=0):LayerProperties=>({id,parent,name,x:0,y:0,width:w,height:h,fill:"transparent"});
  function add(n:LayerNode) {
    const siblings=children.get(n.parent)!;
    siblings.push(n.id);
    draft.nodes[n.id]=Object.freeze(n);
    if (!isLeaf(n)) children.set(n.id,[]);
    work.count++;
  }
  function finalise(id:string) {
    const n=draft.nodes[id];
    if (n && !isLeaf(n)) draft.set({...n,children:Object.freeze(children.get(id)!.slice())});
  }
  function finishGroup(id:string,anonymous:boolean) {
    finalise(id);
    const g=draft.nodes[id] as GroupNode, siblings=children.get(g.parent)!;
    if (!g.children.some(i=>!draft.nodes[i].isMask)) {
      // Empty groups (including clip-only groups) own only newly imported nodes.
      const drop=[id];
      while (drop.length) {
        const key=drop.pop()!, item=draft.nodes[key];
        if (!isLeaf(item)) for(const child of item.children) drop.push(child);
        delete draft.nodes[key]; children.delete(key);
      }
      siblings.pop();
      return;
    }
    const c=draft.nodes[g.children[0]] as LayerNode;
    const plain=(b:LayerNode["blend"])=>!b || b==="normal" || b==="passThrough";
    if (anonymous && g.children.length===1 && !c.isMask && !(c.effects?.length && g.effects?.length) && (plain(g.blend) || plain(c.blend))) {
      draft.set({...c,parent:g.parent,opacity:Math.fround((c.opacity ?? 1)*(g.opacity ?? 1)),...(!plain(g.blend) && {blend:g.blend}),
        ...(g.effects?.length && {effects:g.effects}),...(g.isMask && {isMask:true,maskType:g.maskType})});
      siblings[siblings.length-1]=c.id;
      delete draft.nodes[id]; children.delete(id);
    } else draft.fitToChildren(id);
  }

  const b=viewBox(root), rootStyle=cascade(root), font=svgLength(rootStyle.get("font-size"),12,12,12);
  const w=tile?.width ?? svgLength(root.getAttribute("width"),b?.width ?? 100,font,b?.width ?? 100);
  const h=tile?.height ?? svgLength(root.getAttribute("height"),b?.height ?? 100,font,b?.height ?? 100);
  if (!(w>0 && h>0)) throw new Error("SVG import failed: SVG has an invalid size");
  const units=tile?.units ?? {width:b?.width ?? w,height:b?.height ?? h,font};
  const frame=fresh();
  const page=draft.nodes[doc.currentPage];
  if (page.kind!=="page") throw new Error("SVG import needs an active page");
  children.set(page.id,[...page.children]);
  add({...base(frame,page.id,name,w,h),kind:"frame",clip:true,children:[]});
  const commonGroup=(parent:string,label:string,style:SvgStyle)=>{
    const id=fresh(),opacity=svgOpacity(style.get("opacity")),blend=blendFromName(style.get("mix-blend-mode"));
    add({...base(id,parent,label),kind:"group",children:[],...(opacity!==1 && {opacity}),
      ...(blend && blend!=="normal" ? {blend} : style.get("isolation")==="isolate" ? {blend:"normal"} : {})});
    return id;
  };
  async function resolvePaint(el:Element,style:SvgStyle,key:"fill"|"stroke",u:SvgUnits,target:PaintTarget) {
    const server=localReference(el,style.get(key));
    if (!server) return inlinePaint(style,key);
    const opacity=svgOpacity(style.get(key+"-opacity"));
    if (["linearGradient","radialGradient"].includes(server.localName)) return svgGradient(server,target,u,opacity,cascade);
    if (server.localName==="pattern" && work.patternDepth<2 && !visited.has(server)) {
      work.patternDepth++;visited.add(server);
      try {
        return await svgPattern(server,target,u,opacity,work.tiles,(parent,context)=>
          importTree(newDocument("Pattern"),2n,parent,"Tile",0,0,false,work,context),(key,resource)=>{
            const previous=resources.images?.[key];
            const hash=previous && previous.digest!==resource.digest ? resource.digest ?? key : key;
            resources=withImageResource(resources,{hash,resource});
            return hash;
          },note=>notes.add(note));
      } finally {work.patternDepth--;visited.delete(server);}
    }
  }
  async function paintPath(el:Element,parent:string,world:Affine,style:SvgStyle,u:SvgUnits,p:readonly PathCommand[],ref:boolean) {
    if (style.get("visibility")==="hidden" || style.get("visibility")==="collapse") return;
    const strokeWidth=svgLength(style.get("stroke-width"),Math.hypot(u.width,u.height)/Math.SQRT2,u.font,1);
    const strokeSource=style.get("stroke");
    const prim=placedPrimitive(p,world,!strokeSource || strokeSource==="none" || strokeWidth<=0);
    const transformed=prim ? [] : transformPath(p,world);
    const box=prim ? {x:0,y:0,width:prim.width,height:prim.height} : pathBounds(transformed);
    if (!box) return;
    const placement=prim?.xf ?? translated(box.x,box.y);
    const bounds=pathBounds(p);
    if (!bounds) return;
    const target={bounds,toNode:multiply(inverse(placement),world),width:box.width,height:box.height};
    const fills=await resolvePaint(el,style,"fill",u,target),stroke=await resolvePaint(el,style,"stroke",u,target);
    const hasFill=!!fills,hasStroke=!!stroke && strokeWidth>0;
    if (!hasFill && !hasStroke) {
      const server=localReference(el,style.get("fill")) ?? localReference(el,style.get("stroke"));
      if (server?.localName!=="pattern" || !server.childElementCount) return;
    }
    const name=layerName(ref ? null : el.id,prim ? prim.kind[0].toUpperCase()+prim.kind.slice(1) : "Vector");
    const k=Math.sqrt(Math.abs(world[0]*world[3]-world[1]*world[2]));
    const under=style.get("paint-order")?.trim().startsWith("stroke") ?? false;
    function painted(n:LayerNode,xf:Affine,fill:Paint|undefined,outline:boolean,closed:boolean) {
      let props=outline ? svgStroke(style,u,k,closed) : n.kind==="line" || n.kind==="vector" ? sharedStroke : defaultStroke;
      if (under && fill && outline && closed) props={...props,align:"outside",weight:props.weight/2};
      return withRectanglePaints(withLayerTransform({...n,...(props!==defaultStroke && {stroke:props}),...(outline && stroke && {strokes:[stroke]})},xf),fill ? [fill] : []);
    }
    if (prim) {
      const node=base(fresh(),parent,name,prim.width,prim.height);
      const layer:LayerNode=prim.kind==="ellipse" ? {...node,kind:"ellipse",start:0,sweep:TAU,inner:0}
        : prim.kind==="line" ? {...node,kind:"line"} : {...node,kind:"rectangle",...(prim.radius ? {corners:{radii:[prim.radius,prim.radius,prim.radius,prim.radius] as const,smoothing:0}} : {})};
      add(painted(layer,prim.xf,fills,hasStroke,prim.kind!=="line"));
      return;
    }
    const local=transformPath(transformed,translated(-box.x,-box.y)),xf=translated(box.x,box.y);
    const tol=.001*Math.max(box.width,box.height);
    const snapped=closedForFill(local,tol,false), closed=closedForFill(snapped,tol,true);
    function vector(path:readonly PathCommand[],drawFill:boolean,drawStroke:boolean,label:string) {
      const net=networkFromPath(path);
      const winding=style.get("fill-rule")==="evenodd" ? "evenOdd" : "nonZero";
      const network={...net,regions:drawFill ? net.regions.map(r=>({...r,winding} as const)) : []};
      const n=base(fresh(),parent,label,box!.width,box!.height);
      const isClosed=path.filter(c=>c[0]==="M").length===path.filter(c=>c[0]==="Z").length;
      return painted({...n,kind:"vector",network},xf,drawFill ? fills : undefined,drawStroke,isClosed);
    }
    if (hasFill && hasStroke && snapped!==closed) {
      const fill=vector(closed,true,false,name+" fill"),line=vector(snapped,false,true,name);
      if (under) {add(line);add(fill);} else {add(fill);add(line);}
    } else add(vector(hasFill ? closed : local,hasFill,hasStroke,name));
  }

  function contentBounds(el:Element,u:SvgUnits):Rectangle|undefined {
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    const queue:[Element,Affine][]=[[el,identity]];
    while (queue.length) {
      const [child,m]=queue.pop()!;
      const p=elementPath(child,u);
      if (p) {
        const b=pathBounds(transformPath(p,m));
        if (b) {left=Math.min(left,b.x);top=Math.min(top,b.y);right=Math.max(right,b.x+b.width);bottom=Math.max(bottom,b.y+b.height);}
      } else if (["g","a","svg","symbol"].includes(child.localName)) {
        for (const c of child.children) queue.push([c,multiply(m,elementMatrix(c))]);
      }
    }
    if (left!==Infinity) return {x:left,y:top,width:right-left,height:bottom-top};
  }

  async function viewportMask(el:Element,parent:string,at:Affine,w:number,h:number,units:SvgUnits) {
    const mask=commonGroup(parent,"Clip path",new Map());
    draft.set({...draft.nodes[mask],isMask:true,maskType:"vector"} as GroupNode);
    await paintPath(el,mask,at,new Map(),units,[["M",0,0],["L",w,0],["L",w,h],["L",0,h],["Z"]],true);
    finishGroup(mask,true);
  }

  async function visit(el:Element,parent:string,baseXf:Affine,inherited:SvgStyle,u:SvgUnits,depth:number,ref=false):Promise<void> {
    if (el.namespaceURI!==svgNamespace) return;
    if (work.count>=maxLayers || ++work.traversed>maxLayers*5) {notes.add("more than 100000 layers: the rest was left out");return;}
    if (work.traversed%128===0 && performance.now()-work.lastYield>12) {
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      work.checkCurrent?.();
      work.lastYield=performance.now();
    }
    if (depth>128) {notes.add("layers nested more than 128 deep were left out");return;}
    const style=cascade(el,inherited);
    if (style.get("display")==="none") return;
    const xf=multiply(baseXf,elementMatrix(el));
    if (xf[0]*xf[3]===xf[1]*xf[2]) return;
    const local={...u,font:el.hasAttribute("font-size") || style.get("font-size")!==inherited.get("font-size") ? svgLength(style.get("font-size"),u.font,u.font,u.font) : u.font};
    const tag=el.localName;
    if (["defs","style","title","desc","metadata","script"].includes(tag)) return;
    async function visitImage(imageParent:string) {
      if (style.get("visibility")==="hidden") return;
      const resource=await resolveImage(el,work.embeddedDepth,resources.images);
      if (!resource) return;
      const nested=resource.kind==="svg" ? resource.root : undefined;
      const b=nested && viewBox(nested);
      const iw=resource.kind==="raster" ? resource.image.resource.width : svgLength(nested!.getAttribute("width"),u.width,u.font,b?.width ?? 100);
      const ih=resource.kind==="raster" ? resource.image.resource.height : svgLength(nested!.getAttribute("height"),u.height,u.font,b?.height ?? 100);
      const w=svgLength(el.getAttribute("width"),u.width,u.font,iw),h=svgLength(el.getAttribute("height"),u.height,u.font,ih);
      if (!(iw>0 && ih>0 && w>0 && h>0)) return;
      const at=multiply(xf,translated(svgLength(el.getAttribute("x"),u.width,u.font),svgLength(el.getAttribute("y"),u.height,u.font)));
      const map=viewportTransform(el,w,h,{x:0,y:0,width:iw,height:ih});
      const imageXf=multiply(at,map),bounds=transformBounds(map,iw,ih);
      const clipped=bounds.x<-.01 || bounds.y<-.01 || bounds.x+bounds.width>w+.01 || bounds.y+bounds.height>h+.01;
      const target=clipped ? commonGroup(imageParent,layerName(ref ? null : el.id,"Mask group"),new Map()) : imageParent;
      if (clipped) await viewportMask(el,target,at,w,h,u);
      const name=layerName(ref || clipped ? null : el.id,"Image");
      if (resource.kind==="svg") {
        const group=commonGroup(target,name,new Map());
        work.embeddedDepth++;
        try {
          const nestedStyle=cascade(resource.root), nestedXf=multiply(imageXf,viewportTransform(resource.root,iw,ih));
          for(const child of resource.root.children) await visit(child,group,nestedXf,nestedStyle,{width:b?.width ?? iw,height:b?.height ?? ih,font:12},depth+1);
        } finally {work.embeddedDepth--;}
        finishGroup(group,ref || !el.id);
      } else {
        resources=withImageResource(resources,resource.image);
        const box:PathCommand[]=[["M",0,0],["L",iw,0],["L",iw,ih],["L",0,ih],["Z"]];
        const placed=placedPrimitive(box,imageXf,true) ?? {xf:imageXf,width:iw,height:ih};
        const stretched=Math.abs(placed.width*ih-placed.height*iw)>1e-6*Math.max(placed.width*ih,placed.height*iw);
        const fill=readPaint({type:"image",image:resource.image.hash,...(stretched && {scale_mode:"crop",crop:identity})});
        add(withRectanglePaints(withLayerTransform({...base(fresh(),target,name,placed.width,placed.height),kind:"rectangle"},placed.xf),[fill]));
      }
      if (clipped) finishGroup(target,!el.id || ref);
    }
    if (tag==="use") {
      const href=el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink","href");
      if (!href?.startsWith("#")) return;
      const target=el.ownerDocument.getElementById(href.slice(1));
      if (!target || visited.has(target)) return;
      const id=commonGroup(parent,layerName(el.id,"Group"),style);
      const at=multiply(xf,translated(svgLength(el.getAttribute("x"),u.width,u.font),svgLength(el.getAttribute("y"),u.height,u.font)));
      visited.add(target);
      if (target.localName==="symbol") {
        const tw=svgLength(el.getAttribute("width"),u.width,u.font,u.width),th=svgLength(el.getAttribute("height"),u.height,u.font,u.height);
        const v=viewBox(target);
        const targetStyle=cascade(target,style);
        const map=viewportTransform(target,tw,th),attached=multiply(at,map);
        const units={width:v?.width ?? tw,height:v?.height ?? th,font:u.font};
        let nested=id;
        if (targetStyle.get("overflow")!=="visible") {
          const bounds=contentBounds(target,units);
          const mapped=bounds && transformBounds(multiply(map,translated(bounds.x,bounds.y)),bounds.width,bounds.height);
          if (mapped && (mapped.x<-.01 || mapped.y<-.01 || mapped.x+mapped.width>tw+.01 || mapped.y+mapped.height>th+.01)) {
            const outer=draft.nodes[id] as GroupNode;
            if (!el.id || ref) draft.set({...outer,name:"Mask group"});
            await viewportMask(el,id,at,tw,th,u);
          }
          nested=commonGroup(id,"Group",new Map());
        }
        const inner=map.some((v,i)=>v!==identity[i]) ? commonGroup(nested,"Group",new Map()) : nested;
        for (const child of target.children) await visit(child,inner,attached,targetStyle,units,depth+1,true);
        if (inner!==nested) finishGroup(inner,true);
        if (nested!==id) finishGroup(nested,true);
      } else await visit(target,id,at,style,local,depth+1,true);
      visited.delete(target);
      finishGroup(id,!el.id || ref);
      return;
    }
    const container=tag==="g" || tag==="a" || tag==="svg";
    const path=container ? undefined : elementPath(el,local);
    if (!container && tag!=="text" && tag!=="image" && !path?.length) return;
    let clip=localReference(el,style.get("clip-path"));
    const mask=localReference(el,style.get("mask"));
    const hadClip=!!clip;
    if (clip?.children.length===1 && !clip.hasAttribute("clip-path") && !style.get("filter") && clip.getAttribute("clipPathUnits")!=="objectBoundingBox") {
      const child=clip.children[0],outline=elementPath(child,local);
      const cm=(clip as SVGClipPathElement).transform.baseVal;
      const matrix=multiply(transformList(cm),elementMatrix(child));
      const rectangle=outline && placedPrimitive(outline,matrix,true);
      const bounds=contentBounds(el,local);
      const couldStroke=style.has("stroke") && style.get("stroke")!=="none" || el.querySelector('[stroke]:not([stroke="none"]),[style],use,text,image') || el.ownerDocument.getElementsByTagName("style").length>0;
      if (bounds && !couldStroke && rectangle?.kind==="rectangle" && !rectangle.radius && Math.abs(rectangle.xf[1])+Math.abs(rectangle.xf[2])<1e-9) {
        const r=transformBounds(rectangle.xf,rectangle.width,rectangle.height);
        if (r.x<=bounds.x+.01 && r.y<=bounds.y+.01 && r.x+r.width>=bounds.x+bounds.width-.01 && r.y+r.height>=bounds.y+bounds.height-.01) clip=undefined;
      }
    }
    if (mask && !mask.childElementCount) return;
    const filters=(style.get("filter")?.match(/url\([^)]+\)/g) ?? []).map(url=>localReference(el,url)).filter((f):f is Element=>f?.localName==="filter");
    let effects:Effect[]=[];
    for(const def of filters) {
      const computed=svgFilter(def,xf,cascade);
      if (!computed) {
        notes.add("filter "+filters.map(f=>f.id).join(", ")+" isn't a shadow or blur: the layer is drawn without it");
        effects=[];break;
      }
      effects.push(...computed);
    }
    const masked=!!clip || !!mask;
    const group=container || hadClip || masked || filters.length>0 || svgOpacity(style.get("opacity"))!==1 ||
      (style.get("mix-blend-mode") ?? "normal")!=="normal" || style.get("isolation")==="isolate" || el.hasAttribute("transform");
    const label=layerName(container && !ref ? el.id : null,masked ? "Mask group" : "Group");
    const outer=group ? commonGroup(parent,label,style) : parent;
    let content=outer;
    async function maskLayer(def:Element,kind:"vector"|"alpha"|"luminance") {
      if (visited.has(def)) return;
      visited.add(def);
      const id=commonGroup(content,kind==="vector" ? "Clip path" : "Mask",new Map());
      draft.set({...draft.nodes[id],isMask:true,maskType:kind} as GroupNode);
      let m=xf, maskUnits=local;
      if (def.getAttribute(kind==="vector" ? "clipPathUnits" : "maskContentUnits")==="objectBoundingBox") {
        const bounds=contentBounds(el,local);
        if (bounds) {
          m=multiply(xf,[bounds.width,0,0,bounds.height,bounds.x,bounds.y]);
          maskUnits={...local,width:1,height:1};
        }
      }
      const list=(def as SVGClipPathElement).transform?.baseVal;
      if (list) m=multiply(m,transformList(list));
      const own=cascade(def);
      for (const child of def.children) await visit(child,id,m,own,maskUnits,depth+1);
      visited.delete(def);
      finishGroup(id,true);
      if (localReference(def,own.get(kind==="vector" ? "clip-path" : "mask"))) notes.add(kind==="vector" ?
        "a clip path clipped by another clips by the first only" : "a mask masked by another masks by the first only");
    }
    if (clip) await maskLayer(clip,"vector");
    if (clip && mask) content=commonGroup(outer,"Mask group",new Map());
    if (mask) await maskLayer(mask,cascade(mask).get("mask-type")==="alpha" ? "alpha" : "luminance");
    const insideMask=content;
    if (effects.length) {
      if (masked) content=commonGroup(insideMask,"Group",new Map());
      draft.set({...draft.nodes[content],effects} as GroupNode);
    }
    if (container) {
      let inner=xf, childUnits=local,childParent=content;
      if (tag==="svg") {
        const width=svgLength(el.getAttribute("width"),u.width,u.font,u.width),height=svgLength(el.getAttribute("height"),u.height,u.font,u.height);
        const b=viewBox(el),viewport=viewportTransform(el,width,height);
        const at=multiply(xf,translated(svgLength(el.getAttribute("x"),u.width,u.font),svgLength(el.getAttribute("y"),u.height,u.font)));
        inner=multiply(at,viewport);
        childUnits={...local,width:b?.width ?? width,height:b?.height ?? height};
        const bounds=contentBounds(el,childUnits);
        if (bounds && style.get("overflow")!=="visible") {
          const mapped=transformBounds(multiply(viewport,translated(bounds.x,bounds.y)),bounds.width,bounds.height);
          if (mapped.x<-.01 || mapped.y<-.01 || mapped.x+mapped.width>width+.01 || mapped.y+mapped.height>height+.01) {
            if (!el.id || ref) draft.set({...draft.nodes[content],name:"Mask group"} as GroupNode);
            await viewportMask(el,content,at,width,height,local);
            if (inner.some((v,i)=>v!==xf[i])) childParent=commonGroup(content,"Group",new Map());
          }
        }
      }
      for (const child of el.children) await visit(child,childParent,inner,style,childUnits,depth+1,ref);
      if (childParent!==content) finishGroup(childParent,true);
    } else if (tag==="image") {
      await visitImage(content);
    } else if (tag==="text") {
      const outline=needsTextOutlines(el,style);
      const target=outline ? commonGroup(content,layerName(ref ? null : el.id,"Text"),new Map()) : content;
      if (outline) notes.add("text on a path, vertical or with rotated glyphs came in as outlines");
      const layers=await svgText(el,xf,style,local,cascade,resolvePaint,(text,label)=>({...base(outline ? "0" : fresh(),target,layerName(ref ? null : el.id,label)),
        kind:"text",text,textSizing:{horizontal:"hug",vertical:"hug"}}));
      for(const layer of layers) {
        if (!outline) {add(layer);continue;}
        for(const part of svgGlyphOutlines(el,layer,style)) {
          const box=pathBounds(part.path);
          if (!box) continue;
          const path=transformPath(part.path,translated(-box.x,-box.y));
          add(withRectanglePaints({...base(fresh(),target,"Vector",box.width,box.height),kind:"vector",x:box.x,y:box.y,
            network:networkFromPath(path),stroke:layer.stroke ?? sharedStroke,strokes:layer.strokes},part.fills));
        }
      }
      if (outline) finishGroup(target,true);
    } else await paintPath(el,content,xf,style,local,path!,ref);
    if (content!==insideMask) finishGroup(content,true);
    if (insideMask!==outer) finishGroup(insideMask,true);
    if (group) finishGroup(outer,!container || !el.id || ref);
  }

  const transform=tile?.transform ?? viewportTransform(root,w,h);
  const rootGroup=transform.some((v,i)=>v!==identity[i]);
  const container=rootGroup ? commonGroup(frame,"Group",rootStyle) : frame;
  for (const child of root.children) await visit(child,container,transform,rootStyle,units,0);
  if (rootGroup) finishGroup(container,true);
  finalise(frame);finalise(page.id);
  const result=draft.nodes[frame];
  if (result.kind!=="frame") throw new Error("SVG frame was removed");
  let width=w,height=h;
  if (!tile && !b && (!root.hasAttribute("width") || !root.hasAttribute("height"))) {
    let right=0,bottom=0;
    for (const child of result.children) {const box=worldRenderBounds(draft.document,child); if(box) {right=Math.max(right,box.x+box.width);bottom=Math.max(bottom,box.y+box.height);}}
    if (!root.hasAttribute("width") && right>0) width=right;
    if (!root.hasAttribute("height") && bottom>0) height=bottom;
  }
  const round=(n:number)=>Math.sign(n)*Math.round(Math.abs(n));
  draft.set({...result,x:centre ? round(x-width/2) : x,y:centre ? round(y-height/2) : y,width,height});
  const resultDoc=draft.finish();
  return {document:resources===doc ? resultDoc : {...resultDoc,images:resources.images},id:frame,nextId:next,warnings:[...notes].sort()};
}
