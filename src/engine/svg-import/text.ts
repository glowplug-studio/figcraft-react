import { inverse,multiply,type Affine } from "../affine";
import { withLayerTransform,withRectanglePaints,type TextNode } from "../document";
import { newTextData,type StyleRun,type TextData } from "../text-data";
import { autoSizeText,hasFontFamily,prepareText,svgOutlineLayout,textNodeLayout } from "../text-node-layout";
import { normaliseRuns,sameTextStyle,scalarCount,textLayerName } from "../text-ranges";
import { defaultTextStyle,type TextStyle } from "../text-style";
import { svgTextPath } from "./text-path";
import { translated } from "./geometry";
import type { Paint } from "../solid-paint";
import type { PaintTarget } from "./gradient";
import { svgStroke } from "./paint";
import { svgLength,type SvgStyle,type SvgUnits } from "./style";

const sans=["Inter","Helvetica","Arial","Segoe UI","Roboto","Noto Sans","DejaVu Sans","Liberation Sans"];
const generic:Record<string,string[]>={
  serif:["Times New Roman","Times","Georgia","Noto Serif","DejaVu Serif","Liberation Serif"],
  monospace:["Menlo","Consolas","Courier New","Noto Sans Mono","DejaVu Sans Mono","Liberation Mono"],
  "sans-serif":sans,cursive:sans,fantasy:sans,"system-ui":sans,
};
function spanStyle(style:SvgStyle,font:number,scale:number):TextStyle {
  const names=(style.get("font-family") ?? "serif").split(",").map(n=>n.trim().replace(/^["']|["']$/g,""));
  const face=names.flatMap(n=>[n,...(generic[n.toLowerCase()] ?? [])]).find(hasFontFamily) ?? names.find(n=>!Object.hasOwn(generic,n.toLowerCase())) ?? "Inter";
  const weight=style.get("font-weight") ?? "400",bold=weight==="bold" ? 700 : Number(weight) || 400;
  const label=["Thin","Thin","Extra Light","Light","Regular","Medium","Semi Bold","Bold","Extra Bold","Black"][Math.min(9,Math.max(0,Math.round(bold/100)))];
  const italic=["italic","oblique"].includes(style.get("font-style") ?? "");
  const spacing=svgLength(style.get("letter-spacing"),font,font)*scale;
  const decoration=style.get("text-decoration") ?? "";
  return {...defaultTextStyle,fontFamily:face,fontStyle:italic ? label==="Regular" ? "Italic" : label+" Italic" : label,fontSize:font*scale,
    ...(spacing!==0 && {letterSpacing:{unit:"pixels",value:spacing}}),decoration:decoration.includes("underline") ? "underline" :
      decoration.includes("line-through") ? "strikethrough" : "none",case:style.get("font-variant")==="small-caps" ? "smallCaps" : "original"};
}
interface Span {text:string;style:TextStyle;svg:SvgStyle}
interface Line {x?:number;y:number;align:TextData["alignH"];spans:Span[];path?:Element}
const anchor=(a:TextData["alignH"])=>a==="center" ? .5 : a==="right" ? 1 : 0;

export async function svgText(el:Element,world:Affine,style:SvgStyle,units:SvgUnits,
  cascade:(el:Element,parent:SvgStyle)=>SvgStyle,
  resolvePaint:(el:Element,style:SvgStyle,key:"fill"|"stroke",units:SvgUnits,target:PaintTarget)=>Promise<Paint|undefined>,make:(text:TextData,name:string)=>TextNode) {
  await prepareText(el.textContent ?? "");
  const sx=Math.hypot(world[0],world[1]),sy=Math.hypot(world[2],world[3]);
  const pathText=el.getElementsByTagNameNS(el.namespaceURI,"textPath").length>0;
  const uniform=!pathText && sx>0 && Math.abs(sx-sy)<=1e-6*Math.max(sx,sy) && Math.abs(world[0]*world[2]+world[1]*world[3])<=1e-6*sx*sy;
  const scale=uniform ? sx : 1;
  const m:Affine=[world[0]/scale,world[1]/scale,world[2]/scale,world[3]/scale,world[4],world[5]];
  const lines:Line[]=[];
  let current:Line;
  function walk(node:Element,st:SvgStyle,font:number,preserve:boolean) {
    const len=(key:string,base:number)=>svgLength(node.getAttribute(key)?.trim().split(/[\s,]+/)[0],base,font);
    if (!current || node.hasAttribute("x") || node.hasAttribute("y") || node.localName==="textPath") {
      const a=st.get("text-anchor"),last=lines.at(-1);
      current={x:node.hasAttribute("x") || !last ? len("x",units.width)+len("dx",units.width) : undefined,
        y:(node.hasAttribute("y") ? len("y",units.height) : last?.y ?? 0)+len("dy",units.height),
        align:a==="middle" ? "center" : a==="end" ? "right" : "left",spans:[],...(node.localName==="textPath" && {path:node})};
      lines.push(current);
    }
    for(const child of node.childNodes) {
      if (child.nodeType===Node.TEXT_NODE || child.nodeType===Node.CDATA_SECTION_NODE) {
        let value=child.textContent ?? "";
        value=preserve ? value.replace(/[\t\n\r]/g," ") : value.replace(/[\n\r]/g,"").replace(/[ \t]+/g," ");
        if (!preserve && (!current.spans.length || current.spans.at(-1)?.text.endsWith(" "))) value=value.replace(/^ /,"");
        if (value) current.spans.push({text:value,style:spanStyle(st,font,scale),svg:st});
      } else if (child instanceof Element && ["tspan","a","textPath"].includes(child.localName)) {
        const own=cascade(child,st);
        if (own.get("display")==="none") continue;
        const f=own.get("font-size")===st.get("font-size") ? font : svgLength(own.get("font-size"),font,font,font);
        const space=child.getAttributeNS("http://www.w3.org/XML/1998/namespace","space");
        walk(child,own,f,space ? space==="preserve" : preserve);
      }
    }
  }
  const preserve=el.closest('[xml\\:space]')?.getAttribute("xml:space")==="preserve";
  walk(el,style,units.font,preserve);
  const filled=lines.filter(l=>l.spans.length);
  if (!preserve) for(const l of filled) l.spans[l.spans.length-1].text=l.spans.at(-1)!.text.trimEnd();
  const out:TextNode[]=[];
  let penX=0;
  for(let i=0;i<filled.length;) {
    const first=filled[i],x=first.x ?? penX;
    const pitch=(filled[i+1]?.y ?? first.y)-first.y;
    let j=i+1;
    while (j<filled.length && !first.path && pitch>0 && filled[j].align===first.align && filled[j].x!==undefined &&
      Math.abs(filled[j].x!-x)<.01 && Math.abs(filled[j].y-filled[j-1].y-pitch)<.01 &&
      sameTextStyle(filled[j].spans[0].style,first.spans[0].style)) j++;
    const block=filled.slice(i,j), content=block.map(l=>l.spans.map(s=>s.text).join("")).join("\n");
    i=j;
    if (!content || block.every(line=>line.spans.every(s=>s.svg.get("visibility")==="hidden"))) continue;
    const baseStyle=first.spans[0].style,strokeStyle=first.spans[0].svg;
    const base={...baseStyle,...(block.length>1 && {lineHeight:{unit:"pixels" as const,value:pitch*scale}})};
    const runs:StyleRun[]=[],spans:SvgStyle[]=[];
    let index=0;
    for(const l of block) {
      for(const span of l.spans) {
        const end=index+scalarCount(span.text);
        runs.push({start:index,end,style:{...span.style,lineHeight:base.lineHeight}});
        spans.push(span.svg);
        index=end;
      }
      index++;
    }
    let data:TextData={...newTextData(content),alignH:first.align,style:base,runs:normaliseRuns(runs,base,scalarCount(content))};
    let placed:Affine|undefined,size:{width:number;height:number}|undefined;
    if (first.path) {
      const trace=svgTextPath(first.path,units);
      if (!trace) continue;
      data={...data,path:trace.path};
      placed=multiply(world,translated(trace.box.x,trace.box.y));size={width:Math.max(1,trace.box.width),height:Math.max(1,trace.box.height)};
    }
    let n=autoSizeText(make(data,textLayerName(first.spans.map(s=>s.text).join(""))));
    if (size) n={...n,...size};
    const layout=textNodeLayout(n).layout,baseline=layout.lines[0]?.baseline ?? 0;
    const position=placed ?? multiply(m,translated(scale*x-anchor(first.align)*n.width,scale*first.y-baseline));
    const target:PaintTarget={toNode:multiply(inverse(position),world),width:n.width,height:n.height,
      bounds:{x:first.x ?? x,y:first.y-baseline/scale,width:n.width/scale,height:n.height/scale}};
    if (spans.some(s=>s.get("fill")?.startsWith("url(") || s.get("stroke")?.startsWith("url("))) {
      const regular=(s:TextStyle)=>({...s,fontFamily:"Inter",fontStyle:"Regular"});
      const original=svgOutlineLayout({...data,style:regular(data.style),runs:data.runs.map(r=>({...r,style:regular(r.style)}))});
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const g of original.glyphs) {
        const k=g.size/g.face.upem,dx=g.x-anchor(first.align)*original.width,dy=g.y-(original.lines[0]?.baseline ?? 0);
        left=Math.min(left,dx);right=Math.max(right,dx+g.advance);
        top=Math.min(top,dy-g.face.ascent*k);bottom=Math.max(bottom,dy+g.face.descent*k);
      }
      if (right>left && bottom>top) target.bounds={x:x+left/scale,y:first.y+top/scale,width:(right-left)/scale,height:(bottom-top)/scale};
    }
    const fills:(Paint|undefined)[]=[];
    for(const svg of spans) fills.push(svg.get("visibility")==="hidden" ? undefined : await resolvePaint(el,svg,"fill",units,target));
    const fill=fills[0];
    const painted=runs.map((run,i)=>JSON.stringify(fills[i])===JSON.stringify(fill) ? run :
      {...run,style:{...run.style,fills:fills[i] ? [fills[i]!] : []}});
    n={...n,text:{...n.text,runs:normaliseRuns(painted,base,scalarCount(content))}};
    const stroke=await resolvePaint(el,strokeStyle,"stroke",units,target);
    if (stroke) n={...n,strokes:[stroke],stroke:svgStroke(strokeStyle,units,scale,true)};
    out.push(withRectanglePaints(withLayerTransform(n,position),fill ? [fill] : []));
    penX=x+(1-anchor(first.align))*layout.width/scale;
  }
  return out;
}
