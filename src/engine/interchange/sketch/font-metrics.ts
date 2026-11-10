import { multiply } from "../../affine";
import { isFrameLike, layerTransform, withLayerTransform, type Document, type DocumentNode } from "../../document";
import type { FontLibrary } from "../../font-library";
import { normaliseFontStyle } from "../../font-tables";
import { waitForFontReads } from "../../text-node-layout";
import { letterSpacingPx, type TextStyle } from "../../text-style";

const tallFamilies=new Set(["academy engraved let","courier","helvetica","hoefler text","palatino","sathu","silom","skia","times","webdings","zapf dingbats"]);
const compact=(s:string)=>s.replace(/\s/gu,"").toLowerCase();

export async function sketchFontMetrics(doc:Document,fonts:FontLibrary,checkCurrent:()=>void):Promise<Document> {
  const nodes=Object.values(doc.nodes).filter(n=>n.kind==="text");
  const shared=doc.styles?.filter(s=>s.type==="text") ?? [];
  if (!nodes.length && !shared.length) return doc;
  const families=fonts.families(), exact=new Set(families.map(f=>f.toLowerCase()));
  const lookup=new Map<string,string>();
  for (const f of families) if (!lookup.has(compact(f))) lookup.set(compact(f),f);
  const family=(style:TextStyle)=>exact.has(style.fontFamily.toLowerCase()) ? style.fontFamily : lookup.get(compact(style.fontFamily)) ?? style.fontFamily;
  const styles=new Set<TextStyle>(shared.map(s=>s.style));
  for (const n of nodes) {
    styles.add(n.text.style);
    for (const run of n.text.runs) styles.add(run.style);
  }
  const faces=new Map<string,Map<string,ReturnType<FontLibrary["find"]>>>();
  for (const style of styles) {
    const name=family(style);
    if (!fonts.hasFamily(name)) continue;
    let group=faces.get(name);
    if (!group) {group=new Map();faces.set(name,group);}
    if (!group.has(style.fontStyle)) group.set(style.fontStyle,fonts.find(name,style.fontStyle));
  }
  await waitForFontReads();
  checkCurrent();
  for (const [name,group] of faces) for (const key of group.keys()) group.set(key,fonts.find(name,key));

  function adjust(style:TextStyle) {
    const name=family(style), face=faces.get(name)?.get(style.fontStyle);
    let result=name===style.fontFamily ? style : {...style,fontFamily:name}, down=0;
    if (face) {
      const size=style.fontSize, track=face.tracking(size);
      if (track && Number.isFinite(track)) result={...result,letterSpacing:{unit:"pixels",value:letterSpacingPx(style)+track}};
      if (face.axes.opsz && style.variations.opsz===undefined && face.instances.some(i=>normaliseFontStyle(i.name)===normaliseFontStyle(style.fontStyle)))
        result={...result,variations:{...result.variations,opsz:size}};
      if (style.lineHeight.unit==="auto" && size>0) {
        const k=size/face.upem,a=face.ascent*k,d=face.descent*k,natural=Math.round(a)+Math.round(d);
        const line=tallFamilies.has(name.toLowerCase()) ? Math.round(natural*1.2) : natural;
        if (line>0 && Number.isFinite(line)) {
          result={...result,lineHeight:{unit:"percent",value:line/size*100}};
          down=line-Math.round(d)-((line-(a+d))/2+a);
        }
      }
    }
    return {style:result,down};
  }
  const changed:Record<string,DocumentNode>={};
  for (const n of nodes) {
    const {style,down}=adjust(n.text.style),parent=doc.nodes[n.parent];
    const runs=n.text.runs.map(r=>({...r,style:adjust(r.style).style}));
    const node={...n,text:{...n.text,style,runs}};
    changed[n.id]=down && !(isFrameLike(parent) && parent.layout && !n.childLayout?.absolute)
      ? withLayerTransform(node,multiply(layerTransform(n),[1,0,0,1,0,down])) : node;
  }
  return {...doc,nodes:{...doc.nodes,...changed},...(doc.styles && {styles:doc.styles.map(s=>s.type==="text" ? {...s,style:adjust(s.style).style} : s)})};
}
