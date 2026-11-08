/// <reference types="node" />
/// <reference path="./lcms.d.ts" />

/** Node reads the installed WASM asset alongside its package, including from an SSR host. */
export async function loadRuntime() {
  const requirePackage=process.getBuiltinModule("node:module").createRequire(import.meta.url);
  const {instantiate,TYPE_RGBA_8,TYPE_GRAYA_8,cmsFLAGS_COPY_ALPHA}:typeof import("lcms-wasm")=requirePackage("lcms-wasm");
  return {lib:await instantiate(),TYPE_RGBA_8,TYPE_GRAYA_8,cmsFLAGS_COPY_ALPHA};
}
