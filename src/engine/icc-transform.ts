/// <reference path="./lcms.d.ts" />
import { loadRuntime } from "#figcraft-icc-runtime";

import { displayP3Icc } from "./working-icc";
import type { ColourProfile } from "./colour-spaces";

let p3Profile: Uint8Array<ArrayBuffer> | undefined;
let loading: ReturnType<typeof loadRuntime> | undefined;
async function cms() {
  loading ??= loadRuntime().catch(error=>{loading=undefined;throw error;});
  return loading;
}

export async function openIccTransform(profile:Uint8Array, grey:boolean, target: ColourProfile = "srgb") {
  const {lib,TYPE_RGBA_8,TYPE_GRAYA_8,cmsFLAGS_COPY_ALPHA}=await cms();
  const input=lib.cmsOpenProfileFromMem(profile,profile.length);
  if (!input) return;
  let output = 0;

  try {
    if (target === "displayP3") {
      p3Profile ??= displayP3Icc();
      output = lib.cmsOpenProfileFromMem(p3Profile, p3Profile.length);
    } else {
      output = lib.cmsCreate_sRGBProfile();
    }
    const transform=output && lib.cmsCreateTransform(input,grey?TYPE_GRAYA_8:TYPE_RGBA_8,output,TYPE_RGBA_8,1,cmsFLAGS_COPY_ALPHA);
    if (!transform) return;
    return {
      convert(rgba:Uint8ClampedArray) {
        const pixels=rgba.length/4;
        let source=new Uint8Array(rgba.buffer,rgba.byteOffset,rgba.byteLength);
        if (grey) {
          source=new Uint8Array(pixels*2);
          for (let i=0;i<pixels;i++) {source[i*2]=rgba[i*4];source[i*2+1]=rgba[i*4+3];}
        }
        rgba.set(lib.cmsDoTransform(transform,source,pixels));
      },
      close() {lib.cmsDeleteTransform(transform);}
    };
  } finally {if(output)lib.cmsCloseProfile(output);lib.cmsCloseProfile(input);}
}
