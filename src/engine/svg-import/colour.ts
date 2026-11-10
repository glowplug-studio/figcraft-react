import { colour,fromRgba8,toCssHex,withAlpha,type Colour } from "../colour";
import { parseCssColour } from "../colour-css";
import { colourToOklch,convertColour,oklchToColour,type ColourProfile } from "../colour-spaces";

interface Value {color:Colour;missing:boolean[];warning?:string}
const channels=["r","g","b","a"] as const;
const fallback=fromRgba8(128,128,128);
const bad=(reason:string):never=>{throw new Error(reason);};
function number(s:string) {
  if (s==="none") return 0;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/.test(s)) return bad("a value isn't a number or a percentage");
  const n=s.endsWith("%") ? Math.fround(Number(s.slice(0,-1)))/100 : Number(s);
  if (!Number.isFinite(Math.fround(n))) return bad("a value isn't a number or a percentage");
  return Math.fround(n);
}

function split(value:string,comma:boolean) {
  const parts:string[]=[];
  let at=0,depth=0;
  for(let i=0;i<=value.length;i++) {
    const c=value[i];
    if (c==="(") depth++;
    else if (c===")") depth--;
    if (i===value.length || !depth && (comma ? c==="," : /\s/.test(c))) {
      const p=value.slice(at,i).trim();
      if (p || comma) parts.push(p);
      at=i+1;
    }
  }
  return parts;
}

function evaluate(value:string,profile:ColourProfile,depth:number):Value {
  const s=value.trim().toLowerCase(),inner=s.slice(s.indexOf("(")+1,-1);
  if (s.startsWith("color(")) {
    const [params,alpha="1"]=inner.split("/").map(v=>v.trim());
    const [space,...rgb]=params.split(/\s+/);
    if (rgb.length!==3) return bad(space==="from" ? "relative colours aren't read" : "a colour space and three values were expected");
    const c=colour(number(rgb[0]),number(rgb[1]),number(rgb[2]),number(alpha));
    return {color:convertColour(c,space==="display-p3" ? "displayP3" : "srgb",profile),missing:[...rgb,alpha].map(v=>v==="none"),
      ...(space!=="srgb" && space!=="display-p3" && {warning:"only the srgb and display-p3 spaces are read: its values were taken as sRGB"})};
  }
  if (!s.startsWith("color-mix(")) {
    const rgb=/^rgba?\((.+)\)$/.exec(s);
    const missing=rgb ? rgb[1].split(/[\s,/]+/).map(v=>v==="none") : [false,false,false,/\/\s*none\s*\)$/.test(s)];
    const c=parseCssColour(s.replace(/\bnone\b/g,"0"));
    if (!c) return bad("a mix colour isn't read");
    return {color:c,missing};
  }
  if (depth>=8) return bad("colour mixes are nested too deep");
  const args=split(inner,true);
  if (args.length!==3) return bad("color-mix() takes a method and two colours");
  const method=args[0].split(/\s+/).join(" ");
  if (!method.startsWith("in ")) return bad("color-mix() starts with `in` and a colour space");
  const known=["in srgb","in oklab","in oklch","in oklch shorter hue"].includes(method);
  const space=known ? method.split(" ")[1] : "srgb";
  function operand(input:string) {
    let words=split(input,false),percent:number|undefined;
    if (words.length===2) {
      if (words[0].endsWith("%")) words=words.reverse();
      if (!words[1].endsWith("%")) return bad("a mix colour is a colour and an optional percentage");
      percent=Number(words[1].slice(0,-1));
      if (!Number.isFinite(percent)) return bad("a mix colour is a colour and an optional percentage");
    } else if (words.length!==1) return bad("a mix colour is a colour and an optional percentage");
    return {...evaluate(words[0],profile,depth+1),percent};
  }
  const a=operand(args[1]),b=operand(args[2]);
  const pa=a.percent ?? (b.percent===undefined ? 50 : 100-b.percent),pb=b.percent ?? (100-pa),sum=pa+pb;
  if (Math.min(pa,pb)<0 || Math.max(pa,pb)>100) return bad("mix percentages are between 0% and 100%");
  if (sum<=0) return bad("mix percentages add up to 0%");
  const first={...a.color},second={...b.color};
  const missing=channels.map((key,i)=>{
    if (space!=="srgb" && i!==3) return false;
    if (a.missing[i] && b.missing[i]) return true;
    if (a.missing[i]) first[key]=second[key];
    if (b.missing[i]) second[key]=first[key];
    return false;
  });
  const t=Math.fround(pb/sum),alpha=Math.fround(first.a+(second.a-first.a)*t);
  const lerp=(x:number,y:number)=>alpha>0 ? (x*first.a+(y*second.a-x*first.a)*t)/alpha : x+(y-x)*t;
  let c:Colour;
  if (space==="srgb") c=colour(lerp(first.r,second.r),lerp(first.g,second.g),lerp(first.b,second.b));
  else {
    const a=colourToOklch(first),b=colourToOklch(second),l=lerp(a.l,b.l);
    if (space==="oklab") {
      const rad=Math.PI/180;
      const x=lerp(a.c*Math.cos(a.h*rad),b.c*Math.cos(b.h*rad)),y=lerp(a.c*Math.sin(a.h*rad),b.c*Math.sin(b.h*rad));
      c=oklchToColour({l,c:Math.hypot(x,y),h:Math.atan2(y,x)/rad});
    } else {
      let h1=a.c<.0002 ? b.h : a.h,h2=b.c<.0002 ? a.h : b.h;
      if (h2-h1>180) h1+=360; else if (h1-h2>180) h2+=360;
      c=oklchToColour({l,c:lerp(a.c,b.c),h:h1+(h2-h1)*t});
    }
  }
  return {color:withAlpha(c,alpha*Math.min(1,sum/100)),missing,warning:known ? a.warning ?? b.warning : "only srgb, oklab and oklch mixes are read: it was mixed in sRGB"};
}

export function svgColourResolver(profile:ColourProfile,note:(text:string)=>void) {
  let count=0;
  return (value:string)=>{
    const re=/(?<![\w-])color(?:-mix)?\(/gi;
    let start=0,out="",match:RegExpExecArray|null;
    while ((match=re.exec(value))) {
      if (count>=100000) {note("only the first 100000 color() and color-mix() colours were read; the rest were left as they were");break;}
      count++;
      const open=re.lastIndex-1;
      let i=open,level=0,closed=false;
      for (;i<value.length && i-open<2048;i++) {
        if (value[i]==="(") level++;
        else if (value[i]===")" && --level===0) {closed=true;i++;break;}
      }
      const end=closed ? i : value.length,call=value.slice(match.index,end);
      let color=fallback,warning;
      if (closed) {
        try {const result=evaluate(call,profile,0);color=result.color;warning=result.warning;}
        catch (e) {warning=(e as Error).message;}
      } else warning="it isn't closed (or is too long to be a colour)";
      if (warning) {
        const prefix=Array.from(call.slice(0,161)).slice(0,80).join("");
        note("the colour `"+prefix+(prefix.length<call.length ? "…" : "")+"`: "+warning);
      }
      out+=value.slice(start,match.index)+toCssHex(color);
      re.lastIndex=start=end;
    }
    return start ? out+value.slice(start) : value;
  };
}

export function resolveSvgColours(root:Element,profile:ColourProfile,note:(text:string)=>void) {
  const resolve=svgColourResolver(profile,note);
  const attributes=new Set(["fill","stroke","stop-color","flood-color","lighting-color","color","solid-color","style"]);
  const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
  do {
    const el=walker.currentNode as Element;
    for(const a of el.attributes) if (attributes.has(a.name)) {
      const next=resolve(a.value);
      if (next!==a.value) a.value=next;
    }
    if (el.localName==="style") for(const n of el.childNodes) if (n.nodeType===Node.TEXT_NODE || n.nodeType===Node.CDATA_SECTION_NODE) {
      const text=n.textContent ?? "",next=resolve(text);
      if (next!==text) n.textContent=next;
    }
  } while(walker.nextNode());
}
