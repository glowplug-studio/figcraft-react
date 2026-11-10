import {compareScalarKeys} from "../../text-breaks";
import {bound,colour,guid,items,num,obj} from "./fields";
import type {KiwiObject,KiwiValue} from "./kiwi";

function entries(n:KiwiObject,key:string) {return items(obj(n[key]).entries);}
function trackOrder(v:KiwiObject,key:string) {
  return entries(v,key).flatMap(v=>{
    const entry=obj(v),id=guid(entry.id);
    return id ? [{id,pos:typeof entry.position==="string" ? entry.position : ""}] : [];
  }).sort((a,b)=>compareScalarKeys(a.pos,b.pos) || compareScalarKeys(a.id,b.id)).map(e=>e.id);
}
function trackSize(v:KiwiValue|undefined) {
  const size=obj(v),min=obj(size.minSizing),max=obj(size.maxSizing);
  if (min.type!==max.type) return;
  if (min.type==="HUG") return "auto";
  const n=num(min.value);
  if (n===undefined || n!==num(max.value) || n<0 || n>1e6) return;
  if (min.type==="FIXED") return n+"px";
  if (min.type==="FLEX" && n>0) return n+"fr";
}
function gridAxis(n:KiwiObject,key:string,warn:(s:string)=>void) {
  const order=trackOrder(n,key), sizes=entries(n,key+"Sizing");
  if (entries(n,key).length>1000 || sizes.length>1000) {
    warn("grid track "+(entries(n,key).length>1000 ? "list" : "sizing list")+" exceeds 1000 entries; the tracks use the default equal sizing");
    return {count:order.length};
  }
  if (!sizes.length) return {count:order.length};
  const allowed=new Set(order), byId=new Map<string,KiwiValue|undefined>();
  for (const v of sizes) {
    const e=obj(v),id=guid(e.id);
    if (!id || !allowed.has(id)) {warn("stale or invalid grid track sizing entries were ignored");continue;}
    if (byId.has(id)) {warn("duplicate grid track sizing entries use equal tracks");byId.set(id,undefined);}
    else byId.set(id,e);
  }
  const tracks=order.map(id=>{
    const value=byId.get(id);
    if (!value) return "1fr";
    const size=trackSize(obj(value).trackSize);
    if (!size) warn("grid track sizing is unsupported or malformed; affected tracks use equal sizing");
    return size ?? "1fr";
  });
  return {count:order.length,css:tracks.join(" ")};
}
export function layoutFields(n:KiwiObject,parent:KiwiObject|undefined,warn:(s:string)=>void) {
  const result:Record<string,unknown>={layoutGrow:n.stackChildPrimaryGrow,layoutAlign:n.stackChildAlignSelf==="STRETCH" ? "STRETCH" : undefined,
    layoutPositioning:n.stackPositioning==="ABSOLUTE" ? "ABSOLUTE" : undefined};
  for (const [k,w,h] of [["minSize","minWidth","minHeight"],["maxSize","maxWidth","maxHeight"]]) {
    const val=obj(obj(n[k]).value),x=num(val.x),y=num(val.y);
    if (x!==undefined && x>0 && x<1e9) result[w]=x;
    if (y!==undefined && y>0 && y<1e9) result[h]=y;
  }
  if (parent?.stackMode==="GRID") for (const axis of ["Column","Row"]) {
    const key=guid(n["grid"+axis+"Anchor"]);
    if (key) {
      const i=trackOrder(parent,"grid"+axis+"s").indexOf(key);
      if (i>=0) result["grid"+axis+"AnchorIndex"]=i;
    }
    result["grid"+axis+"Span"]=n["grid"+axis+"Span"];
  }
  const mode=n.stackMode;
  if (mode!=="GRID" && mode!=="VERTICAL" && mode!=="HORIZONTAL") return result;
  const main=n.stackPrimaryAlignItems ?? n.stackJustify;
  const hug=(v:KiwiValue|undefined)=>typeof v==="string" && v.startsWith("RESIZE_TO_FIT");
  Object.assign(result,{
    layoutMode:mode,itemSpacing:n.stackSpacing,counterAxisSpacing:n.stackCounterSpacing,layoutWrap:n.stackWrap,
    counterAxisAlignContent:n.stackCounterAlignContent,paddingLeft:n.stackHorizontalPadding,paddingTop:n.stackVerticalPadding,
    paddingRight:n.stackPaddingRight ?? n.stackHorizontalPadding,paddingBottom:n.stackPaddingBottom ?? n.stackVerticalPadding,
    primaryAxisAlignItems:main==="SPACE_EVENLY" ? "SPACE_BETWEEN" : main==="SPACE_EVENLY_CSS" ? "SPACE_EVENLY" : main,
    counterAxisAlignItems:n.stackCounterAlignItems ?? n.stackAlign,strokesIncludedInLayout:n.bordersTakeSpace,itemReverseZIndex:n.stackReverseZIndex,
    primaryAxisSizingMode:hug(n.stackPrimarySizing) || mode!=="GRID" && n.stackPrimarySizing===undefined ? "AUTO" : "FIXED",
    counterAxisSizingMode:hug(n.stackCounterSizing) ? "AUTO" : "FIXED",
  });
  if (mode==="GRID") {
    const cols=gridAxis(n,"gridColumns",warn),rows=gridAxis(n,"gridRows",warn);
    Object.assign(result,{gridColumnGap:n.gridColumnGap,gridRowGap:n.gridRowGap,gridColumnCount:cols.count,gridRowCount:rows.count,
      gridColumnsSizing:cols.css,gridRowsSizing:rows.css});
  }
  return result;
}
export function guideGrids(input:KiwiValue|undefined) {
  return items(input).map(v=>{
    const g=obj(v);
    return {pattern:g.pattern==="GRID" ? "GRID" : g.axis==="Y" ? "ROWS" : "COLUMNS", alignment:g.type ?? "STRETCH",
      sectionSize:g.sectionSize,count:g.numSections,gutterSize:g.gutterSize,offset:g.offset,color:g.color && colour(g.color),
      visible:g.visible,boundVariables:bound(g,{numSectionsVar:"count",offsetVar:"offset",sectionSizeVar:"sectionSize",gutterSizeVar:"gutterSize"})};
  });
}
