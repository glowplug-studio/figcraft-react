import type { Affine } from "../affine";
import { colour,withAlpha,type Colour } from "../colour";
import { parseCssColour } from "../colour-css";
import { readEffect,type Effect } from "../effects";
import { svgOpacity,type SvgStyle } from "./style";

interface Shadow {
  kind:"shadow"; dx:number; dy:number; sigma:number; spread:number; color:Colour;
  knockout:boolean; inner:boolean; inverted:boolean; cast:number;
}
type Layer={kind:"layer";sigma:number};
type Flood={kind:"flood";color:Colour};
type Atom=Shadow|Layer|Flood;
type Stack=readonly Atom[];
const black=colour(0,0,0);
const source:Layer={kind:"layer",sigma:0};
const alpha:Shadow={kind:"shadow",dx:0,dy:0,sigma:0,spread:0,color:black,knockout:false,inner:false,inverted:false,cast:0};
const plain=(s:Shadow)=>s.dx===0 && s.dy===0 && s.sigma===0 && s.spread===0 && !s.inner && !s.inverted && !s.knockout && !s.cast &&
  !s.color.r && !s.color.g && !s.color.b && s.color.a===1;
const tint=(s:Shadow,c:Colour):Shadow=>({...s,color:withAlpha(c,c.a*s.color.a)});
function combine(a:Stack|undefined,b:Stack|undefined):Stack|undefined {
  if (a && b && a.length+b.length<=1024) return [...a,...b];
}

function primitive(el:Element,get:(key:string|null)=>Stack|undefined,style:SvgStyle):Stack|undefined {
  const attr=(name:string)=>el.getAttribute(name);
  const number=(name:string,fallback=0)=>{const v=attr(name);return v===null ? fallback : Number(v);};
  const average=(key:string,fallback:number)=>{
    const v=(attr(key) ?? String(fallback)).trim().split(/[\s,]+/).map(Number);
    return Math.max(0,(v[0]+(v[1] ?? v[0]))/2);
  };
  const input=get(attr("in")),other=get(attr("in2") ?? "SourceGraphic");
  const a=input?.length===1 ? input[0] : undefined,b=other?.length===1 ? other[0] : undefined;
  const dx=number("dx",el.localName==="feDropShadow" ? 2 : 0),dy=number("dy",el.localName==="feDropShadow" ? 2 : 0);
  const flood=()=>{
    const c=parseCssColour(style.get("flood-color") ?? "black") ?? black;
    return withAlpha(c,c.a*svgOpacity(style.get("flood-opacity")));
  };
  switch(el.localName) {
    case "feOffset":
      if (a?.kind==="shadow") return [{...a,dx:a.dx+dx,dy:a.dy+dy}];
      if (!input?.length || a?.kind==="layer" && !dx && !dy) return input;
      return;
    case "feGaussianBlur":
      if (a?.kind==="shadow" || a?.kind==="layer") return [{...a,sigma:Math.hypot(a.sigma,average("stdDeviation",0))}];
      return input?.length===0 ? [] : undefined;
    case "feFlood": {
      const color=flood();
      return color.a>0 ? [{kind:"flood",color}] : [];
    }
    case "feMorphology":
      if (a?.kind==="shadow" && !a.sigma && !a.spread && !a.inner && !a.inverted)
        return [{...a,spread:average("radius",0)*(attr("operator")==="dilate" ? 1 : -1)}];
      return;
    case "feDropShadow":
      if (a?.kind==="layer") return [{...alpha,dx,dy,sigma:average("stdDeviation",2),color:flood()},a];
      return;
    case "feColorMatrix": {
      if ((attr("type") ?? "matrix")!=="matrix" || !a || a.kind==="flood") return;
      const m=(attr("values") ?? "").trim().split(/[\s,]+/).map(Number);
      if (m.length!==20 || !m.every(Number.isFinite) || m.some((n,i)=>n!==0 && ![4,9,14,18].includes(i))) return;
      const s=a.kind==="shadow" ? a : {...alpha,cast:a.sigma};
      if (m[18]>=100 && !m[4] && !m[9] && !m[14]) return [s];
      return [{...s,color:colour(m[4],m[9],m[14],s.color.a*m[18])}];
    }
    case "feComposite": {
      const op=attr("operator") ?? "over";
      if (op==="over") return combine(other,input);
      if (op==="in" && a?.kind==="flood" && b?.kind==="shadow") return [tint(b,a.color)];
      if (op==="in" && a?.kind==="shadow" && b?.kind==="flood") return [tint(a,b.color)];
      if (op==="out" && a?.kind==="flood" && b?.kind==="shadow" && !b.inner && !b.inverted) return [{...tint(b,a.color),inverted:true}];
      if (a?.kind!=="shadow") return;
      if (b?.kind==="shadow" && plain(b)) {
        if (op==="in" && a.inverted) return [{...a,inverted:false,inner:true}];
        if (op==="out" && !a.inner && !a.inverted) return [{...a,knockout:true}];
        if (op==="arithmetic" && !number("k1") && number("k2")===-1 && number("k3")===1 && !number("k4") && !a.inner)
          return [{...a,inner:true}];
      }
      if (op==="out" && b?.kind==="layer" && b.sigma>0 && b.sigma===a.cast && !a.inner && !a.inverted) return [{...a,knockout:true}];
      return;
    }
    case "feBlend":
      return (attr("mode") ?? "normal")==="normal" ? combine(other,input) : undefined;
    case "feMerge": {
      let layers:Stack=[];
      for(const child of el.children) {
        if (child.localName!=="feMergeNode") continue;
        const next=combine(layers,get(child.getAttribute("in")));
        if (!next) return;
        layers=next;
      }
      return layers;
    }
  }
}

export function svgFilter(filter:Element,world:Affine,cascade:(el:Element,parent?:SvgStyle)=>SvgStyle):Effect[]|undefined {
  const results=new Map<string,Stack>([["SourceGraphic",[source]],["SourceAlpha",[alpha]]]);
  let last:Stack=[source];
  const style=cascade(filter);
  for(const el of Array.from(filter.children).slice(0,64)) {
    const output=primitive(el,key=>key ? results.get(key) : last,cascade(el,style));
    if (!output) return;
    last=output;
    if (el.hasAttribute("result")) results.set(el.getAttribute("result")!,last);
  }
  const at=last.findIndex(item=>item.kind==="layer"),drawn=last[at];
  if (drawn?.kind!=="layer" || last.filter(item=>item.kind==="layer").length!==1) return;
  const k=Math.sqrt(Math.abs(world[0]*world[3]-world[1]*world[2]));
  const effects:Effect[]=[];
  for(const [i,l] of last.entries()) {
    if (l.kind==="layer") {
      if (l.sigma>0) effects.push(readEffect({type:"layerBlur",radius:2*l.sigma*k},"command"));
    } else {
      if (l.kind!=="shadow" || l.inverted || l.inner!==(i>at) || l.cast>0 && (l.cast!==drawn.sigma || l.inner)) return;
      effects.push(readEffect({type:l.inner ? "innerShadow" : "dropShadow",radius:2*l.sigma*k,spread:l.spread*k,blend:"normal",
        offset:[world[0]*l.dx+world[2]*l.dy,world[1]*l.dx+world[3]*l.dy],color:l.color,showBehind:!l.inner && !l.knockout},"command"));
    }
  }
  return effects;
}
