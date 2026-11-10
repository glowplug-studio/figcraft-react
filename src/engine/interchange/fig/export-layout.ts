import {layerSizing,type GridTrack} from "../../auto-layout";
import {isFrameLike,type Document,type DocumentNode,type LayerNode} from "../../document";
import type {ExportSetting} from "../../export-settings";
import type {LayoutGrid} from "../../shared-styles";
import type {KiwiObject} from "./kiwi";
export const figGuid=(localID:number,sessionID=1)=>({sessionID,localID});
export function figPosition(index:number) {
  let value="";
  for (let i=0;i<4;i++) {value=String.fromCharCode(33+index%94)+value;index=Math.floor(index/94);}
  return value;
}
export const guide=(g:LayoutGrid):KiwiObject=>({type:g.align.toUpperCase(),axis:g.kind==="rows" ? "Y" : "X",visible:g.visible,numSections:g.count,
  offset:g.offset,sectionSize:g.size,gutterSize:g.gutter,color:{...g.color},pattern:g.kind==="grid" ? "GRID" : "STRIPES"});
function preset(e:ExportSetting):KiwiObject {
  return {suffix:e.suffix,imageType:e.format==="jpg" ? "JPEG" : e.format==="webp" ? "PNG" : e.format==="vectorDrawable" ? "SVG" : e.format.toUpperCase(),
    constraint:{type:"CONTENT_"+e.size.by.toUpperCase(),value:e.size.value}};
}
export class FigLayoutWriter {
  readonly #tracks=new Map<string,{columns:number[];rows:number[]}>();
  constructor(readonly doc:Document,readonly allocate:()=>number,readonly warn:(s:string)=>void) {}
  #mainId(node:LayerNode) {
    let id=node.id;
    for (let i=0;i<32;i++) {
      const n=this.doc.nodes[id],next=n?.source ?? (n?.kind==="instance" ? n.component : undefined);
      if (!next || !this.doc.nodes[next]) break;
      id=next;
    }
    return id;
  }
  #sizing(ids:number[],tracks:readonly GridTrack[]) {
    const entries=[];
    for (const [i,track] of tracks.entries()) {
      if (i>=ids.length) break;
      const type=track.sizing==="hug" ? "HUG" : track.sizing==="fixed" ? "FIXED" : "FLEX",value=type==="HUG" ? 0 : track.value;
      if (value<0 || value>1e6 || !Number.isFinite(value) || type==="FLEX" && value===0) {this.warn("grid tracks whose size the format can't hold were written as equal tracks");continue;}
      const size={type,value};
      entries.push({id:figGuid(ids[i],2),trackSize:{minSizing:size,maxSizing:size}});
    }
    return entries.length ? {entries} : undefined;
  }
  apply(out:KiwiObject,n:LayerNode,parent:DocumentNode|undefined) {
    const sizing=layerSizing(n),cl=n.childLayout;
    if (isFrameLike(n)) {
      if (n.grids?.length) out.layoutGrids=n.grids.map(guide);
      const l=n.layout;
      if (l) {
        const [top,right,bottom,left]=l.padding,vertical=l.mode==="vertical";
        Object.assign(out,{stackMode:l.mode.toUpperCase(),stackWrap:l.wrap ? "WRAP" : "NO_WRAP",stackHorizontalPadding:left,stackVerticalPadding:top,
          stackPaddingRight:right,stackPaddingBottom:bottom,stackPrimaryAlignItems:l.mainAlign==="spaceEvenly" ? "SPACE_EVENLY_CSS" : l.mainAlign.replace(/[A-Z]/g,c=>"_"+c).toUpperCase(),
          stackCounterAlignItems:l.crossAlign.toUpperCase(),stackPrimarySizing:(vertical ? sizing.vertical : sizing.horizontal)==="hug" ? "RESIZE_TO_FIT" : "FIXED",
          stackCounterSizing:(vertical ? sizing.horizontal : sizing.vertical)==="hug" ? "RESIZE_TO_FIT" : "FIXED",bordersTakeSpace:l.strokesIncluded,stackReverseZIndex:l.reverseZ});
        if (l.mode==="grid") {
          const key=this.#mainId(n),previous=this.#tracks.get(key),count=(size:number)=>Array.from({length:Math.min(size,1000)},this.allocate);
          const tracks=previous && previous.columns.length===Math.min(l.gridColumns,1000) && previous.rows.length===Math.min(l.gridRows,1000) ? previous : {columns:count(l.gridColumns),rows:count(l.gridRows)};
          this.#tracks.set(key,tracks);
          const order=(ids:number[])=>({entries:ids.map((id,i)=>({id:figGuid(id,2),position:figPosition(i)}))});
          Object.assign(out,{gridColumnGap:l.gap,gridRowGap:l.crossGap,gridColumns:order(tracks.columns),gridRows:order(tracks.rows),
            gridColumnsSizing:this.#sizing(tracks.columns,l.columnTracks),gridRowsSizing:this.#sizing(tracks.rows,l.rowTracks)});
        } else Object.assign(out,{stackSpacing:l.gap,stackCounterSpacing:l.crossGap,stackCounterAlignContent:l.contentAlign==="spaceBetween" ? "SPACE_BETWEEN" : "AUTO"});
      }
    }
    if (n.exports?.length) {
      if (n.exports.some(e=>e.format==="webp")) this.warn("WebP export settings were written as PNG");
      if (n.exports.some(e=>e.format==="vectorDrawable")) this.warn("Android Vector Drawable (XML) export settings were written as SVG");
      out.exportSettings=n.exports.map(preset);
    }
    if (cl?.minWidth!==undefined || cl?.minHeight!==undefined) out.minSize={value:{x:cl.minWidth ?? 0,y:cl.minHeight ?? 0}};
    if (cl?.maxWidth!==undefined || cl?.maxHeight!==undefined) out.maxSize={value:{x:cl.maxWidth ?? Infinity,y:cl.maxHeight ?? Infinity}};
    if (!isFrameLike(parent) || !parent.layout) return;
    const vertical=parent.layout.mode==="vertical";
    if ((vertical ? sizing.vertical : sizing.horizontal)==="fill") out.stackChildPrimaryGrow=1;
    if ((vertical ? sizing.horizontal : sizing.vertical)==="fill") out.stackChildAlignSelf="STRETCH";
    if (cl?.absolute) out.stackPositioning="ABSOLUTE";
    const tracks=this.#tracks.get(this.#mainId(parent));
    if (parent.layout.mode==="grid" && tracks && cl) {
      if (cl.gridColumn!==undefined && tracks.columns[cl.gridColumn]!==undefined) out.gridColumnAnchor=figGuid(tracks.columns[cl.gridColumn],2);
      if (cl.gridRow!==undefined && tracks.rows[cl.gridRow]!==undefined) out.gridRowAnchor=figGuid(tracks.rows[cl.gridRow],2);
      if (cl.gridColumnSpan) out.gridColumnSpan=cl.gridColumnSpan;
      if (cl.gridRowSpan) out.gridRowSpan=cl.gridRowSpan;
    }
  }
}
