// SVGs are parsed in a detached XML document. Only the importer reads its elements.
export const svgNamespace="http://www.w3.org/2000/svg";
export const maxSvgBytes=64<<20;
export const maxSvgNesting=512;

function declarationEnd(s:string,start:number,rejectExternal=false) {
  let quote="", brackets=0;
  for (let i=start+2;i<s.length;i++) {
    const c=s[i];
    if (quote) { if (c===quote) quote=""; continue; }
    if (c==='"' || c==="'") { quote=c; continue; }
    if (brackets && (s.startsWith("<!--",i) || s.startsWith("<?",i))) {
      const end=s.startsWith("<!--",i) ? "-->" : "?>";
      const j=s.indexOf(end,i+2);
      if (j<0) return -1;
      i=j+end.length-1; continue;
    }
    if (rejectExternal && brackets && s.startsWith("<!ENTITY",i) &&
        /^<!ENTITY\s+(?:%\s+)?[^\s>]+\s+(?:SYSTEM|PUBLIC)\s/i.test(s.slice(i))) {
      throw new Error("SVG import failed: external entities are unavailable");
    }
    if (c==="[") brackets++;
    if (c==="]") brackets=Math.max(0,brackets-1);
    if (c===">" && !brackets) return i+1;
  }
  return -1;
}

export function looksLikeSvg(text:string) {
  let at=0;
  for (let count=0;count<64;count++) {
    while (at<text.length && /\s/u.test(text[at])) at++;
    if (text.startsWith("<svg",at)) return true;
    const close=text.startsWith("<?",at) ? "?>" : text.startsWith("<!--",at) ? "-->" : "";
    if (close) {
      const end=text.indexOf(close,at+2);
      if (end<0) return false;
      at=end+close.length;
    } else if (text.startsWith("<!",at)) {
      at=declarationEnd(text,at);
      if (at<0) return false;
    } else return false;
  }
  return false;
}

export function checkSvgNesting(text:string) {
  let at=0, depth=0;
  const fail=()=>{throw new Error("SVG import failed: elements nested more than 512 deep");};
  while ((at=text.indexOf("<",at))>=0) {
    const close=text.startsWith("<!--",at) ? "-->" : text.startsWith("<![CDATA[",at) ? "]]>" : text.startsWith("<?",at) ? "?>" : "";
    if (close) {
      const end=text.indexOf(close,at+2);
      if (end<0) break;
      at=end+close.length; continue;
    }
    if (text.startsWith("<!",at)) {
      at=declarationEnd(text,at,true);
      if (at<0) break;
      continue;
    }
    let end=at+1, quote="";
    for (;end<text.length;end++) {
      const c=text[end];
      if (quote) { if (c===quote) quote=""; }
      else if (c==="'" || c==='"') quote=c;
      else if (c===">") break;
    }
    if (text[at+1]==="/") depth=Math.max(0,depth-1);
    else if (text[end-1]!=="/" && ++depth>maxSvgNesting) fail();
    at=end+1;
  }
}

const gzip=(data:Uint8Array)=>data[0]===31 && data[1]===139;
export async function svgBytes(data:Uint8Array,limit?:number) {
  if (!gzip(data)) {
    if (limit!==undefined && data.length>limit) throw new Error("SVG import failed: SVG larger than "+(limit>>>20)+" MiB");
    return data;
  }
  limit ??= maxSvgBytes;
  const reader=new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    while (true) {
      const next=await reader.read();
      if (next.done) break;
      size+=next.value.byteLength;
      if (size>limit) throw new Error("SVG import failed: compressed SVG expands past "+(limit>>>20)+" MiB");
      chunks.push(next.value);
    }
  } catch (e) {
    await reader.cancel().catch(()=>{});
    if (e instanceof Error && e.message.startsWith("SVG import failed:")) throw e;
    throw new Error("SVG import failed: malformed compressed SVG");
  } finally { reader.releaseLock(); }
  const out=new Uint8Array(size);
  let at=0;
  for (const chunk of chunks) {out.set(chunk,at); at+=chunk.length;}
  if (gzip(out)) throw new Error("SVG import failed: compressed SVG holds another compressed file, not a document");
  return out;
}

export function svgXml(bytes:Uint8Array) {
  let text:string;
  try {text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch {throw new Error("SVG import failed: invalid UTF-8");}
  checkSvgNesting(text);
  const doc=new DOMParser().parseFromString(text,"image/svg+xml");
  const root=doc.documentElement;
  if (root.namespaceURI!==svgNamespace || root.localName!=="svg" || doc.getElementsByTagNameNS("http://www.mozilla.org/newlayout/xml/parsererror.xml","parsererror").length)
    throw new Error("SVG import failed: invalid SVG document");
  const walker=doc.createTreeWalker(doc,NodeFilter.SHOW_ELEMENT);
  let depth=0;
  do {
    if (walker.firstChild()) {
      if (++depth>maxSvgNesting) throw new Error("SVG import failed: elements nested more than 512 deep");
      continue;
    }
    while (!walker.nextSibling()) {
      if (!walker.parentNode()) return root;
      depth--;
    }
  } while (depth>0);
  return root;
}
