import type { ParaList, StyleRun, TextData } from "./text-data";
import { textString, wireTextStyle, type TextStyle } from "./text-style";

export function scalarCount(value: string) {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

export function scalarToUtf16(value: string, index: number) {
  let offset = 0, i = 0;
  for (const c of value) {
    if (i++ >= index) break;
    offset += c.length;
  }
  return offset;
}
export function utf16ToScalar(value: string, offset: number) {
  let count = 0, units = 0;
  for (const c of value) {
    units += c.length;
    if (units > offset) break;
    count++;
  }
  return count;
}

const signatures = new WeakMap<TextStyle,string>();
function signature(style: TextStyle) {
  let value = signatures.get(style);
  if (value === undefined) {
    value = JSON.stringify(wireTextStyle(style));
    signatures.set(style,value);
  }
  return value;
}
const equal = (a: TextStyle,b: TextStyle) => a === b || signature(a) === signature(b);
const run = (start: number,end: number,style: TextStyle) => Object.freeze({start,end,style});

export function normaliseRuns(runs: readonly StyleRun[], base: TextStyle, length: number): readonly StyleRun[] {
  const ordered = runs.filter(r=>r.start < r.end && r.start < length && !equal(r.style,base)).sort((a,b)=>a.start-b.start);
  const result: StyleRun[] = [];
  for (const r of ordered) {
    const previous = result.at(-1), start = Math.max(r.start,previous?.end ?? 0), end = Math.min(r.end,length);
    if (start >= end) continue;
    if (previous?.end === start && equal(r.style,previous.style)) result[result.length-1] = run(previous.start,end,previous.style);
    else result.push(run(start,end,r.style));
  }
  return Object.freeze(result);
}

/** Native style_at uses stored order, including on old files with overlapping runs. */
export function textStyleAt(t: TextData, index: number) {
  return t.runs.find(r => r.start <= index && index < r.end)?.style ?? t.style;
}

export function textSpans(t: TextData): readonly StyleRun[] {
  const n = scalarCount(t.characters);
  const ordered = t.runs.filter(r=>r.start < r.end && r.start < n).sort((a,b)=>a.start-b.start);
  const result: StyleRun[] = [];
  let pos = 0;
  for (const r of ordered) {
    const start = Math.max(pos,r.start), end = Math.min(n,r.end);
    if (start >= end) continue;
    if (start > pos) result.push(run(pos,start,t.style));
    result.push(run(start,end,r.style)); pos=end;
  }
  if (pos < n || !result.length) result.push(run(pos,n,t.style));
  return Object.freeze(result);
}

export function restyleRange(t: TextData, a: number, b: number, edit: (s:TextStyle)=>TextStyle): TextData {
  const n = scalarCount(t.characters), start = Math.max(0, Math.min(n,a)), end = Math.max(0, Math.min(n,b));
  if (!n || (start===0 && end===n)) {
    const style = edit(t.style), runs = t.runs.map(r=>run(r.start,r.end,edit(r.style)));
    return Object.freeze({...t,style,runs:normaliseRuns(runs,style,n)});
  }
  if (start>=end) return t;
  // On canonical files visit each span once. Only malformed, overlapping input
  // requires the native first-match lookup at the original run boundaries.
  let last = 0;
  const ordered = t.runs.every(r=>{ const ok=r.start>=last && r.end>=r.start; last=r.end; return ok; });
  const spans: readonly StyleRun[] = ordered ? textSpans(t) : (() => {
    const cuts = [...new Set([0,n,...t.runs.flatMap(r=>[Math.min(n,r.start),Math.min(n,r.end)])])].sort((x,y)=>x-y);
    return cuts.slice(1).map((v,i)=>run(cuts[i],v,textStyleAt(t,cuts[i])));
  })();
  const runs: StyleRun[] = [];
  for (const r of spans) {
    const lo = Math.max(start,r.start), hi = Math.min(end,r.end);
    if (lo>=hi) {runs.push(r); continue;}
    if (r.start < lo) runs.push(run(r.start,lo,r.style));
    runs.push(run(lo,hi,edit(r.style)));
    if (hi < r.end) runs.push(run(hi,r.end,r.style));
  }
  return Object.freeze({...t,runs:normaliseRuns(runs,t.style,n)});
}

const newlines = (value: string) => { let count=0; for (let i=value.indexOf("\n"); i!==-1; i=value.indexOf("\n",i+1)) count++; return count; };

export function replaceTextRange(t: TextData, a: number, b: number, insertion: string): TextData {
  textString(insertion,"replacement");
  const n = scalarCount(t.characters), start = Math.max(0,Math.min(a,n)), end = Math.max(start, Math.min(b,n));
  const from = scalarToUtf16(t.characters,start), to = scalarToUtf16(t.characters,end);
  const prefix = t.characters.slice(0,from);
  const characters = prefix + insertion + t.characters.slice(to);
  const added = scalarCount(insertion);
  const shift = (p: number) => p<=start ? p : p>=end ? p-(end-start)+added : start+added;
  const runs = t.runs.map(r=>run(shift(r.start),r.end === start && r.start<start ? start+added : shift(r.end),r.style));
  let paragraphs = t.paragraphs;
  if (paragraphs.length) {
    const index = newlines(prefix), removed = newlines(t.characters.slice(from,to)), inserted = newlines(insertion);
    const fallback: ParaList = Object.freeze({list:t.list,indent:0,startOffset:0,direction:"auto"});
    const old = Array.from({length:newlines(t.characters)+1},(_,i)=>paragraphs[i] ?? fallback);
    paragraphs = Object.freeze(old.slice(0,index+1).concat(Array<ParaList>(inserted).fill(old[index]),old.slice(index+1+removed)));
  }
  return Object.freeze({...t,characters,runs:normaliseRuns(runs,t.style,n-(end-start)+added),paragraphs});
}

export function paragraphSpan(t: TextData, start: number, end: number): readonly [number,number] {
  const lo = Math.min(start,end), hi = Math.max(start,end);
  let a = 0, b = 0, i = 0, endAtBreak = false;
  for (const c of t.characters) {
    if (i >= hi) break;
    if (c === "\n") {
      if (i < lo) a++;
      b++;
      endAtBreak = i === hi-1;
    }
    i++;
  }
  return [a,lo !== hi && b > a && endAtBreak ? b - 1 : b];
}
export function paragraphList(t: TextData, i: number): ParaList {
  return t.paragraphs[i] ?? Object.freeze({list:t.list,indent:0,startOffset:0,direction:"auto"});
}
export function editParagraphLists(t: TextData, span: readonly [number,number], edit: (p:ParaList)=>ParaList,
  keepLevels = false): TextData {
  const [first,last] = span, count = newlines(t.characters)+1;
  const paragraphs = Array.from({length:count},(_,i)=>{
    const old = paragraphList(t,i);
    if (i<first || i>last) return old;
    const p = edit(old);
    return Object.freeze({...p,indent:p.list==="none" && !keepLevels ? 0 : Math.min(8,p.indent),
      startOffset:p.list==="numbered" ? p.startOffset : 0});
  });
  const list = paragraphs[0].list;
  if (paragraphs.every(p=>p.list===list && p.indent===0 && p.startOffset===0 && p.direction==="auto")) {
    return Object.freeze({...t,list,paragraphs:Object.freeze([])});
  }
  return Object.freeze({...t,paragraphs:Object.freeze(paragraphs)});
}
export function commonParagraphList(t: TextData, start: number, end: number) {
  const [a,b] = paragraphSpan(t,start,end), first = paragraphList(t,a);
  for (let i=a+1;i<=b;i++) {
    const p = paragraphList(t,i);
    if (first.list !== p.list || first.indent !== p.indent) return;
  }
  return first;
}
