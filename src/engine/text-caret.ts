import { inverse, transformPoint } from "./affine";
import type { Rectangle } from "./geometry";
import type { FlowGlyph, FlowLine, layoutTextFlow } from "./text-flow";

type Layout = ReturnType<typeof layoutTextFlow>;

function lineGlyphs(layout:Layout,line:FlowLine) {
  return line.last<=layout.glyphs.length ? layout.glyphs.slice(line.first,line.last) : [];
}

function lineEnd(line:FlowLine,glyphs:readonly FlowGlyph[]) {
  let edge=line.rtl ? line.x+line.width : line.x;
  for (const g of glyphs) {
    if (g.end>g.start) edge=line.rtl ? Math.min(edge,g.x) : Math.max(edge,g.x+g.advance);
  }
  return edge;
}

function clusterX(g:FlowGlyph,index:number) {
  const fraction=(index-g.start)/(g.end-g.start);
  return g.x+g.advance*(g.rtl ? 1-fraction : fraction);
}

/** Indices count Unicode scalar values. Wrapped line ends belong to the following line. */
export function textCaret(layout:Layout,index:number):{x:number; line:number} {
  const {lines}=layout;
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (index<line.start || index>line.end || (index===line.end && i+1<lines.length)) continue;
    const glyphs=lineGlyphs(layout,line), g=glyphs.find(g=>g.start<=index && index<g.end);
    return {x:g ? clusterX(g,index) : lineEnd(line,glyphs),line:i};
  }
  const last=lines.at(-1);
  return {x:last ? lineEnd(last,lineGlyphs(layout,last)) : 0,line:Math.max(0,lines.length-1)};
}

/** Supply a visual left/right step only when the current line contains right-to-left text. */
export function textVisualStep(layout:Layout,index:number,right:boolean):number | undefined {
  const {x,line:i}=textCaret(layout,index), line=layout.lines[i];
  if (!line || line.last>layout.glyphs.length) return undefined;
  const glyphs=lineGlyphs(layout,line);
  if (!line.rtl && !glyphs.some(g=>g.rtl)) return undefined;
  const lastLine=i+1===layout.lines.length;
  const end=Math.max(line.start,line.end-Number(!lastLine && line.breakAfter));
  const positions=new Float64Array(end-line.start+1).fill(NaN);
  // Shaping can emit several glyphs for one cluster. The first glyph owns its caret positions.
  for (const g of glyphs) {
    for (let at=Math.max(line.start,g.start);at<g.end && at<=end;at++) {
      if (Number.isNaN(positions[at-line.start])) positions[at-line.start]=clusterX(g,at);
    }
  }
  const edge=lineEnd(line,glyphs);
  if (!lastLine && end===line.end) positions[end-line.start]=textCaret(layout,end).x;
  let next=right!==line.rtl ? index+1 : Math.max(0,index-1), best=Infinity;
  for (let at=line.start;at<=end;at++) {
    const value=positions[at-line.start], cx=Number.isNaN(value) ? edge : value;
    if (at===index || (right ? cx<=x+0.01 : cx>=x-0.01)) continue;
    const distance=Math.abs(cx-x);
    if (distance<best) { best=distance; next=at; }
  }
  return next;
}

export function textHit(layout:Layout,x:number,y:number):number {
  if (layout.onPath) {
    let best=Infinity, index=0;
    for (const g of layout.glyphs) {
      const m=g.warp;
      if (g.end<=g.start || !m || Math.abs(m[0]*m[3]-m[1]*m[2])<=1e-12) continue;
      const q=transformPoint(inverse(m),{x,y}), mid=g.x+g.advance/2;
      const distance=Math.hypot(q.x-mid,q.y-(g.y-g.size/3));
      if (distance<best) { best=distance; index=q.x<mid ? g.start : g.end; }
    }
    return index;
  }
  const line=layout.lines.find(l=>y<l.top+l.height) ?? layout.lines.at(-1);
  if (!line) return 0;
  for (const g of lineGlyphs(layout,line)) {
    if (g.end>g.start && x<g.x+g.advance/2) return g.rtl ? g.end : g.start;
  }
  if (line.rtl) return line.start;
  return line.breakAfter && line!==layout.lines.at(-1) ? Math.max(line.start,line.end-1) : line.end;
}

export function textSelectionRects(layout:Layout,start:number,end:number):Rectangle[] {
  const a=Math.min(start,end), b=Math.max(start,end), rects:Rectangle[]=[];
  for (const line of layout.lines) {
    const last=line===layout.lines.at(-1);
    const trailing=last && a<b && b>=line.start && line.start===line.end;
    if ((b<=line.start && !trailing) || a>line.end || (a===line.end && !last)) continue;
    const glyphs=lineGlyphs(layout,line);
    const add=(left:number,right:number)=>rects.push({x:left,y:line.top,width:Math.max(left+1,right)-left,height:line.height});
    if (trailing) {
      const x=lineEnd(line,glyphs);
      add(x,x+4);
    } else if (line.rtl || glyphs.some(g=>g.rtl)) {
      let span:{left:number;right:number} | undefined;
      for (const g of glyphs) {
        const ga=Math.max(a,g.start), gb=Math.min(b,g.end);
        if (ga>=gb) continue;
        const left=clusterX(g,g.rtl ? gb : ga), right=clusterX(g,g.rtl ? ga : gb);
        if (span && Math.abs(left-span.right)<0.5) span.right=Math.max(right,span.right);
        else {
          if (span) add(span.left,span.right);
          span={left,right};
        }
      }
      if (span) add(span.left,span.right);
    } else {
      const edge=lineEnd(line,glyphs);
      const left=a<=line.start ? glyphs.find(g=>g.end>g.start)?.x ?? edge : textCaret(layout,a).x;
      const right=b>=line.end ? edge+(line.breakAfter && !last && b>line.end-1 ? 4 : 0) : textCaret(layout,b).x;
      add(left,right);
    }
  }
  return rects;
}
