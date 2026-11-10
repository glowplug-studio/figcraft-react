import {layerSizing,type GridTrack} from "../../auto-layout";
import {isFrameLike,isLeaf,type LayerNode,type FrameLikeNode} from "../../document";
import {placeGridFlow} from "../../grid-placement";
import {layoutFingerprint} from "./layout";
import {derivedId,PenpotExportIds} from "./write-pages";
import {sourceValue,rounded,type Fields,type Warn} from "./write-geometry";

const containerKeys=["layout","layoutFlexDir","layoutWrapType","layoutGap","layoutGapType","layoutPadding","layoutPaddingType",
  "layoutJustifyContent","layoutJustifyItems","layoutAlignItems","layoutAlignContent","layoutGridDir","layoutGridColumns","layoutGridRows","layoutGridCells"];
const itemKeys=["layoutItemHSizing","layoutItemVSizing","layoutItemAbsolute","layoutItemMargin","layoutItemMarginType","layoutItemAlignSelf",
  "layoutItemMinW","layoutItemMaxW","layoutItemMinH","layoutItemMaxH"];
function copySource(n:LayerNode,keys:readonly string[],fields:Fields) {
  for (const key of keys) {
    const value=sourceValue(n,key);
    if (value!==undefined) fields[key]=value;
  }
}
const align={min:"start",center:"center",max:"end",baseline:"start",spaceBetween:"space-between",spaceAround:"space-around",spaceEvenly:"space-evenly"} as const;
const sizing={fixed:"fix",hug:"auto",fill:"fill"} as const;
function tracks(list:readonly GridTrack[],count:number) {
  return Array.from({length:count},(_,i)=>{
    const t=list[i];
    if (!t) return {type:"flex",value:1};
    if (t.sizing==="hug") return {type:"auto"};
    return t.sizing==="fixed" ? {type:"fixed",value:rounded(t.value)} : {type:"flex",value:rounded(Math.max(.001,t.value))};
  });
}

export class PenpotLayoutWriter {
  private preserved=new Map<string,boolean>();
  constructor(private ids:PenpotExportIds,private warn:Warn) {}

  private unchanged(n:LayerNode) {
    const saved=n.sourceMetadata?.["penpot.fp.layout"];
    if (!saved) return false;
    let match=this.preserved.get(n.id);
    if (match===undefined) {
      const kids=isLeaf(n) ? [] : n.children.flatMap(id=>{
        const child=this.ids.doc.nodes[id];
        return child && child.kind!=="page" ? [child] : [];
      });
      match=saved===layoutFingerprint(n,kids);
      this.preserved.set(n.id,match);
    }
    return match;
  }

  private grid(n:FrameLikeNode,kids:readonly string[],fields:Fields) {
    const layout=n.layout!,columns=Math.max(1,layout.gridColumns),rows=Math.max(1,layout.gridRows);
    // Even the smallest empty track exceeds eight bytes in the 16 MiB native JSON member.
    if (columns+rows>2_097_152) throw new Error("Penpot grid exceeds the JSON member limit");
    const {doc}=this.ids;
    const flow=kids.filter(id=>{
      const child=doc.nodes[id];
      return child && child.kind!=="page" && !child.childLayout?.absolute;
    });
    const {cells,rows:used}=placeGridFlow(doc,layout,flow);
    // Every empty cell writes a UUID twice. Avoid allocating maps that already exceed the member budget.
    let covered=0;
    for (const p of cells.values()) covered+=p.columnSpan*p.rowSpan;
    if (columns*used-covered>262144) throw new Error("Penpot grid exceeds the JSON member limit");
    const taken=new Map<number,Uint8Array>(),map:Fields=Object.create(null);
    const frame=this.ids.layers.get(n.id);
    function cell(r:number,c:number,rs:number,cs:number,position:string,alignSelf:string,justifySelf:string,shapes:string[]) {
      const id=derivedId(frame+":cell:"+r+":"+c);
      map[id]={id,row:r+1,rowSpan:rs,column:c+1,columnSpan:cs,position,alignSelf,justifySelf,shapes};
    }
    for (const [id,placement] of cells) {
      const {row,column,rowSpan,columnSpan}=placement,node=doc.nodes[id];
      const child=node.kind==="page" ? undefined : node.childLayout;
      for (let r=row;r<row+rowSpan;r++) {
        let slots=taken.get(r);
        if (!slots) taken.set(r,slots=new Uint8Array(Math.min(1000,columns)));
        slots.fill(1,column,column+columnSpan);
      }
      cell(row,column,rowSpan,columnSpan,child?.gridRow!==undefined && child.gridColumn!==undefined ? "manual" : "auto",
        child?.gridAlignV ? align[child.gridAlignV] : "auto",child?.gridAlignH ? align[child.gridAlignH] : "auto",[this.ids.layers.get(id)!]);
    }
    let empty=0;
    for (let r=0;r<used;r++) {
      const slots=taken.get(r);
      for (let c=0;c<columns;c++) if (!slots?.[c]) {
        if (++empty>262144) throw new Error("Penpot grid exceeds the JSON member limit");
        cell(r,c,1,1,"auto","auto","auto",[]);
      }
    }
    fields.layoutGridCells=map;
    fields.layoutGridColumns=tracks(layout.columnTracks,columns);
    fields.layoutGridRows=[...tracks(layout.rowTracks,rows),...tracks([],Math.max(0,used-rows))];
  }

  fields(n:LayerNode,type:string,kids:readonly string[],fields:Fields) {
    if (type==="frame" && isFrameLike(n)) this.container(n,kids,fields);
    const parent=this.ids.doc.nodes[n.parent],cl=n.childLayout,size=layerSizing(n);
    if (isFrameLike(parent) && parent.layout || cl || size.horizontal!=="fixed" || size.vertical!=="fixed") {
      fields.layoutItemHSizing=sizing[size.horizontal];
      fields.layoutItemVSizing=sizing[size.vertical];
      if (cl?.absolute) fields.layoutItemAbsolute=true;
      for (const [key,v] of [["layoutItemMinW",cl?.minWidth],["layoutItemMaxW",cl?.maxWidth],["layoutItemMinH",cl?.minHeight],["layoutItemMaxH",cl?.maxHeight]] as const)
        if (v!==undefined) fields[key]=rounded(v);
    }
    if (parent && parent.kind!=="page" && this.unchanged(parent)) copySource(n,itemKeys,fields);
  }

  private container(n:FrameLikeNode,kids:readonly string[],fields:Fields) {
    const al=n.layout;
    if (this.unchanged(n)) {
      const source:Fields={};
      copySource(n,containerKeys,source);
      if (Object.hasOwn(source,"layout") && (al?.mode!=="grid" || Object.hasOwn(source,"layoutGridCells"))) {
        Object.assign(fields,source);
        return;
      }
    }
    if (!al) return;
    const vertical=al.mode==="vertical",[p1,p2,p3,p4]=al.padding.map(rounded);
    fields.layoutPadding={p1,p2,p3,p4};
    fields.layoutPaddingType="multiple";
    fields.layoutGap={rowGap:rounded(vertical ? al.gap : al.crossGap),columnGap:rounded(vertical ? al.crossGap : al.gap)};
    fields.layoutGapType="multiple";
    fields.layoutAlignItems=align[al.crossAlign];
    if (al.mode==="grid") {
      Object.assign(fields,{layout:"grid",layoutGridDir:"row",layoutJustifyItems:al.mainAlign==="center" || al.mainAlign==="max" ? align[al.mainAlign] : "start",
        layoutJustifyContent:"start",layoutAlignContent:"start"});
      this.grid(n,kids,fields);
    } else {
      Object.assign(fields,{layout:"flex",layoutFlexDir:vertical ? "column" : "row",layoutWrapType:al.wrap ? "wrap" : "nowrap",
        layoutJustifyContent:align[al.mainAlign],layoutAlignContent:al.contentAlign==="spaceBetween" ? "space-between" : align[al.crossAlign]});
      if (al.crossAlign==="baseline") this.warn("Baseline alignment has no Penpot equivalent; exported as start");
    }
  }
}
