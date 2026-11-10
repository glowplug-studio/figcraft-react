import type { Document } from "../document";
import { setDocumentProfile } from "../document-profile";
import { documentTextReady, prepareDocumentText } from "../text-node-layout";
import { nums, PdfObjects, pdfString, ref } from "./objects";
import { pdfPages } from "./pages";
import { PdfScene } from "./scene";
import { PdfImages } from "./images";
import { PdfFonts } from "./fonts";

export async function renderPdf(doc:Document,selection:readonly string[],params:Record<string,unknown>,frames=false,assertAccess?:()=>void) {
  doc=setDocumentProfile(doc,"srgb",true);
  if (!documentTextReady(doc)) await prepareDocumentText(doc);
  const {pages,print}=pdfPages(doc,selection,params,frames);
  async function write(embedded:boolean):Promise<{format:"pdf";blob:Blob;pages:number}> {
    const file=new PdfObjects(), tree=file.reserve(), refs:number[]=[],fonts=embedded ? new PdfFonts(file) : undefined;
    const images=new PdfImages(file);
    let visited=0,lastYield=performance.now();
    async function checkpoint() {
      if (++visited%128 || performance.now()-lastYield<12) return;
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      assertAccess?.();
      lastYield=performance.now();
    }
    for (const page of pages) {
      assertAccess?.();
      const scene=new PdfScene(doc,page,file,print.cmyk,fonts,images,checkpoint);
      const surface=await scene.draw(), content=surface.stream(file);
      const links=scene.links.map(({box:b,url})=>file.add("<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect ["+
        nums([b.x,b.y,b.x+b.width,b.y+b.height])+"] /A << /S /URI /URI "+pdfString(url)+" >> >>"));
      refs.push(file.add("<< /Type /Page /Parent "+ref(tree)+" "+page.sheet.boxes+" /Resources "+surface.resources()+
        " /Contents "+ref(content)+(links.length ? " /Annots ["+links.map(ref).join(" ")+"]" : "")+" >>"));
    }
    if (fonts) {
      try {await fonts.finish();} catch {return write(false);}
    }
    file.set(tree,"<< /Type /Pages /Count "+refs.length+" /Kids ["+refs.map(ref).join(" ")+"] >>");
    const root=file.add("<< /Type /Catalog /Pages "+ref(tree)+" >>");
    const info=file.add("<< /Creator (FigCraft) /Producer (FigCraft)"+(doc.name.trim() ? " /Title "+pdfString(doc.name) : "")+" >>");
    return {format:"pdf" as const,blob:file.finish(root,info),pages:refs.length};
  }
  return write(true);
}
