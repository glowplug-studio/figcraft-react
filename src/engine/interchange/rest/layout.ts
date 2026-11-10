import type { GridTrack } from "../../auto-layout";
import { colour } from "../../colour";
import { clamp, list, maximumSize, numeric, object, restColour, string, type JsonObject } from "./values";

function tokens(css:string,comma=false) {
  const parts:string[]=[];
  let start=0,depth=0;
  for (let i=0;i<css.length;i++) {
    const ch=css[i];
    if (ch==="(") depth++;
    else if (ch===")") depth=Math.max(0,depth-1);
    else if (!depth && (comma ? ch==="," : /\s/u.test(ch))) {
      if (css.slice(start,i).trim()) parts.push(css.slice(start,i));
      start=i+1;
    }
  }
  if (css.slice(start).trim()) parts.push(css.slice(start));
  return parts;
}
const equal:GridTrack={sizing:"fill",value:1};
function cssSize(value:string):GridTrack|undefined {
  if (["auto","min-content","max-content"].includes(value)) return {sizing:"hug",value:0};
  const match=/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px|fr)$/i.exec(value);
  if (!match || match[2]!==match[2].toLowerCase()) return;
  const n=Number(match[1]);
  if (!Number.isFinite(n) || n<0 || n>maximumSize) return;
  return match[2]==="px" ? {sizing:"fixed",value:n} : n>0 ? {sizing:"fill",value:n} : undefined;
}
function cssTrack(value:string):GridTrack {
  if (!value.startsWith("minmax(") || !value.endsWith(")")) return cssSize(value) ?? equal;
  const bounds=tokens(value.slice(7,-1),true).map(v=>cssSize(v.trim()));
  if (bounds.length!==2) return equal;
  const [min,max]=bounds;
  return max && (max.sizing==="fill" || min?.sizing===max.sizing && min.value===max.value) ? max : equal;
}
function tracks(value:unknown,count:number) {
  const result:GridTrack[]=[];
  for (const token of tokens(string(value) ?? "")) {
    const repeat=/^repeat\(\s*(\+?\d+)\s*,([\s\S]*)\)$/.exec(token);
    const times=repeat ? Number(repeat[1]) : 1;
    const items=repeat ? tokens(repeat[2],false).map(cssTrack) : [cssTrack(token)];
    if (!items.length) continue;
    for (let i=0;i<Math.min(count,times*items.length) && result.length<count;i++) result.push(items[i%items.length]);
    if (result.length>=count) break;
  }
  return result;
}
const len=(v:unknown,fallback=0)=>clamp(numeric(v) ?? fallback,0,maximumSize);
const align=(v:unknown)=>v==="CENTER" ? "center" : v==="MAX" ? "max" : "min";
export function restLayout(n:JsonObject) {
  const mode=n.layoutMode==="GRID" ? "grid" : n.layoutMode==="HORIZONTAL" ? "horizontal" : n.layoutMode==="VERTICAL" ? "vertical" : undefined;
  if (!mode) return;
  const count=(v:unknown)=>typeof v==="number" && v>=1 ? Math.trunc(Math.min(v,1000)) : 2;
  const columns=count(n.gridColumnCount), rows=count(n.gridRowCount), grid=mode==="grid";
  const main=n.primaryAxisAlignItems;
  return {mode,wrap:n.layoutWrap==="WRAP",gap:grid ? len(n.gridColumnGap) : clamp(numeric(n.itemSpacing) ?? 0,-maximumSize,maximumSize),
    cross_gap:len(grid ? n.gridRowGap : n.counterAxisSpacing),padding:[n.paddingTop,n.paddingRight,n.paddingBottom,n.paddingLeft].map(v=>len(v)),
    main_align:main==="SPACE_BETWEEN" ? "spaceBetween" : main==="SPACE_AROUND" ? "spaceAround" : main==="SPACE_EVENLY" ? "spaceEvenly" : align(main),
    cross_align:n.counterAxisAlignItems==="BASELINE" ? "baseline" : align(n.counterAxisAlignItems),
    content_align:n.counterAxisAlignContent==="SPACE_BETWEEN" ? "spaceBetween" : "auto",grid_columns:columns,grid_rows:rows,
    column_tracks:grid ? tracks(n.gridColumnsSizing,columns) : [],row_tracks:grid ? tracks(n.gridRowsSizing,rows) : [],
    strokes_included:n.strokesIncludedInLayout===true,reverse_z:n.itemReverseZIndex===true};
}
export function childLayout(n:JsonObject,own:string|undefined,parent:string|undefined) {
  const style=object(n.style),autoText=n.type==="TEXT" && style.textTruncation!=="ENDING";
  let h=autoText && style.textAutoResize==="WIDTH_AND_HEIGHT" ? "hug" : "fixed";
  let v=autoText && (style.textAutoResize==="HEIGHT" || h==="hug") ? "hug" : "fixed";
  if (own) {
    if ((own==="vertical" ? n.counterAxisSizingMode : n.primaryAxisSizingMode)!=="FIXED") h="hug";
    if ((own==="vertical" ? n.primaryAxisSizingMode : n.counterAxisSizingMode)!=="FIXED") v="hug";
  }
  if (parent) {
    const grow=(numeric(n.layoutGrow) ?? 0)>0, stretch=n.layoutAlign==="STRETCH";
    if (parent==="vertical" ? stretch : grow) h="fill";
    if (parent==="vertical" ? grow : stretch) v="fill";
  }
  const axis=(value:unknown,fallback:string)=>value==="FILL" || value==="HUG" || value==="FIXED" ? value.toLowerCase() : fallback;
  const size=(value:unknown)=>numeric(value)===undefined ? null : len(value);
  const index=(value:unknown)=>typeof value==="number" && value>=0 ? Math.trunc(Math.min(value,1000)) : null;
  const cell=(value:unknown)=>value==="MIN" || value==="MAX" || value==="CENTER" ? value.toLowerCase() : null;
  return {sizing_h:axis(n.layoutSizingHorizontal,h),sizing_v:axis(n.layoutSizingVertical,v),absolute:n.layoutPositioning==="ABSOLUTE",
    min_w:size(n.minWidth),min_h:size(n.minHeight),max_w:size(n.maxWidth),max_h:size(n.maxHeight),
    grid_column:index(n.gridColumnAnchorIndex),grid_row:index(n.gridRowAnchorIndex),grid_column_span:index(n.gridColumnSpan) ?? 0,
    grid_row_span:index(n.gridRowSpan) ?? 0,grid_align_h:cell(n.gridChildHorizontalAlign),grid_align_v:cell(n.gridChildVerticalAlign)};
}
export function layoutGrids(input:unknown) {
  return list(input).flatMap(value=>{
    const g=object(value),kind=string(g.pattern);
    if (kind!=="GRID" && kind!=="ROWS" && kind!=="COLUMNS") return [];
    const count=numeric(g.count) ?? 0;
    return [{kind:kind.toLowerCase(),size:len(g.sectionSize,kind==="GRID" ? 10 : 0),count:count>=1 && count<=1000 ? Math.trunc(count) : 0,
      gutter:len(g.gutterSize,20),offset:len(g.offset),align:g.alignment==="MIN" || g.alignment==="CENTER" || g.alignment==="MAX" ? g.alignment.toLowerCase() : "stretch",
      color:restColour(g.color) ?? (kind==="ROWS" ? colour(0,.4,1,.1) : colour(1,0,0,.1)),visible:g.visible!==false}];
  });
}
