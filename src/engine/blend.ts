/** The native file tags, in the order of Figcraft's layer blend menu. */
export const blendModes = ["passThrough","normal","darken","multiply","plusDarker","colorBurn","lighten","screen","plusLighter",
  "colorDodge","overlay","softLight","hardLight","difference","exclusion","hue","saturation","color","luminosity"] as const;
export type BlendMode = typeof blendModes[number];
export const blendLabel = (mode:BlendMode) => mode[0].toUpperCase() + mode.slice(1).replace(/[A-Z]/g, c => " " + c.toLowerCase());
export function isBlendMode(value:unknown): value is BlendMode {
  return typeof value === "string" && blendModes.some(mode => mode === value);
}
const aliases=new Map(blendModes.map(mode=>[mode.toLowerCase(),mode]));
export function blendFromName(value:unknown): BlendMode | undefined {
  return typeof value === "string" ? aliases.get(value.replace(/[^a-zA-Z0-9]/g,"").toLowerCase()) : undefined;
}
export const canvasBlend: Record<Exclude<BlendMode,"plusDarker">,GlobalCompositeOperation> = {
  passThrough:"source-over",normal:"source-over",darken:"darken",multiply:"multiply",colorBurn:"color-burn",
  lighten:"lighten",screen:"screen",plusLighter:"lighter",colorDodge:"color-dodge",overlay:"overlay",
  softLight:"soft-light",hardLight:"hard-light",difference:"difference",exclusion:"exclusion",hue:"hue",
  saturation:"saturation",color:"color",luminosity:"luminosity",
};

/** Canvas readbacks are straight RGBA. The overlap uses linear burn in premultiplied source-over. */
export function plusDarkerPixels(dst:Uint8ClampedArray, src:Uint8ClampedArray, opacity:number) {
  const amount=Number.isFinite(opacity) ? Math.max(0,Math.min(1,opacity)) : 0;
  for (let i=0;i<dst.length;i+=4) {
    const sa=src[i+3]*amount/255;
    if (!sa) continue;
    const da=dst[i+3]/255, alpha=sa+da*(1-sa);
    for(let c=i;c<i+3;c++) {
      const back=dst[c], front=src[c];
      const overlap=Math.max(0,front+back-255);
      dst[c]=Math.round((sa*(1-da)*front+da*(1-sa)*back+sa*da*overlap)/alpha);
    }
    dst[i+3]=Math.round(alpha*255);
  }
}
