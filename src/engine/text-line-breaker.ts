import type { TextData } from "./text-data";
import type { StyledGlyph } from "./styled-glyphs";
import type { TextGraphemes } from "./text-graphemes";
import { breakBetween, isWrapSpace, safeEmergencyBreak } from "./text-wrap-boundaries";
import { savedBreaksFor } from "./text-breaks";

export interface TextLineRange {start:number; end:number; paragraph:number; paragraphEnd:boolean}
export type TextIndent = (paragraph:number,first:boolean,source:number)=>number;
type LineWidth = (paragraph:number,line:number)=>number | undefined;
const open=new Set("\"'“‘„‚«‹([{¿¡");
const close=new Set(".,:;!?\"'”’»›)]}-–—…");
export const hardBreak=(c: string)=>c==="\n" || c==="\u2028";

export class TextLineBreaker {
  readonly #letters: string[];
  readonly #spaces: Uint8Array;
  readonly #opportunities: Uint8Array;
  readonly #hangStart:boolean;
  readonly #hangEnd:boolean;

  constructor(readonly text:TextData, readonly items:readonly StyledGlyph[], readonly chars:readonly string[],
    readonly boundaries:TextGraphemes, wordStarts:ArrayLike<number>, readonly rtlAt:(source:number)=>boolean,
    readonly indent:TextIndent) {
    this.#letters=items.map(it=>chars[it.start]);
    this.#spaces=Uint8Array.from(this.#letters,c=>Number(isWrapSpace(c)));
    this.#opportunities=Uint8Array.from(items,(it,i)=>{
      const next=items[i+1];
      return Number(!!next && (breakBetween(this.#letters[i],this.#letters[i+1]) || it.end<=next.start && !!wordStarts[next.start]));
    });
    this.#hangStart=text.hangingPunctuation && (text.alignH==="left" || text.alignH==="justified");
    this.#hangEnd=text.hangingPunctuation && (text.alignH==="right" || text.alignH==="justified");
  }

  hanging(start:number,end:number): [number,number] {
    const first=this.items[start];
    if (!first || this.rtlAt(first.start)) return [0,0];
    return [this.#hangStart && open.has(this.#letters[start]) ? first.advance : 0,
      end>start+1 && this.#hangEnd && close.has(this.#letters[end-1]) ? this.items[end-1].advance : 0];
  }

  #safeBoundary(k:number) {
    const a=this.items[k-1], b=this.items[k];
    if (!a || !b || !b.start) return true;
    return a.end<=b.start && this.boundaries.isBoundary(b.start) && safeEmergencyBreak(this.chars[b.start-1],this.chars[b.start]);
  }

  #emergencyBoundary(start:number,candidate:number) {
    if (this.#safeBoundary(candidate)) return candidate;
    for (let i=candidate-1;i>start;i--) if (this.#safeBoundary(i)) return i;
    const limit=Math.min(this.items.length,candidate+257);
    for (let i=candidate+1;i<limit && !hardBreak(this.#letters[i]);i++) if (this.#safeBoundary(i)) return i;
    return candidate;
  }

  #greedy(width:LineWidth,saved?:readonly number[]) {
    const lines:TextLineRange[]=[];
    let start=0, wordEnd=0, paragraph=0, line=0, x=0, nextSaved=0;
    const finish=(end:number,paragraphEnd:boolean)=>{
      lines.push({start,end,paragraph,paragraphEnd});
      start=wordEnd=end;
      x=0;
      line++;
      if (paragraphEnd) { paragraph++; line=0; }
    };
    for (let i=0;i<this.items.length;) {
      const it=this.items[i], c=this.#letters[i];
      if (hardBreak(c)) { finish(++i,c==="\n"); continue; }
      const w=width(paragraph,line);
      if (w!==undefined && i>start && !this.#spaces[i]) {
        const [left,right]=this.hanging(start,i+1);
        const room=w-this.indent(paragraph,line===0,it.start)+left+right;
        const measured=x+it.advance-it.spacing;
        if (saved) {
          while (nextSaved<saved.length && saved[nextSaved]<=this.items[start].start) nextSaved++;
          if (saved[nextSaved]<=it.start) { finish(i,false); continue; }
          if (measured>room*1.03+1) return undefined;
        } else if (measured>room+1e-6) {
          i=this.#emergencyBoundary(start,wordEnd>start ? wordEnd : i);
          finish(i,false);
          continue;
        }
      }
      x+=it.advance;
      if (this.#opportunities[i]) wordEnd=i+1;
      i++;
    }
    if (start<this.items.length || !lines.length || hardBreak(this.#letters[start-1])) finish(this.items.length,true);
    return lines;
  }

  lineWidth(start:number,end:number) {
    let width=0, x=0;
    for (let i=start;i<end && !hardBreak(this.#letters[i]);i++) {
      x+=this.items[i].advance;
      if (!this.#spaces[i]) width=x-this.items[i].spacing;
    }
    return width;
  }

  #emergencies(lines:readonly TextLineRange[]) {
    return lines.filter(l=>!l.paragraphEnd && l.end<this.items.length && l.end>0 &&
      !this.#spaces[l.end-1] && !hardBreak(this.#letters[l.end-1]) && !this.#opportunities[l.end-1]).length;
  }

  #singleWord({start,end}:TextLineRange) {
    while (end>start && (this.#spaces[end-1] || hardBreak(this.#letters[end-1]))) end--;
    return end>start && !this.#opportunities.subarray(start,end-1).includes(1);
  }

  wrap(width?:number):TextLineRange[] {
    const w=this.text.autoResize!=="widthAndHeight" && width!==undefined && Number.isFinite(width) && width>0 ? width : undefined;
    const saved=w===undefined ? undefined : savedBreaksFor(this.text,w);
    if (saved) {
      const pinned=this.#greedy(()=>w,saved);
      if (pinned) return pinned;
    }
    let lines=this.#greedy(()=>w)!;
    const paragraphs=lines[lines.length-1].paragraph+1;
    if (w===undefined || this.text.wrapStyle==="auto" || this.items.length*paragraphs>2_000_000) return lines;
    const plan=new Map<number,(li:number)=>number>();
    for (let p=0;p<paragraphs;p++) {
      const of=(all:readonly TextLineRange[])=>all.filter(l=>l.paragraph===p);
      const para=of(lines), n=para.length;
      if (n<2) continue;
      const base=this.#emergencies(para);
      const trial=(widthOf:(line:number)=>number)=>this.#greedy((q,li)=>q===p ? widthOf(li) : plan.get(q)?.(li) ?? w)!;
      if (this.text.wrapStyle==="balance") {
        let lo=0, hi=w;
        while (hi-lo>0.5) {
          const mid=lo+(hi-lo)/2;
          if (mid===lo || mid===hi) break;
          const narrow=of(trial(()=>mid));
          if (narrow.length===n && this.#emergencies(narrow)<=base) hi=mid;
          else lo=mid;
        }
        const chosen=()=>hi;
        lines=trial(chosen);
        plan.set(p,chosen);
      } else if (this.#singleWord(para[n-1])) {
        for (let j=n-2;j>=Math.max(0,n-4);j--) {
          const {start,end}=para[j], indent=this.indent(p,j===0,this.items[start]?.start ?? 0);
          const measure=(s:number,e:number)=>{
            const [left,right]=this.hanging(s,e);
            return this.lineWidth(s,e)-(left+right);
          };
          let narrow=measure(start,end);
          for (let attempt=0;attempt<3;attempt++) {
            narrow-=0.5;
            if (narrow<=0) break;
            const chosen=(li:number)=>li===j ? narrow+indent : w;
            const candidate=trial(chosen), after=of(candidate);
            if (after.length!==n || this.#emergencies(after)>base) break;
            if (!this.#singleWord(after[n-1])) {
              lines=candidate;
              plan.set(p,chosen);
              break;
            }
            narrow=measure(after[j].start,after[j].end);
          }
          if (plan.has(p)) break;
        }
      }
    }
    return lines;
  }
}
