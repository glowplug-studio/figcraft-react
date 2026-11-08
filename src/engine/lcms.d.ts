declare module "lcms-wasm" {
  export const TYPE_RGBA_8: number, TYPE_GRAYA_8: number, cmsFLAGS_COPY_ALPHA: number;
  export interface LittleCms {
    cmsOpenProfileFromMem(bytes:Uint8Array,length:number): number;
    cmsCreate_sRGBProfile(): number;
    cmsCloseProfile(handle:number): void;
    cmsCreateTransform(input:number, inputFormat:number, output:number, outputFormat:number, intent:number, flags:number): number;
    cmsDeleteTransform(handle:number): void;
    cmsDoTransform(handle:number, bytes:Uint8Array, pixels:number): Uint8Array;
  }
  export function instantiate(): Promise<LittleCms>;
}
declare module "#figcraft-icc-runtime" {
  export function loadRuntime():Promise<{lib:import("lcms-wasm").LittleCms; TYPE_RGBA_8:number; TYPE_GRAYA_8:number; cmsFLAGS_COPY_ALPHA:number}>;
}
