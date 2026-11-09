import type { TextData } from "./text-data";
import { scalarCount, textStyleAt } from "./text-ranges";

/** Upstream doc_urls::openable checks document-authored links before asking the host to open them. */
export function openableDocumentUrl(raw:string) {
  const url=raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,"");
  if (/[\p{Cc}\p{White_Space}|<>"`\\^]/u.test(url)) return false;
  const match=/^(https?|mailto):(.*)$/i.exec(url);
  if (!match || !match[2]) return false;
  if (match[1].toLowerCase()==="mailto") return true;
  if (!match[2].startsWith("//")) return false;
  const after=match[2].slice(2);
  if (!after || after.startsWith("/")) return false;
  return /^[a-zA-Z0-9\-._~:@\[\]%!$&'()*+,;=\u0080-\u{10ffff}]*$/u.test(after.split(/[/#?]/,1)[0]);
}

export function textLinkAt(text:TextData,start:number) {
  const length=scalarCount(text.characters);
  const link=(start<length ? textStyleAt(text,start).link : undefined) ??
    (start>0 && start<=length ? textStyleAt(text,start-1).link : undefined);
  if (link!==undefined && !openableDocumentUrl(link)) throw new Error("Only web and mail links can be opened");
  return link ?? null;
}
