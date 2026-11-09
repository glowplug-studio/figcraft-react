import { BidiClass as C, bidiStarts, bracketPairs } from "./bidi-data";

export function bidiClass(cp: number): C {
  let lo=0, hi=bidiStarts.length;
  while (lo+1<hi) {
    const mid=(lo+hi)>>>1;
    if ((bidiStarts[mid]>>>5)<=cp) lo=mid;
    else hi=mid;
  }
  return bidiStarts[lo]&31;
}

const isolate = (c: C) => c===C.LRI || c===C.RLI || c===C.FSI;
const embedding = (c: C) => c===C.LRE || c===C.RLE || c===C.LRO || c===C.RLO;
const removed = (c: C) => c===C.BN || c===C.PDF || embedding(c);
const direction = (level: number) => level%2 ? C.R : C.L;
const strong = (c: C) => c===C.L ? C.L : c===C.R || c===C.AN || c===C.EN ? C.R : undefined;
const paired = new Map<number,number>();
for (let i=0; i<bracketPairs.length; i+=2) {
  const open=bracketPairs[i], close=bracketPairs[i+1];
  // U+2329 has the canonical decomposition U+3008 (and likewise for the closing bracket).
  const canonical=open===0x2329 ? 0x3008 : open;
  paired.set(open,canonical);
  paired.set(close,-canonical);
}

// P2/P3 and X5c share the first strong character outside nested isolates.
function baseLevel(classes: C[], force: boolean | undefined) {
  const active: number[]=[];
  let base=force===undefined ? undefined : Number(force);
  for (let i=0;i<classes.length;i++) {
    const c=classes[i];
    if (isolate(c)) active.push(i);
    else if (c===C.PDI) active.pop();
    else if (c===C.L || c===C.R || c===C.AL) {
      const rtl=c!==C.L, opener=active.at(-1);
      if (opener===undefined) base ??= Number(rtl);
      else if (classes[opener]===C.FSI) classes[opener]=rtl ? C.RLI : C.LRI;
    }
  }
  return base ?? 0;
}

interface Status {level:number; override?:C; isolated:boolean}

function explicitLevels(original: readonly C[], types: C[], base: number) {
  const stack: Status[]=[{level:base,isolated:false}];
  let overIsolates=0, overEmbeddings=0, isolates=0;
  const levels=new Uint8Array(types.length);
  for (let i=0;i<types.length;i++) {
    const c=original[i];
    let top=stack[stack.length-1];
    levels[i]=top.level;
    if (isolate(c) || embedding(c)) {
      const isolated=isolate(c), rtl=c===C.RLI || c===C.RLE || c===C.RLO;
      const next=rtl ? (top.level+1)|1 : (top.level+2)&~1;
      if (isolated) types[i]=top.override ?? c;
      if (next<=125 && !overIsolates && !overEmbeddings) {
        stack.push({level:next,isolated,override:c===C.LRO ? C.L : c===C.RLO ? C.R : undefined});
        if (isolated) isolates++;
      } else if (isolated) overIsolates++;
      else if (!overIsolates) overEmbeddings++;
    } else if (c===C.PDI) {
      if (overIsolates) overIsolates--;
      else if (isolates) {
        while (!stack.pop()!.isolated) { /* discard embeddings inside the isolate */ }
        isolates--;
        overEmbeddings=0;
      }
      top=stack[stack.length-1];
      levels[i]=top.level;
      types[i]=top.override ?? c;
    } else if (c===C.PDF) {
      if (!overIsolates) {
        if (overEmbeddings) overEmbeddings--;
        else if (stack.length>1 && !top.isolated) stack.pop();
      }
    } else if (c===C.B) levels[i]=base;
    else if (c!==C.BN) types[i]=top.override ?? c;
  }
  return levels;
}

function resolveWeak(indices: readonly number[], types:C[], sos:C) {
  let prev=sos, lastStrong=sos;
  for (const i of indices) {
    let c=types[i];
    if (c===C.NSM) c=isolate(prev) || prev===C.PDI ? C.ON : prev;
    prev=c;
    if (c===C.EN && lastStrong===C.AL) c=C.AN;
    if (c===C.L || c===C.R || c===C.AL) lastStrong=c;
    types[i]=c===C.AL ? C.R : c;
  }
  for (let j=1;j+1<indices.length;j++) {
    const a=types[indices[j-1]], i=indices[j], b=types[indices[j+1]];
    if (a===b && (types[i]===C.ES && a===C.EN || types[i]===C.CS && (a===C.EN || a===C.AN))) types[i]=a;
  }
  for (let j=0;j<indices.length;) {
    if (types[indices[j]]!==C.ET) { j++; continue; }
    const start=j;
    while (j<indices.length && types[indices[j]]===C.ET) j++;
    if (types[indices[start-1]]===C.EN || types[indices[j]]===C.EN) {
      for (let k=start;k<j;k++) types[indices[k]]=C.EN;
    }
  }
  lastStrong=sos;
  for (const i of indices) {
    const c=types[i];
    if (c===C.L || c===C.R) lastStrong=c;
    else if (c===C.EN && lastStrong===C.L) types[i]=C.L;
    else if (c===C.ET || c===C.ES || c===C.CS) types[i]=C.ON;
  }
}

function resolveBrackets(indices: readonly number[], chars: readonly number[], types:C[], original:readonly C[], dir:C, sos:C) {
  const open: {key:number; pos:number}[]=[], pairs:[number,number][]=[];
  for (let j=0;j<indices.length;j++) {
    const i=indices[j];
    if (types[i]!==C.ON) continue;
    const key=paired.get(chars[i]);
    if (key===undefined) continue;
    if (key>0) {
      if (open.length===63) break;
      open.push({key,pos:j});
    } else {
      for (let k=open.length-1;k>=0;k--) if (open[k].key===-key) {
        pairs.push([open[k].pos,j]);
        open.length=k;
        break;
      }
    }
  }
  pairs.sort((a,b)=>a[0]-b[0]);
  for (const [first,last] of pairs) {
    let found: C | undefined;
    for (let j=first+1;j<last;j++) {
      found=strong(types[indices[j]]) ?? found;
      if (found===dir) break;
    }
    if (found===undefined) continue;
    if (found!==dir) {
      let before: C | undefined;
      for (let j=first-1;j>=0 && before===undefined;j--) before=strong(types[indices[j]]);
      found=(before ?? sos)===found ? found : dir;
    }
    for (const j of [first,last]) {
      types[indices[j]]=found;
      for (let k=j+1;k<indices.length && original[indices[k]]===C.NSM;k++) types[indices[k]]=found;
    }
  }
}

function resolveSequence(indices: readonly number[], chars:readonly number[], original:readonly C[],
  types:C[], levels:Uint8Array, explicit:Uint8Array, sos:C, eos:C) {
  const dir=direction(explicit[indices[0]]);
  resolveWeak(indices,types,sos);
  resolveBrackets(indices,chars,types,original,dir,sos);
  let before=sos;
  for (let j=0;j<indices.length;) {
    const current=strong(types[indices[j]]);
    if (current!==undefined) { before=current; j++; continue; }
    const start=j++;
    while (j<indices.length && strong(types[indices[j]])===undefined) j++;
    const after=strong(types[indices[j]]) ?? eos;
    for (let k=start;k<j;k++) types[indices[k]]=before===after ? before : dir;
  }
  for (const i of indices) {
    const c=types[i], level=explicit[i];
    levels[i]=level+(level%2 ? Number(c!==C.R) : c===C.R ? 1 : c===C.L ? 0 : 2);
  }
}

/** Unicode 16.0 UAX #9 through I2. Line reset and visual placement belong to the line builder. */
export function resolveParagraph(chars: readonly number[], classes:C[], force?:boolean) {
  const base=baseLevel(classes,force), types=classes.slice(), explicit=explicitLevels(classes,types,base);
  const levels=explicit.slice(), visible:number[]=[];
  for (let i=0;i<chars.length;i++) if (!removed(classes[i])) visible.push(i);
  // X10. Equal-level runs on either side of a matched isolate form a single sequence.
  const pending:{indices:number[]; first:number}[]=[];
  for (let k=0;k<visible.length;) {
    const first=k, level=explicit[visible[k]];
    while (++k<visible.length && explicit[visible[k]]===level) { /* one level run */ }
    const start=visible[first], end=visible[k-1];
    const seq=classes[start]===C.PDI && pending.length ? pending.pop()! : {indices:[],first};
    for (let j=first;j<k;j++) seq.indices.push(visible[j]);
    if (isolate(classes[end])) pending.push(seq);
    else finish(seq,k);
  }
  for (const seq of pending) finish(seq,visible.length);
  function finish({indices:seq,first:from}: {indices:number[]; first:number}, after: number) {
    const first=seq[0], last=seq[seq.length-1];
    const beforeLevel=explicit[visible[from-1]] ?? base;
    const afterLevel=isolate(classes[last]) ? base : explicit[visible[after]] ?? base;
    resolveSequence(seq,chars,classes,types,levels,explicit,
      direction(Math.max(explicit[first],beforeLevel)),direction(Math.max(explicit[last],afterLevel)));
  }
  for (let i=0;i<levels.length;i++) if (removed(classes[i])) levels[i]=i ? levels[i-1] : base;
  return {levels,base};
}
