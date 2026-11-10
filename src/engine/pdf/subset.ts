import wasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url&inline";

interface Subsetter {
  memory:WebAssembly.Memory;
  _initialize():void;
  malloc(size:number):number;
  free(ptr:number):void;
  hb_blob_create(data:number,length:number,mode:number,user:number,destroy:number):number;
  hb_blob_destroy(blob:number):void;
  hb_blob_get_data(blob:number,length:number):number;
  hb_blob_get_length(blob:number):number;
  hb_face_create(blob:number,index:number):number;
  hb_face_destroy(face:number):void;
  hb_face_reference_blob(face:number):number;
  hb_set_clear(set:number):void;
  hb_set_add(set:number,item:number):void;
  hb_subset_input_create_or_fail():number;
  hb_subset_input_destroy(input:number):void;
  hb_subset_input_set_flags(input:number,flags:number):void;
  hb_subset_input_glyph_set(input:number):number;
  hb_subset_input_unicode_set(input:number):number;
  hb_subset_input_pin_all_axes_to_default(input:number,face:number):number;
  hb_subset_or_fail(face:number,input:number):number;
}
let runtime:Promise<Subsetter> | undefined;
function subsetter() {
  if (!runtime) runtime=(async()=>{
    const response=await fetch(wasmUrl);
    if (!response.ok) throw new Error("Could not load PDF font subsetter");
    const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),{});
    const api=instance.exports as unknown as Subsetter;
    api._initialize();
    return api;
  })().catch(error=>{runtime=undefined; throw error;});
  return runtime;
}
export async function subsetFont(source:()=>{bytes:Uint8Array;index:number},glyphs:Iterable<number>) {
  const hb=await subsetter(), {bytes,index}=source(), ptr=hb.malloc(bytes.length);
  if (!ptr) throw new Error("Could not allocate font subset");
  let blob=0,face=0,input=0,subset=0,result=0;
  try {
    new Uint8Array(hb.memory.buffer,ptr,bytes.length).set(bytes);
    blob=hb.hb_blob_create(ptr,bytes.length,1,0,0);
    face=hb.hb_face_create(blob,index);
    input=hb.hb_subset_input_create_or_fail();
    if (!input) throw new Error("Could not allocate font subset input");
    // Retain glyph IDs and the visible .notdef outline used by missing characters.
    hb.hb_subset_input_set_flags(input,2 | 64);
    hb.hb_subset_input_pin_all_axes_to_default(input,face);
    hb.hb_set_clear(hb.hb_subset_input_unicode_set(input));
    const set=hb.hb_subset_input_glyph_set(input);
    for (const id of glyphs) hb.hb_set_add(set,id);
    subset=hb.hb_subset_or_fail(face,input);
    if (!subset) throw new Error("Font cannot be embedded in PDF");
    result=hb.hb_face_reference_blob(subset);
    const data=hb.hb_blob_get_data(result,0), size=hb.hb_blob_get_length(result);
    if (!data || !size) throw new Error("The embedded font subset is empty");
    return new Uint8Array(hb.memory.buffer,data,size).slice();
  } finally {
    if (result) hb.hb_blob_destroy(result);
    if (subset) hb.hb_face_destroy(subset);
    if (input) hb.hb_subset_input_destroy(input);
    if (face) hb.hb_face_destroy(face);
    if (blob) hb.hb_blob_destroy(blob);
    hb.free(ptr);
  }
}
