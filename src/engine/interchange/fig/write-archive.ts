import {BlobReader,BlobWriter,ZipWriter} from "@zip.js/zip.js/lib/zip-core-native.js";
import {writeKiwiMessage,writeKiwiSchema} from "./encode";
import type {KiwiValue,readKiwiSchema} from "./kiwi";

type Schema=ReturnType<typeof readKiwiSchema>;
const maxCanvas=256*1024**2;
const maxFile=1024**3;
function littleWord(n:number) {
  const bytes=new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0,n,true);
  return bytes;
}
async function compress(bytes:Uint8Array<ArrayBuffer>) {
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Response(stream).blob();
}
export async function writeFigCanvas(schema:Schema,message:KiwiValue) {
  const compressedSchema=await compress(writeKiwiSchema(schema));
  const compressedMessage=await compress(writeKiwiMessage(schema,message));
  const canvas=new Blob(["fig-kiwi",littleWord(101),littleWord(compressedSchema.size),compressedSchema,littleWord(compressedMessage.size),compressedMessage]);
  if (canvas.size>maxCanvas) throw new Error("the document is too large for a .fig file");
  return canvas;
}
export async function writeFigArchive(canvas:Blob,name:string,background:{r:number;g:number;b:number;a:number},images:ReadonlyMap<string,Blob>,thumbnail?:Blob) {
  let total=canvas.size+(thumbnail?.size ?? 0);
  for (const [hash,image] of images) {
    if (!/^[a-f0-9]+$/.test(hash) || hash.length>128) throw new Error("invalid Fig image hash");
    total+=image.size;
    if (total>maxFile) throw new Error("the document is too large for a .fig file");
  }
  const zip=new ZipWriter(new BlobWriter("application/octet-stream"),{useWebWorkers:false,extendedTimestamp:false});
  await zip.add("canvas.fig",new BlobReader(canvas),{level:0});
  let thumbnailSize:{width:number;height:number}|undefined;
  if (thumbnail) {
    await zip.add("thumbnail.png",new BlobReader(thumbnail),{level:0});
    if (thumbnail.size>=24) {
      const header=new DataView(await thumbnail.slice(16,24).arrayBuffer());
      thumbnailSize={width:header.getUint32(0),height:header.getUint32(4)};
    }
  }
  const meta={client_meta:{background_color:background,thumbnail_size:thumbnailSize},file_name:name};
  await zip.add("meta.json",new BlobReader(new Blob([JSON.stringify(meta)])));
  for (const [hash,image] of images) await zip.add("images/"+hash,new BlobReader(image),{level:0});
  return zip.close();
}
