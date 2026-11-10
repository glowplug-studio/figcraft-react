import { parseSketchJson } from "./json";

self.onmessage=(event:MessageEvent<{bytes:ArrayBuffer; name:string}>)=>{
  try {self.postMessage({value:parseSketchJson(event.data.bytes,event.data.name)});}
  catch (error) {self.postMessage({error:error instanceof Error ? error.message : String(error)});}
};
