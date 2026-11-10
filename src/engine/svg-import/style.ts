import { svgNamespace } from "./xml";
import { identity, type Affine } from "../affine";

const inherited=new Set(("color fill fill-opacity fill-rule clip-rule stroke stroke-opacity stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset visibility font-family font-size font-style font-variant font-weight letter-spacing word-spacing text-anchor dominant-baseline paint-order").split(" "));
const properties=new Set([...inherited,...("display opacity mix-blend-mode isolation filter mask clip-path stop-color stop-opacity flood-opacity flood-color overflow mask-type text-decoration").split(" ")]);
export type SvgStyle = ReadonlyMap<string,string>;
type Declaration={name:string;value:string;important:boolean};
type Rule={selector:string;weight:number;values:Declaration[]};

function declarations(style:CSSStyleDeclaration) {
  const result:Declaration[]=[];
  for (const name of style) if (properties.has(name)) result.push({name,value:style.getPropertyValue(name).trim(),important:style.getPropertyPriority(name)==="important"});
  return result;
}

// SVG stylesheets in the input belong to the detached document. Never adopt them into the host.
export function svgCascade(root:Element) {
  const rules:Rule[]=[];
  for (const el of root.getElementsByTagNameNS(svgNamespace,"style")) {
    const sheet=new CSSStyleSheet();
    sheet.replaceSync(el.textContent ?? "");
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const values=declarations(rule.style);
      for (const selector of rule.selectorText.split(/,(?![^()]*\))/)) {
        const plain=selector.replace(/\[[^\]]*\]/g,".attr");
        const weight=(plain.match(/#[\w-]+/g)?.length ?? 0)*1e6
          +(plain.match(/[.:][\w-]+/g)?.length ?? 0)*1e3
          +(plain.match(/(?:^|\s|[>+~])\s*[\w-]+/g)?.length ?? 0);
        rules.push({selector,weight,values});
      }
    }
  }
  return (el:Element,parent?:SvgStyle):SvgStyle=>{
    const values=new Map<string,string>(), weights=new Map<string,number>();
    if (parent) for (const [name,value] of parent) if (inherited.has(name)) values.set(name,value);
    for (const attr of el.attributes) if (properties.has(attr.name)) values.set(attr.name,attr.value);
    function apply(ds:Declaration[],w:number) {
      for (const {name,value,important} of ds) {
        const weight=w+(important ? 1e12 : 0);
        if ((weights.get(name) ?? -1)>weight) continue;
        values.set(name,value);
        weights.set(name,weight);
      }
    }
    for (const rule of rules) if (el.matches(rule.selector)) apply(rule.values,rule.weight);
    if (el instanceof SVGElement) apply(declarations(el.style),1e9);
    for (const [name,value] of values) if (value==="inherit" || value==="initial" || value==="unset") {
      const fromParent=value==="inherit" || value==="unset" && inherited.has(name);
      const inheritedValue=fromParent && parent?.get(name);
      if (inheritedValue) values.set(name,inheritedValue);
      else values.delete(name);
    }
    return values;
  };
}

export interface SvgUnits { width:number;height:number;font:number }
export function svgLength(value:string|null|undefined,base:number,font:number,fallback=0) {
  if (value==null || value.trim()==="") return fallback;
  const m=/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|px|cm|mm|Q|in|pt|pc|em|ex)?$/i.exec(value.trim());
  if (!m) return fallback;
  const factors:Record<string,number>={"%":base/100,px:1,cm:96/2.54,mm:96/25.4,q:96/101.6,in:96,pt:96/72,pc:16,em:font,ex:font/2};
  const n=Number(m[1])*(factors[m[2]?.toLowerCase()] ?? 1);
  return Number.isFinite(n) ? Math.fround(n) : fallback;
}

export function svgOpacity(value:string|undefined,fallback=1) {
  return Math.fround(Math.min(1,Math.max(0,svgLength(value,1,1,fallback))));
}

export function elementMatrix(el:Element):Affine {
  if (!(el instanceof SVGGraphicsElement)) return identity;
  return transformList(el.transform.baseVal);
}

export function transformList(x:SVGTransformList):Affine {
  if (!x.numberOfItems) return identity;
  // consolidate mutates the source attribute, including the one read by later <use> references.
  let mat=new DOMMatrix();
  for(let i=0;i<x.numberOfItems;i++) mat=mat.multiply(x.getItem(i).matrix);
  return [mat.a,mat.b,mat.c,mat.d,mat.e,mat.f].map(Math.fround) as unknown as Affine;
}

export function viewBox(el:Element) {
  const text=el.getAttribute("viewBox")?.trim();
  if (!text) return;
  const [x,y,width,height,...extra]=text.split(/[\s,]+/).map(Number);
  if (!extra.length && width>0 && height>0 && [x,y,width,height].every(Number.isFinite)) return {x,y,width,height};
}

export function viewportTransform(el:Element,width:number,height:number,b=viewBox(el)):Affine {
  if (!b) return identity;
  let sx=width/b.width,sy=height/b.height;
  const [align,fit]=(el.getAttribute("preserveAspectRatio")?.trim() || "xMidYMid meet").replace(/^defer\s+/,"").split(/\s+/);
  if (align==="none") return [sx,0,0,sy,-b.x*sx,-b.y*sy];
  sx=sy=fit==="slice" ? Math.max(sx,sy) : Math.min(sx,sy);
  const anchor=(s:string)=>s==="Min" ? 0 : s==="Max" ? 1 : .5;
  return [sx,0,0,sy,(width-b.width*sx)*anchor(align.slice(1,4))-b.x*sx,(height-b.height*sy)*anchor(align.slice(5,8))-b.y*sy];
}
