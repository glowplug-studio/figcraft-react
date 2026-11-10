import { isFrameLike, pageOf, type Document } from "../document";
import { exportRegion } from "../export-area";
import { fileExportSetting, type PrintSettings } from "../export-settings";
import { checkVectorDepth } from "../export-svg";
import type { Rectangle } from "../geometry";
import { parseNodeId } from "../parameters";
import { union, worldRenderBounds } from "../render-bounds";
import { boundsOf } from "../viewport";
import { printSheet } from "./sheet";

export interface PdfPage {
  ids:readonly string[]; area:Rectangle; sheet:ReturnType<typeof printSheet>;
}
export function pdfPages(doc:Document,selection:readonly string[],params:Record<string,unknown>,frames=false) {
  const setting=fileExportSetting({...params,format:"pdf"});
  const print:PrintSettings=setting.print ??
    {bleed:0,cropMarks:false,bleedMarks:false,cmyk:false};
  const extended=print.bleed>0 || print.cropMarks || print.bleedMarks && print.bleed>0;
  let groups:readonly (readonly string[])[], explicit:Rectangle | undefined;
  if (frames) {
    const id=parseNodeId(params.page);
    const page=id ? doc.nodes[id] : pageOf(doc);
    if (page?.kind!=="page") throw new Error("`page` is not a page");
    const ordered=page.children.flatMap(id=>{
      const n=doc.nodes[id];
      const bounds=n && isFrameLike(n) && n.visible!==false ? boundsOf(doc,[id]) : undefined;
      return bounds ? [{id,bounds}] : [];
    }).sort((a,b)=>a.bounds.y-b.bounds.y || a.bounds.x-b.bounds.x);
    if (!ordered.length) throw new Error("the page has no visible frames");
    groups=ordered.map(({id})=>[id]);
  } else {
    const {area,drawn}=exportRegion(doc,selection,params,roots=>checkVectorDepth(doc,roots));
    const id=parseNodeId(params.id);
    const targets=Array.isArray(params.ids) ? params.ids.map(parseNodeId).filter((id):id is string=>!!id) : id ? [id] : selection;
    const ids=targets.length ? targets : pageOf(doc).children;
    const own=setting.contentsOnly!==false && !setting.includeBoundingBox && !ids.some(id=>doc.nodes[id]?.kind==="slice");
    groups=own && ids.length && ids.every(id=>doc.nodes[id] && isFrameLike(doc.nodes[id])) ? ids.map(id=>[id]) : [drawn];
    if (!own && area.width>0 && area.height>0) explicit=area;
  }
  for (const ids of groups) checkVectorDepth(doc,ids);
  const pages:PdfPage[]=groups.filter(ids=>ids.length).map(ids=>{
    let area=explicit;
    const single=ids.length===1 && doc.nodes[ids[0]];
    if (!area && extended && single && isFrameLike(single)) {
      const b=boundsOf(doc,ids); if (b && b.width>0 && b.height>0) area=b;
    }
    if (!area) for (const id of ids) {
      const b=worldRenderBounds(doc,id);
      if (b && Object.values(b).every(Number.isFinite)) area=union(area,b);
    }
    if (!area) throw new Error("node "+ids[0]+" has no exportable area");
    return {ids,area,sheet:printSheet(area.width,area.height,print)};
  });
  if (!pages.length) throw new Error("nothing to export");
  return {pages,print};
}
