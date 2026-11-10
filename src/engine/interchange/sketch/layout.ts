import {children,clamp,numeric,object,string,type JsonObject} from "../rest/values";
import type {SketchNode} from "./geometry";

export function sketchExtras(l:JsonObject,n:SketchNode,height:number,warn:(s:string)=>void) {
  const flow=object(l.flow),dest=string(flow.destinationArtboardID);
  if (dest) {
    const dir=["","LEFT","RIGHT","TOP","BOTTOM"][Number(flow.animationType)];
    const action=dest==="back" ? {type:"BACK"} : {type:"NODE",destinationId:dest,navigation:"NAVIGATE",
      transition:dir ? {type:"SLIDE_IN",direction:dir,duration:.3,easing:{type:"EASE_IN_AND_OUT"}} : null};
    n.interactions=[{trigger:{type:"ON_CLICK"},actions:[action]}];
  }
  const presets=[];
  for (const raw of children(object(l.exportOptions).exportFormats).slice(0,64)) {
    const f=object(raw),id=(string(f.fileFormat) ?? "png").toLowerCase(),format=id==="jpeg" ? "JPG" : id.toUpperCase();
    if (!["PNG","JPG","SVG","PDF","WEBP"].includes(format)) {warn("export settings in formats FigCraft doesn't export (TIFF, EPS, HEIC) were skipped");continue;}
    const size=numeric(f.absoluteSize) ?? 0,unit=size>0 ? f.visibleScaleType : 0,scale=numeric(f.scale) ?? 1;
    const constraint=unit===1 || unit===2 ? {type:unit===1 ? "WIDTH" : "HEIGHT",value:Math.min(16384,size)} : {type:"SCALE",value:Math.min(64,scale>0 ? scale : 1)};
    const suffix=Array.from(string(f.name) ?? "").slice(0,200).join("");
    if (suffix && f.namingScheme===1) warn("export names Sketch puts before the layer name come after it");
    presets.push({format,suffix,constraint});
  }
  if (presets.length) n.exportSettings=presets;
  if (["FRAME","COMPONENT","INSTANCE"].includes(String(n.type))) {
    const g=object(l.layout),grid=object(l.grid),guides=[];
    const number=(k:string)=>{const v=numeric(g[k]);return v!==undefined && v>=0 ? v : undefined;};
    const count=number("numberOfColumns"),width=number("columnWidth");
    if (g.isEnabled!==false && g.drawVertical!==false && count!==undefined && width!==undefined) guides.push({
      pattern:"COLUMNS",alignment:"MIN",count:Math.min(1000,count),sectionSize:Math.min(1e5,width),gutterSize:Math.min(1e5,number("gutterWidth") ?? 0),
      offset:Math.min(1e5,number("horizontalOffset") ?? 0),visible:false});
    if (g.isEnabled!==false && g.drawHorizontal===true) {
      const gutter=Math.min(1e5,number("gutterHeight") ?? 0),section=Math.min(1e5,gutter*(number("rowHeightMultiplication") ?? 1));
      if (section>0) guides.push({pattern:"ROWS",alignment:"MIN",count:clamp(Math.floor(height/(section+gutter)),1,1000),sectionSize:section,gutterSize:gutter,offset:0,visible:false});
    }
    const size=numeric(grid.gridSize);
    if (grid.isEnabled!==false && size!==undefined && size>0) guides.push({pattern:"GRID",sectionSize:Math.min(1e5,size),visible:false});
    if (guides.length) n.layoutGrids=guides;
  }
  if (object(l.groupLayout)._class==="MSImmutableInferredGroupLayout") warn("Smart Layout was imported as laid out; it doesn't resize with its content");
  if (children(l.overrideProperties).some(p=>object(p).canOverride===false)) warn("overrides Sketch symbols locked can be changed in FigCraft");
}
export function sketchStack(l:JsonObject,n:SketchNode,kids:SketchNode[]) {
  const g=object(l.groupLayout);
  if (g._class!=="MSImmutableFlexGroupLayout" || !["FRAME","COMPONENT","INSTANCE"].includes(String(n.type))) return;
  const integer=(key:string)=>Number.isInteger(g[key]) ? Number(g[key]) : 0;
  const row=integer("flexDirection")===0,fit=(v:unknown)=>v===1 ? "AUTO" : "FIXED",length=(x:unknown)=>clamp(numeric(x) ?? 0,0,1e5);
  Object.assign(n,{layoutMode:row ? "HORIZONTAL" : "VERTICAL",itemSpacing:length(g.allGuttersGap),
    primaryAxisAlignItems:["MIN","CENTER","MAX","SPACE_BETWEEN","SPACE_AROUND","SPACE_EVENLY"][integer("justifyContent")] ?? "MIN",
    counterAxisAlignItems:["MIN","CENTER","MAX"][integer("alignItems")] ?? "MIN",itemReverseZIndex:integer("stackingOrder")===0,
    strokesIncludedInLayout:g.bordersAffectLayout===true,primaryAxisSizingMode:fit(row ? l.horizontalSizing : l.verticalSizing),
    counterAxisSizingMode:fit(row ? l.verticalSizing : l.horizontalSizing),paddingLeft:length(l.leftPadding),paddingTop:length(l.topPadding),
    paddingRight:length(l.rightPadding),paddingBottom:length(l.bottomPadding)});
  if (g.wrappingEnabled===true) {n.layoutWrap="WRAP";n.counterAxisSpacing=length(g.crossAxisGutterGap);}
  const sources=new Map<string,JsonObject>();
  for (const item of children(l.layers)) {
    const child=object(item),id=string(child.do_objectID);
    if (id!==undefined && !sources.has(id)) sources.set(id,child);
  }
  const sizing=(v:unknown)=>v===1 ? "HUG" : v===2 ? "FILL" : "FIXED";
  for (const kid of kids) {
    const source=typeof kid.id==="string" && sources.get(kid.id);
    if (!source) continue;
    if (object(source.flexItem).ignoreLayout===true) {kid.layoutPositioning="ABSOLUTE";continue;}
    const stretch=integer("alignItems")===3,h=stretch && !row ? "FILL" : sizing(source.horizontalSizing),v=stretch && row ? "FILL" : sizing(source.verticalSizing);
    kid.layoutSizingHorizontal=h;kid.layoutSizingVertical=v;
    if ((row ? h : v)==="FILL") kid.layoutGrow=1;
    if ((row ? v : h)==="FILL") kid.layoutAlign="STRETCH";
  }
  kids.reverse();
}
