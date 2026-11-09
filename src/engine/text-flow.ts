import type { FontLibrary } from "./font-library";
import type { ShapingFace } from "./shaping-face";
import type { TextData } from "./text-data";
import { textBidi, visualGaps, visualOrder } from "./text-bidi";
import { TextGraphemes } from "./text-graphemes";
import { shapeTextSpans, type StyledGlyph } from "./styled-glyphs";
import { hardBreak, TextLineBreaker, type TextLineRange } from "./text-line-breaker";
import { TextListLayout } from "./text-list-layout";
import { paragraphList, textSpans } from "./text-ranges";
import { lineHeightPx, textSize, type TextStyle } from "./text-style";
import { isWrapSpace, justifyBetween } from "./text-wrap-boundaries";

export interface FlowGlyph {
  face:ShapingFace; coordinates:Readonly<Record<string,number>>; style:TextStyle; id:number;
  start:number; end:number; x:number; y:number; advance:number; size:number; rtl:boolean;
}
export interface FlowLine {
  first:number; last:number; start:number; end:number; width:number; height:number; top:number;
  baseline:number; x:number; paragraphEnd:boolean; breakAfter:boolean; rtl:boolean;
}

const paragraphSpace=(v:number)=>Number.isFinite(v) ? Math.min(10000,Math.max(0,v)) : 0;
function lineMetrics(style:TextStyle,face:ShapingFace | undefined) {
  const size=textSize(style), k=face ? size/face.upem : 0;
  const ascent=face ? face.ascent*k : size*0.8, descent=face ? face.descent*k : size*0.2;
  const ratio=face ? Math.max(0.5,(face.ascent+face.descent+Math.max(0,face.lineGap))/face.upem) : 1.2;
  const lineHeight=lineHeightPx(style,ratio,size);
  return {ascent,descent,height:lineHeight>=1 ? Math.floor(lineHeight+0.5) : lineHeight,cap:face ? face.capHeight*k : size*0.7};
}

function appendGlyph(out:FlowGlyph[], g:StyledGlyph, c:string, pen:number, baseline:number) {
  if (g.id || !isWrapSpace(c)) out.push({face:g.face,coordinates:g.coordinates,style:g.style,id:g.id,start:g.start,end:g.end,
    x:pen+g.offsetX,y:baseline-g.offsetY,size:g.size,advance:g.advance,rtl:g.level%2===1});
}

function finishTruncatedLine(glyphs:FlowGlyph[], line:FlowLine, next:TextLineRange | undefined,
  items:readonly StyledGlyph[], chars:readonly string[], wrap:number | undefined) {
  if (wrap!==undefined && next && !line.paragraphEnd && !line.breakAfter && !line.rtl) {
    const last=line.last>line.first ? glyphs[line.last-1] : undefined;
    let pen=last ? last.x+last.advance : line.width;
    for (let i=next.start;i<next.end && pen<=wrap;i++) {
      const g=items[i], c=chars[g.start];
      if (hardBreak(c)) continue;
      appendGlyph(glyphs,g,c,pen,line.baseline);
      pen+=g.advance;
    }
    line.last=glyphs.length;
  }
  const last=glyphs[Math.max(0,line.last-1)];
  if (!last) return;
  const face=last.face, mark=face.glyphFor(0x2026) ? "…" : ".";
  const [ellipsis]=face.nominalRun(mark,last.coordinates,last.size);
  while (glyphs.length>line.first) {
    const g=glyphs[glyphs.length-1];
    if (g.x+g.advance+ellipsis.advance<=(wrap ?? Infinity)) break;
    glyphs.pop();
  }
  while (glyphs.length>line.first) {
    const g=glyphs[glyphs.length-1];
    if (g.end<=g.start || g.id!==g.face.glyphFor(32)) break;
    glyphs.pop();
  }
  const previous=glyphs.length>line.first ? glyphs[glyphs.length-1] : undefined;
  const x=previous ? previous.x+previous.advance : 0;
  glyphs.push({...last,...ellipsis,x,y:line.baseline,start:last.end,end:last.end,rtl:false});
  line.last=glyphs.length;
  line.width=x+ellipsis.advance;
  for (let i=line.first;i<line.last;i++) if (glyphs[i].end>glyphs[i].start) line.end=Math.max(line.end,glyphs[i].end);
}

/** Flow geometry before text-path warping and decoration painting.
 * wordStarts supplies scalar word boundaries for scripts written without spaces. */
export function layoutTextFlow(text:TextData, fonts:FontLibrary, box:{width?:number; height?:number}, wordStarts:ArrayLike<number>) {
  const boxWidth=box.width;
  const chars=Array.from(text.characters), boundaries=new TextGraphemes(text.characters);
  const bidi=textBidi(text.characters,text.paragraphs);
  const rtlAt=(i:number)=>!!bidi?.paragraphRtl[i];
  const items=[...shapeTextSpans(text,fonts,bidi?.levels,chars,boundaries)];
  const firstStyle=items[0]?.style ?? textSpans(text)[0].style;
  const defaultFace=fonts.defaultFace(), primary=new Map<TextStyle,ShapingFace | undefined>();
  const faceFor=(style:TextStyle)=>{
    if (!primary.has(style)) primary.set(style,fonts.find(style.fontFamily,style.fontStyle) ?? defaultFace);
    return primary.get(style);
  };
  const primaryFace=faceFor(firstStyle);
  let paragraphCount=1;
  for (const c of chars) if (c==="\n") paragraphCount++;
  const lists=Array.from({length:paragraphCount},(_,i)=>paragraphList(text,i));
  const listLayout=new TextListLayout(lists,firstStyle,primaryFace);
  const hang=text.hangingList ? listLayout.step : 0;
  const indent=(p:number,first:boolean,source:number)=>{
    const list=lists[p], level=listLayout.step*(list.indent+1)-hang;
    if (list.list!=="none") return level;
    const aligned=rtlAt(source) ? text.alignH==="right" : text.alignH==="left";
    return (list.indent>0 ? level : 0)+(first && aligned ? paragraphSpace(text.paragraphIndent) : 0);
  };
  const wrap=text.autoResize!=="widthAndHeight" && boxWidth!==undefined && Number.isFinite(boxWidth) && boxWidth>0 ? boxWidth : undefined;
  const breaker=new TextLineBreaker(text,items,chars,boundaries,wordStarts,rtlAt,indent);
  const ranges=breaker.wrap(wrap), glyphs:FlowGlyph[]=[], lines:FlowLine[]=[];
  const metrics=new Map<TextStyle,ReturnType<typeof lineMetrics>>();
  const metric=(style:TextStyle)=>{
    let value=metrics.get(style);
    if (!value) { value=lineMetrics(style,faceFor(style)); metrics.set(style,value); }
    return value;
  };
  let y=0, firstCap=0, paragraphStart=true, widest=0;
  const maxLines=text.maxLines>0 && text.autoResize!=="none" ? text.maxLines : Infinity;
  let truncated=false;
  for (const {start,end,paragraph,paragraphEnd} of ranges) {
    if (lines.length>=maxLines) { truncated=true; break; }
    const initial=items[start], source=initial?.start ?? chars.length;
    const lastItem=end ? items[end-1] : undefined;
    let ascent=0, descent=0, height=0, cap=0;
    let prev:TextStyle | undefined;
    for (let i=start;i<end;i++) {
      const style=items[i].style;
      if (prev===style) continue;
      prev=style;
      const m=metric(style);
      ascent=Math.max(ascent,m.ascent); descent=Math.max(descent,m.descent);
      height=Math.max(height,m.height); cap=Math.max(cap,m.cap);
    }
    if (start===end) ({ascent,descent,height,cap}=metric(items[Math.max(0,start-1)]?.style ?? firstStyle));
    if (!lines.length) firstCap=cap;
    else if (paragraphStart) y+=paragraphSpace(lists[paragraph].list!=="none" && lists[paragraph-1]?.list!=="none" ? text.listSpacing : text.paragraphSpacing);
    const baseline=y+(height-(ascent+descent))/2+ascent;
    let vis=end;
    const charAt=(i:number)=>chars[items[i].start];
    while (vis>start && (isWrapSpace(charAt(vis-1)) || hardBreak(charAt(vis-1)))) vis--;
    let width=0;
    for (let i=start;i<vis;i++) width+=items[i].advance;
    if (vis>start) width-=items[vis-1].spacing;
    const lineIndent=indent(paragraph,paragraphStart,source), rtl=rtlAt(source);
    const [left,right]=vis>start ? breaker.hanging(start,vis) : [0,0];
    const levels=new Uint8Array(end-start), gaps:boolean[]=[];
    let gapCount=0;
    for (let i=start;i<end;i++) {
      const c=charAt(i), next=items[i+1];
      const widens=isWrapSpace(c) && c!=="\u200b" || (i+1<vis && next.start>items[i].start && boundaries.isBoundary(next.start) && justifyBetween(c,charAt(i+1)));
      gaps.push(widens);
      if (widens && i<vis) gapCount++;
      levels[i-start]=i>=vis ? Number(rtl) : items[i].level;
    }
    const breakAfter=!!lastItem && hardBreak(chars[lastItem.start]);
    const extra=text.alignH==="justified" && wrap!==undefined && !paragraphEnd && !breakAfter && gapCount
      ? Math.max(0,(wrap-lineIndent+left+right-width)/gapCount) : 0;
    let trailing=0;
    if (rtl) for (let i=vis;i<end;i++) if (!hardBreak(charAt(i))) trailing+=items[i].advance+(gaps[i-start] ? extra : 0);
    let pen=rtl ? -trailing : lineIndent-left;
    const first=glyphs.length;
    if (paragraphStart && lists[paragraph].list!=="none") {
      const style=initial?.style ?? firstStyle;
      for (const g of listLayout.marker(paragraph,rtl,width+extra*gapCount,hang,style,faceFor(style),initial,primaryFace,fonts)) {
        glyphs.push({...g,style,start:source,end:source,y:baseline,rtl:false});
      }
    }
    const order=visualOrder(levels), at=extra ? visualGaps(levels,gaps,vis-start) : undefined;
    for (let j=0;j<order.length;j++) {
      const i=start+order[j], g=items[i], c=charAt(i);
      if (hardBreak(c)) continue;
      appendGlyph(glyphs,g,c,pen,baseline);
      pen+=g.advance;
      if (at?.[j]) pen+=extra;
    }
    const lineWidth=width+lineIndent-left-right;
    lines.push({first,last:glyphs.length,start:source,end:Math.max(source,lastItem?.end ?? source),
      x:0,top:y,baseline,width:lineWidth,height,paragraphEnd,breakAfter,rtl});
    widest=Math.max(widest,lineWidth);
    paragraphStart=paragraphEnd;
    y+=height;
  }
  const trim=text.leadingTrim==="capHeight" && !text.path;
  const shift=trim && lines.length ? lines[0].baseline-firstCap : 0;
  if (shift) {
    for (const l of lines) { l.top-=shift; l.baseline-=shift; }
    for (const g of glyphs) g.y-=shift;
  }
  const bottom=(l:FlowLine)=>trim ? l.baseline : l.top+l.height;
  let height=Math.max(0,lines.length ? bottom(lines[lines.length-1]) : y);
  if (text.autoResize==="truncate" && box.height!==undefined && height>box.height+0.5) {
    const cut=lines.findIndex(l=>bottom(l)>box.height!+0.5);
    const keep=cut<0 ? lines.length : Math.max(1,cut);
    if (keep<lines.length) {
      lines.length=keep;
      glyphs.length=lines[keep-1].last;
      height=bottom(lines[keep-1]);
      truncated=true;
    }
  }
  if (truncated && lines.length) {
    const last=lines[lines.length-1];
    finishTruncatedLine(glyphs,last,ranges[lines.length],items,chars,wrap);
    widest=Math.max(widest,last.width);
  }
  const alignWidth=text.autoResize==="widthAndHeight" ? widest : boxWidth ?? widest;
  for (const line of lines) {
    line.x=text.alignH==="center" ? (alignWidth-line.width)/2 : text.alignH==="right" ? alignWidth-line.width : 0;
    if (line.x) for (let i=line.first;i<line.last;i++) glyphs[i].x+=line.x;
  }
  return {glyphs,lines,width:widest,height,truncated};
}
