/// <reference path="./icu-runtime.d.ts" />
import { scalarCount } from "./text-ranges";
import { safeEmergencyBreak } from "./text-wrap-boundaries";

const complexRun=/[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u19e0-\u19ff\ua9e0-\ua9ff\uaa60-\uaa7f]+/u;

interface IcuExports extends WebAssembly.Exports {
  memory:WebAssembly.Memory;
  diplomat_alloc:(size:number,align:number)=>number;
  diplomat_free:(ptr:number,size:number,align:number)=>void;
  icu4x_LineSegmenter_create_lstm_mv1:()=>number;
  icu4x_LineSegmenter_segment_utf16_mv1:(segmenter:number,slice:number)=>number;
  icu4x_LineBreakIteratorUtf16_next_mv1:(it:number)=>number;
  icu4x_LineBreakIteratorUtf16_destroy_mv1:(it:number)=>void;
}

async function createSegmenter() {
  const {loadIcuModule}=await import("#figcraft-word-segmenter");
  const instance=await WebAssembly.instantiate(await loadIcuModule());
  const api=instance.exports as IcuExports;
  return {api,segmenter:api.icu4x_LineSegmenter_create_lstm_mv1()};
}
let ready: Awaited<ReturnType<typeof createSegmenter>> | undefined;
let loading:ReturnType<typeof createSegmenter> | undefined;

function markRun(runtime:Awaited<ReturnType<typeof createSegmenter>>, run:string, start:number, flags:Uint8Array) {
  // Every matched character lies in the BMP. An interior UTF-16 boundary is also the scalar offset in this run.
  if (run.length<2) return;
  const {api,segmenter}=runtime;
  const bytes=8+run.length*2;
  const slice=api.diplomat_alloc(bytes,4);
  if (!slice) throw new Error("ICU could not allocate a segmentation buffer");
  try {
    new Uint32Array(api.memory.buffer,slice,2).set([slice+8,run.length]);
    const units=new Uint16Array(api.memory.buffer,slice+8,run.length);
    for (let i=0;i<run.length;i++) units[i]=run.charCodeAt(i);
    const it=api.icu4x_LineSegmenter_segment_utf16_mv1(segmenter,slice);
    try {
      for (let at=api.icu4x_LineBreakIteratorUtf16_next_mv1(it);at>=0;at=api.icu4x_LineBreakIteratorUtf16_next_mv1(it)) {
        if (at>0 && at<run.length && safeEmergencyBreak(run[at-1],run[at])) flags[start+at]=1;
      }
    } finally {
      api.icu4x_LineBreakIteratorUtf16_destroy_mv1(it);
    }
  } finally {
    api.diplomat_free(slice,bytes,4);
  }
}

/** Native browser word boundaries for Thai, Lao, Khmer and Burmese, indexed by Unicode scalar. */
export const wordSegmenterReady = (text:string) => !!ready || !complexRun.test(text);

export async function prepareWordSegmenter(text:string) {
  if (ready || !complexRun.test(text)) return;
  loading ??= createSegmenter().catch(error=>{ loading=undefined; throw error; });
  ready=await loading;
}

export async function textWordStarts(text:string):Promise<Uint8Array> {
  await prepareWordSegmenter(text);
  return preparedWordStarts(text);
}

export function preparedWordStarts(text:string):Uint8Array {
  if (!complexRun.test(text)) return new Uint8Array();
  if (!ready) throw new Error("Prepare the word segmenter before laying out complex text");
  const runtime=ready;
  const flags=new Uint8Array(scalarCount(text));
  let scalar=0, utf16=0;
  for (const match of text.matchAll(new RegExp(complexRun,"gu"))) {
    scalar+=scalarCount(text.slice(utf16,match.index));
    markRun(runtime,match[0],scalar,flags);
    utf16=match.index+match[0].length;
    scalar+=match[0].length;
  }
  return flags;
}
