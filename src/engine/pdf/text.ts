import { multiply, transformBounds, type Affine } from "../affine";
import { rectanglePaints, type TextNode } from "../document";
import type { Rectangle } from "../geometry";
import { decorationPath } from "../text-decorations";
import { glyphPath } from "../text-glyph-path";
import { textNodeLayout } from "../text-node-layout";
import { textSpans, textStyleKey } from "../text-ranges";
import type { FlowGlyph } from "../text-flow";
import type { TextStyle } from "../text-style";
import type { PdfFonts } from "./fonts";
import type { PdfScene } from "./scene";
import { number, nums, PdfSurface, unicodeHex } from "./objects";
import { ink } from "./sheet";

export interface PdfLink {box:Rectangle;url:string}
function addLinks(scene:PdfScene,layout:ReturnType<typeof textNodeLayout>["layout"],world:Affine) {
  for (const line of layout.lines) {
    let run:{url:string;left:number;right:number} | undefined;
    const flush=()=>{
      if (!run || scene.links.length>=10000) return;
      const bounds=transformBounds(multiply(world,[1,0,0,1,run.left,line.top]),run.right-run.left,line.height);
      const {width,height}=scene.page.sheet;
      const x=Math.max(0,bounds.x), y=Math.max(0,bounds.y), right=Math.min(width,bounds.x+bounds.width), bottom=Math.min(height,bounds.y+bounds.height);
      if (right>x && bottom>y) scene.links.push({url:run.url,box:{x,y:height-bottom,width:right-x,height:bottom-y}});
    };
    for (let i=line.first;i<line.last;i++) {
      const g=layout.glyphs[i], url=g.style.link?.trim();
      const a=Math.min(g.x,g.x+g.advance), b=Math.max(g.x,g.x+g.advance);
      if (url && run?.url===url) {run.left=Math.min(run.left,a);run.right=Math.max(run.right,b);continue;}
      flush();
      run=url && url.length<=8192 && new TextEncoder().encode(url).length<=8192 ? {url,left:a,right:b} : undefined;
    }
    flush();
  }
}
export async function drawPdfText(scene:PdfScene,s:PdfSurface,n:TextNode,world:Affine,mask:boolean,fonts:PdfFonts | undefined) {
  const {layout,dy}=textNodeLayout(n), xf=multiply(world,[1,0,0,1,0,dy]);
  if (!mask && !scene.tiling) addLinks(scene,layout,xf);
  const chars=Array.from(n.text.characters);
  const byStyle=new Map<string,{style:TextStyle;glyphs:FlowGlyph[];decorations:typeof layout.decorations[number][]}>();
  function group(style:TextStyle) {
    const key=textStyleKey(style);
    let part=byStyle.get(key);
    if (!part) {part={style,glyphs:[],decorations:[]};byStyle.set(key,part);}
    return part;
  }
  for (const span of textSpans(n.text)) group(span.style);
  for (const g of layout.glyphs) group(g.style).glyphs.push(g);
  for (const d of layout.decorations) group(d.style).decorations.push(d);
  for (const {style,glyphs,decorations} of byStyle.values()) {
    let written=false;
    for (const paint of style.fills ?? rectanglePaints(n)) {
      if (!paint.visible || paint.opacity<=0) continue;
      const embeddable=fonts && !n.text.path && !written && (paint.type==="solid" || paint.type==="gradient" && (paint.kind==="linear" || paint.kind==="radial"));
      const outlined:FlowGlyph[]=[];
      if (embeddable) {
        const gradient=paint.type==="gradient";
        const commands:string[]=["BT"];
        let lastFont="", from=-1,to=-1,first=true,marked=false;
        for (const [i,g] of glyphs.entries()) {
          const same=g.start===from && g.end===to;
          if (!same && marked) {commands.push("EMC");marked=false;}
          const valid=g.end>g.start && g.end<=chars.length && !g.warp;
          const source=valid && !same ? chars.slice(g.start,g.end).join("") : "";
          const cid=valid ? fonts.use(g,source) : undefined;
          if (!cid) {outlined.push(g); continue;}
          from=g.start;to=g.end;
          if (!same && (g.id===0 || glyphs[i+1]?.start===g.start && glyphs[i+1]?.end===g.end)) {
            commands.push("/Span << /ActualText <FEFF"+unicodeHex(source)+"> >> BDC");
            marked=true;
          }
          const selected=s.use("Font",cid.id)+" "+number(g.size)+" Tf";
          if (selected!==lastFont) {commands.push(selected);lastFont=selected;}
          if (first && gradient) commands.push("7 Tr");
          first=false;
          const textMatrix=multiply(xf,[1,0,0,-1,g.x,g.y]);
          commands.push(nums(textMatrix)+" Tm <"+cid.code+"> Tj");
        }
        if (marked) commands.push("EMC");
        if (!first) {
          s.ops.push("q");
          if (paint.type==="solid") {
            scene.graphics.state(s,paint.opacity*paint.color.a,paint.blend);
            const cmyk=scene.cmyk && !mask;
            s.ops.push(nums(ink(paint.color,cmyk))+(cmyk ? " k" : " rg"));
          }
          for (const command of commands) s.ops.push(command);
          s.ops.push("ET");
          if (gradient) {
            // The text rendering mode clips the next paint to the actual embedded glyphs.
            const {width:w,height:h}=scene.page.sheet;
            const box=[["M",0,0],["L",w,0],["L",w,h],["L",0,h],["Z"]] as const;
            await scene.shade(s,paint,box,"nonzero",xf,n.width,n.height,mask,true);
          }
          s.ops.push("Q");written=true;
        }
      } else for (const g of glyphs) outlined.push(g);
      for (const g of outlined) await scene.paint(s,paint,glyphPath(g),"nonzero",xf,n.width,n.height,mask);
      for (const d of decorations) await scene.paint(s,paint,decorationPath(d),"nonzero",xf,n.width,n.height,mask);
    }
  }
}
