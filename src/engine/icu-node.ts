import { readFile } from "node:fs/promises";

export async function loadIcuModule() {
  return WebAssembly.compile(await readFile(new URL("./icu/line-segmenter.wasm",import.meta.url)));
}
