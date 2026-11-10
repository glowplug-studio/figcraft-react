import CanvasWorker from "./canvas-worker?worker&inline";
import {decodeFigCanvas} from "./canvas";
import type {KiwiValue} from "./kiwi";

/** Cancelled or completed imports release the worker and its expanded message. */
export async function readFigCanvas(canvas:Uint8Array<ArrayBuffer>,packed:number,checkCurrent:()=>void):Promise<KiwiValue> {
  checkCurrent();
  if (typeof Worker==="undefined") return decodeFigCanvas(canvas,packed);
  const worker=new CanvasWorker();
  let timer:ReturnType<typeof setInterval>|undefined;
  try {
    return await new Promise<KiwiValue>((resolve,reject)=>{
      timer=setInterval(()=>{try {checkCurrent();} catch(error) {reject(error);}},32);
      worker.onmessage=(event:MessageEvent<{message:KiwiValue}|{error:string}>)=>{
        if ("error" in event.data) reject(new Error(event.data.error));
        else resolve(event.data.message);
      };
      worker.onerror=event=>{event.preventDefault();reject(new Error(event.message || "Fig canvas worker failed"));};
      worker.onmessageerror=()=>reject(new Error("Cannot read decoded Fig canvas"));
      worker.postMessage({canvas,packed},[canvas.buffer]);
    });
  } finally {
    clearInterval(timer);
    worker.terminate();
  }
}
