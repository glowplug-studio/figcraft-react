declare module "#figcraft-word-segmenter" {
  export function loadIcuModule():Promise<WebAssembly.Module>;
}
