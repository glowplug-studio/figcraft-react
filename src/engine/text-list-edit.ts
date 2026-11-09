import type { TextData } from "./text-data";
import { editParagraphLists, paragraphList, paragraphSpan, scalarToUtf16 } from "./text-ranges";

/** Native list_key consumes Tab on any selected item, and delete/empty Enter at an item's start. */
export function listKey(text:TextData, start:number, end:number, key:string, shift:boolean): TextData | undefined {
  const span = paragraphSpan(text,start,end);
  let any = false;
  for (let i=span[0]; i<=span[1]; i++) if (paragraphList(text,i).list !== "none") { any = true; break; }
  if (!any) return;
  if (key !== "Tab") {
    const offset = scalarToUtf16(text.characters,start);
    const atStart = start === end && (offset === 0 || text.characters[offset-1] === "\n");
    if (!atStart || paragraphList(text,span[0]).list === "none") return;
    if (key === "Backspace" || key === "Delete") return editParagraphLists(text,span,p=>({...p,list:"none"}),true);
    if (key !== "Enter" || offset !== text.characters.length && text.characters[offset] !== "\n") return;
  }
  return editParagraphLists(text,span,p=>{
    if (p.list === "none") return p;
    if (key === "Tab" && !shift) return {...p,indent:p.indent+1};
    return p.indent ? {...p,indent:p.indent-1} : {...p,list:"none"};
  });
}
