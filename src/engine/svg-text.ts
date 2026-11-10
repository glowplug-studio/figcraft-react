import { identity, multiply, type Affine } from "./affine";
import { rectanglePaints, type TextNode } from "./document";
import type { Paint } from "./solid-paint";
import { svgPath, svgMatrix, svgNumber as num, xmlText } from "./svg-format";
import { applyTextCase } from "./text-case";
import { decorationPath } from "./text-decorations";
import { textNodeLayout } from "./text-node-layout";
import { textSpans, textStyleKey } from "./text-ranges";
import { letterSpacingPx, textItalic, textWeight, type TextStyle } from "./text-style";

type Attrs = (p: Paint) => Promise<string | undefined>;
export function glyphPaintPaths(node: TextNode) {
  const {layout,dy} = textNodeLayout(node);
  const styles = textSpans(node.text);
  const styled = styles.some(s=>s.style.fills !== undefined);
  const groups = new Map<string,{parts:string[]; paints:readonly Paint[]}>();
  function group(style:TextStyle) {
    const key = styled ? textStyleKey(style) : "";
    let g = groups.get(key);
    if (!g) { g = {parts:[],paints:style.fills ?? rectanglePaints(node)}; groups.set(key,g); }
    return g.parts;
  }
  for (const span of styles) group(span.style);
  const offset:Affine = [1,0,0,1,0,dy];
  for (const glyph of layout.glyphs) {
    const scale = glyph.size / glyph.face.upem;
    const placement = multiply(offset,multiply(glyph.warp ?? identity,[scale,0,0,scale,glyph.x,glyph.y]));
    group(glyph.style).push(svgPath(glyph.face.outline(glyph.id,glyph.coordinates,true),placement));
  }
  for (const deco of layout.decorations) group(deco.style).push(svgPath(decorationPath(deco),offset));
  return [...groups.values()].map(g=>({d:g.parts.join(""),paints:g.paints}));
}

export async function liveSvgText(node:TextNode,xf:Affine,paint:Attrs) {
  const data = node.text, st = data.style, {layout,dy} = textNodeLayout(node);
  const chars = Array.from(data.characters), spans: string[] = [];
  function content(start:number,end:number) {
    return xmlText(applyTextCase(st.case,chars.slice(start,end).join("").replace(/[\r\n]+$/g,""),chars[start-2],chars[start-1]));
  }
  async function firstFill(paints: readonly Paint[]) {
    for (const p of paints) { const attrs = await paint(p); if (attrs) return attrs; }
    return ' fill="none"';
  }
  function span(x:number,y:number,start:number,end:number,attrs="") {
    spans.push('<tspan x="'+num(x)+'" y="'+num(y)+'"'+attrs+'>'+content(start,end)+'</tspan>');
  }
  const fill = await firstFill(rectanglePaints(node));
  for (const line of layout.lines) {
    const glyphs = layout.glyphs.slice(line.first,line.last);
    if (line.rtl || glyphs.some(g=>g.rtl) || !glyphs.some(g=>g.style.fills !== undefined)) {
      const g = layout.glyphs[line.first];
      span(g?.x ?? 0,g?.y ?? line.baseline,line.start,line.end);
      continue;
    }
    for (let i=0,start=line.start; i<glyphs.length;) {
      let j=i+1;
      const g = glyphs[i], key = textStyleKey(g.style);
      while (j<glyphs.length && textStyleKey(glyphs[j].style) === key) j++;
      const end = Math.min(chars.length,Math.max(start,glyphs[j]?.start ?? line.end));
      span(g.x,g.y,start,end,g.style.fills ? await firstFill(g.style.fills) : "");
      i=j; start=end;
    }
  }
  if (!spans.length) span(0,st.fontSize*.8,0,chars.length);
  const matrix = svgMatrix(multiply(xf,[1,0,0,1,0,dy])), spacing = letterSpacingPx(st);
  return '<text transform="'+matrix+'" font-family="'+xmlText(st.fontFamily)+'" font-size="'+num(st.fontSize)+'" font-weight="'+textWeight(st)+'"'+
    (textItalic(st) ? ' font-style="italic"' : '')+(spacing ? ' letter-spacing="'+num(spacing)+'"' : '')+fill+' xml:space="preserve">'+spans.join("")+'</text>';
}
