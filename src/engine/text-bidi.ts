import { BidiClass as C } from "./bidi-data";
import { bidiClass, resolveParagraph } from "./bidi-resolve";
import type { ParaList } from "./text-data";

const rtlCandidate=/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}\u200f\u202b\u202e\u2067]/u;
export const hasRtlText=(text:string)=>rtlCandidate.test(text);
export interface TextBidi {levels:Uint8Array; paragraphRtl:Uint8Array}

/** Scalar-indexed paragraph directions include one entry for the caret after the final character. */
export function textBidi(text: string, paragraphs: readonly Pick<ParaList,"direction">[]=[]): TextBidi | undefined {
  if (!hasRtlText(text)) {
    const first=paragraphs.findIndex(p=>p.direction!=="auto");
    if (first<0) return undefined;
    let pos=-1;
    for (let n=0;n<first;n++) {
      pos=text.indexOf("\n",pos+1);
      if (pos<0) return undefined;
    }
  }
  const chars=Array.from(text,c=>c.codePointAt(0)!);
  const levels=new Uint8Array(chars.length), paragraphRtl=new Uint8Array(chars.length+1);
  let start=0, para=0;
  const classes:C[]=[];
  for (let i=0;i<chars.length;i++) {
    const c=bidiClass(chars[i]);
    classes.push(c);
    if (c!==C.B && i+1!==chars.length) continue;
    const dir=paragraphs[para]?.direction;
    const result=resolveParagraph(chars.slice(start,i+1),classes,dir==="rtl" ? true : dir==="ltr" ? false : undefined);
    levels.set(result.levels,start);
    paragraphRtl.fill(result.base,start,i+1);
    classes.length=0;
    start=i+1;
    if (chars[i]===10) para++;
  }
  paragraphRtl[chars.length]=!chars.length || chars.at(-1)===10 ? Number(paragraphs[para]?.direction==="rtl") : paragraphRtl[chars.length-1];
  return {levels,paragraphRtl};
}

export function visualOrder(levels: ArrayLike<number>) {
  const order=new Uint32Array(levels.length);
  let lowestOdd=Infinity, highest=0;
  for (let i=0;i<levels.length;i++) {
    const l=levels[i];
    if (l%2) lowestOdd=Math.min(lowestOdd,l);
    highest=Math.max(highest,l);
    order[i]=i;
  }
  for (let l=highest;l>=lowestOdd;l--) {
    for (let i=0;i<order.length;) {
      if (levels[order[i]]<l) { i++; continue; }
      const start=i++;
      while (i<order.length && levels[order[i]]>=l) i++;
      order.subarray(start,i).reverse();
    }
  }
  return order;
}

export function visualGaps(levels:ArrayLike<number>, after:readonly boolean[], trailing:number) {
  const both=new Uint8Array(Math.max(0,2*after.length-1));
  for (let i=0;i<after.length;i++) {
    both[i*2]=levels[i] ?? 0;
    if (i) both[i*2-1]=Math.min(both[i*2-2],both[i*2]);
  }
  const order=visualOrder(both);
  return after.map((_,i)=>{
    const item=order[2*i]>>>1, gap=order[2*i+1];
    return item>=trailing ? after[item] : (gap&1)===1 && (gap>>>1)<trailing && after[gap>>>1];
  });
}
