/// <reference path="./lcms.d.ts" />
import {instantiate,TYPE_RGBA_8,TYPE_GRAYA_8,cmsFLAGS_COPY_ALPHA} from "lcms-wasm";

export async function loadRuntime() {
  return {lib:await instantiate(),TYPE_RGBA_8,TYPE_GRAYA_8,cmsFLAGS_COPY_ALPHA};
}
