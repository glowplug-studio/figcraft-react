import EncodeWorker from "./encode-worker?worker&inline";
import {figExportSchema} from "./export-schema";
import type {KiwiObject} from "./kiwi";
import {writeFigCanvas} from "./write-archive";

export async function encodeFigCanvas(message:KiwiObject,buffers:ArrayBuffer[],checkCurrent:()=>void) {
  checkCurrent();
  if (typeof Worker==="undefined") return writeFigCanvas(figExportSchema,message);
  const worker=new EncodeWorker();
  let timer:ReturnType<typeof setInterval>|undefined;
  try {
    return await new Promise<Blob>((resolve,reject)=>{
      timer=setInterval(()=>{try {checkCurrent();} catch(error) {reject(error);}},32);
      worker.onmessage=(event:MessageEvent<{canvas:Blob}|{error:string}>)=>{
        if ("error" in event.data) reject(new Error(event.data.error));
        else resolve(event.data.canvas);
      };
      worker.onerror=e=>{e.preventDefault();reject(new Error(e.message || "Fig canvas worker failed"));};
      worker.onmessageerror=()=>reject(new Error("Cannot read encoded Fig canvas"));
      worker.postMessage(message,buffers);
    });
  } finally {clearInterval(timer);worker.terminate();}
}
