export async function loadIcuModule() {
  const url=new URL("./icu/line-segmenter.wasm",import.meta.url);
  const response=await fetch(url);
  if (!response.ok) throw new Error("Could not load the ICU word segmenter (HTTP "+response.status+")");
  return response.headers.get("content-type")?.split(";")[0]==="application/wasm"
    ? WebAssembly.compileStreaming(response) : WebAssembly.compile(await response.arrayBuffer());
}
