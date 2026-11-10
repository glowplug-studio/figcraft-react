import {decodePenpotJson} from "./json";

self.onmessage=(event:MessageEvent<{bytes:ArrayBuffer;context:string;budget:number}>)=>{
  const {bytes,context,budget}=event.data;
  self.postMessage(decodePenpotJson(bytes,context,budget));
};
