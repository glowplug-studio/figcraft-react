import type { FontLibrary, LocalFontName } from "./font-library";
import { maxFontBytes, readFontFaces } from "./font-source";
import { fontsChanged } from "./font-generation";

interface BrowserFace {
  readonly family:string;
  readonly style:string;
  readonly postscriptName:string;
  blob():Promise<Blob>;
}
type FontWindow=Window & {queryLocalFonts?:()=>Promise<BrowserFace[]>};
const maxFonts=20_000;

/** One permission request per page. Names are listed first and only requested faces are read. */
export class LocalFontAccess {
  #asked=false;
  #faces=new Map<number,BrowserFace>();
  canAsk() {
    return !this.#asked && typeof window!=="undefined" && typeof (window as FontWindow).queryLocalFonts==="function";
  }

  async ask(library:FontLibrary) {
    if (!this.canAsk()) return;
    this.#asked=true;
    const browser=window as FontWindow;
    try {
      const faces=await browser.queryLocalFonts!();
      const names:LocalFontName[]=[];
      for (let id=0;id<Math.min(faces.length,maxFonts);id++) {
        const face=faces[id];
        if (typeof face?.family!=="string" || !face.family.trim()) continue;
        this.#faces.set(id,face);
        names.push({id,family:face.family.trim(),style:face.style ?? "",postscript:face.postscriptName ?? ""});
      }
      library.offerLocal(names);
    } finally { fontsChanged(); }
  }

  async load(library:FontLibrary,font:LocalFontName) {
    const source=this.#faces.get(font.id);
    if (!source) return;
    this.#faces.delete(font.id);
    let face;
    try {
      const file=await source.blob();
      if (file.size<=maxFontBytes) [face]=await readFontFaces(new Uint8Array(await file.arrayBuffer()),font);
    } catch { /* An unreadable local face falls back and disappears from the catalogue. */ }
    library.finishLocal(font.id,face);
    fontsChanged(!!face);
  }
}
