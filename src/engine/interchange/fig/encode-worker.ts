import {figExportSchema} from "./export-schema";
import type {KiwiObject} from "./kiwi";
import {writeFigCanvas} from "./write-archive";

self.onmessage=async(event:MessageEvent<KiwiObject>)=>{
  try {self.postMessage({canvas:await writeFigCanvas(figExportSchema,event.data)});}
  catch (error) {self.postMessage({error:error instanceof Error ? error.message : "Fig canvas encoding failed"});}
};
