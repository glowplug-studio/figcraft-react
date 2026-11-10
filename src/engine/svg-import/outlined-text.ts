import { identity,multiply,type Affine } from "../affine";
import type { PathCommand } from "../corners";
import { layerTransform,rectanglePaints,type TextNode } from "../document";
import type { Paint } from "../solid-paint";
import { glyphPath } from "../text-glyph-path";
import { svgOutlineLayout,textNodeLayout } from "../text-node-layout";
import { textStyleAt } from "../text-ranges";
import { translated,transformPath } from "./geometry";
import type { SvgStyle } from "./style";
import { uprightGlyph } from "./vertical-orientation";

function rotation(angle:number):Affine {
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return [c,s,-s,c,0,0];
}
function rotations(el:Element) {
  return (el.getAttribute("rotate") ?? "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
}
export function needsTextOutlines(el:Element,style:SvgStyle) {
  const vertical=style.get("writing-mode");
  return vertical==="tb" || vertical==="tb-rl" || vertical?.startsWith("vertical") || rotations(el).some(v=>v!==0)
    || Array.from(el.querySelectorAll("tspan[rotate]")).some(span=>rotations(span).some(v=>v!==0)) ||
    el.getElementsByTagNameNS(el.namespaceURI,"textPath").length>1;
}
export function svgGlyphOutlines(el:Element,n:TextNode,style:SvgStyle) {
  const vertical=["tb","tb-rl","vertical-rl","vertical-lr"].includes(style.get("writing-mode") ?? "");
  const base=rectanglePaints(n),rot=rotations(el),angles:number[]=[];
  // Nested tspan rotation lists override the inherited list for their characters.
  let at=0;
  function visit(node:Element,inherited:number[],origin:number) {
    const own=node.hasAttribute("rotate") ? rotations(node) : inherited;
    const start=node.hasAttribute("rotate") ? at : origin;
    for(const c of node.childNodes) {
      if (c.nodeType===Node.TEXT_NODE) for(const _ of c.textContent ?? "") {
        angles.push(own[Math.min(own.length-1,at-start)] ?? 0);at++;
      } else if(c instanceof Element) visit(c,own,start);
    }
  }
  visit(el,rot,0);
  // usvg uses the bundled Inter face for all outline fallback spans while parsing.
  const faceStyle=(style:TextNode["text"]["style"])=>({...style,fontFamily:"Inter",fontStyle:"Regular"});
  const layout=svgOutlineLayout({...n.text,style:faceStyle(n.text.style),runs:n.text.runs.map(r=>({...r,style:faceStyle(r.style)}))});
  const baseline=layout.lines[0]?.baseline ?? 0,chars=Array.from(n.text.characters);
  const anchor=n.text.alignH==="center" ? .5 : n.text.alignH==="right" ? 1 : 0;
  const baseXf=multiply(layerTransform(n),translated(anchor*n.width,textNodeLayout(n).layout.lines[0]?.baseline ?? 0));
  const world=vertical ? multiply(baseXf,[0,1,-1,0,0,0]) : baseXf;
  const out:{path:PathCommand[];fills:readonly Paint[]}[]=[];
  let prev:readonly Paint[]|undefined;
  for(const g of layout.glyphs) {
    const paint=textStyleAt(n.text,g.start).fills ?? base;
    const middle=(g.face.ascent-g.face.descent)*g.size/g.face.upem/2;
    const upright=vertical && uprightGlyph(chars[g.start]?.codePointAt(0) ?? 0);
    const dy=vertical && !upright ? middle : 0;
    let xf=multiply(world,translated(g.x-anchor*layout.width,g.y-baseline+dy));
    if (angles[g.start]) xf=multiply(xf,rotation(angles[g.start]));
    if (upright) xf=multiply(xf,multiply(translated(g.advance/2,0),multiply(rotation(-90),translated(-g.advance/2,middle))));
    const path=transformPath(glyphPath({...g,x:0,y:0,warp:g.warp ?? identity}),xf);
    if (!path.length) continue;
    if (!out.length || prev!==paint) {out.push({path:[],fills:paint});prev=paint;}
    for(const c of path) out[out.length-1].path.push(c);
  }
  return out;
}
