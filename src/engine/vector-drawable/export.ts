import { identity, multiply, type Affine } from "../affine";
import type { Document } from "../document";
import { setDocumentProfile } from "../document-profile";
import { exportRegion } from "../export-area";
import { fileExportSetting } from "../export-settings";
import { checkVectorDepth } from "../export-svg";
import { worldTransform } from "../hierarchy";
import { documentTextReady, prepareDocumentText } from "../text-node-layout";
import { DrawableWalker } from "./walk";
import { drawableXml, type DrawableItem } from "./xml";

export async function renderDrawable(doc:Document,selection:readonly string[],params:Record<string,unknown>) {
  const setting=fileExportSetting({...params,format:"xml"});
  doc=setDocumentProfile(doc,"srgb",true);
  if (!documentTextReady(doc)) await prepareDocumentText(doc);
  const {area,drawn}=exportRegion(doc,selection,params,roots=>checkVectorDepth(doc,roots));
  if (!(area.width>0 && area.height>0 && Object.values(area).every(Number.isFinite))) throw new Error("nothing to export");
  const origin:Affine=[1,0,0,1,-area.x,-area.y], walker=new DrawableWalker(doc,setting);
  const items:DrawableItem[]=[];
  for (const id of drawn) {
    const parent=doc.nodes[id]?.parent;
    for (const item of walker.node(id,multiply(origin,parent ? worldTransform(doc,parent) : identity),0)) items.push(item);
  }
  if (!items.length) walker.warnings.add("nothingDrawn",doc.nodes[drawn[0]]?.name ?? "");
  const blob=new Blob([drawableXml(area.width,area.height,items)],{type:"application/xml"});
  return {format:"xml" as const,blob,warnings:walker.warnings.finish()};
}
