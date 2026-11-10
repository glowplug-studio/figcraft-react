import {decodeFigCanvas} from "./canvas";
import type {KiwiValue} from "./kiwi";

self.onmessage=async(event:MessageEvent<{canvas:Uint8Array<ArrayBuffer>;packed:number}>)=>{
  try {
    const {canvas,packed}=event.data;
    const message=await decodeFigCanvas(canvas,packed);
    // Byte fields slice the same expanded chunk. Transfer its buffer once.
    const pending:KiwiValue[]=[message];
    let buffer:ArrayBuffer|undefined;
    while (pending.length && !buffer) {
      const v=pending.pop()!;
      if (v instanceof Uint8Array) buffer=v.buffer as ArrayBuffer;
      else if (Array.isArray(v)) {for (const item of v) if (typeof item==="object") pending.push(item);}
      else if (typeof v==="object") for (const item of Object.values(v)) if (typeof item==="object") pending.push(item);
    }
    self.postMessage({message},{transfer:buffer ? [buffer] : []});
  } catch (error) {
    self.postMessage({error:error instanceof Error ? error.message : "Fig canvas decoding failed"});
  }
};
