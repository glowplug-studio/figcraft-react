const messages = {
  dropShadow: "drop shadows were left out",
  innerShadow: "inner shadows were left out",
  layerBlur: "layer blurs were left out",
  backgroundBlur: "background blurs were left out",
  noise: "noise effects were left out",
  texture: "texture effects were left out",
  glass: "glass effects were left out",
  blend: "blend modes were drawn as normal",
  imageFill: "image fills were left out",
  patternFill: "pattern fills were left out",
  diamondApprox: "diamond gradients were drawn as radial gradients",
  diamondOmitted: "diamond gradients were left out (exact mode)",
  opacityApprox: "layer opacity was applied to each shape: where shapes overlap they look denser",
  opacityOmitted: "layers with opacity over overlapping shapes were left out (exact mode)",
  evenOddRewritten: "even-odd fills were rewritten as non-zero",
  evenOddKept: "even-odd fills couldn't be rewritten and use fillType=\"evenOdd\" (API 24+ or AndroidX)",
  clipEvenOddRewritten: "even-odd clip outlines were rewritten as non-zero",
  clipEvenOddApprox: "even-odd clip outlines couldn't be rewritten and clip as non-zero",
  clipEvenOddOmitted: "layers under even-odd clip outlines that couldn't be rewritten were left out (exact mode)",
  maskApprox: "alpha and luminance masks clip to the mask's outline",
  maskOmitted: "layers under alpha or luminance masks were left out (exact mode)",
  tooLarge: "shapes with coordinates beyond ±10,000,000 were left out",
  nothingDrawn: "nothing in it could be drawn: the drawable is empty",
} as const;
export type WarningKind = keyof typeof messages;
export class DrawableWarnings {
  private names=new Map<WarningKind,Set<string>>();
  constructor(private silent:boolean) {}
  add(kind:WarningKind,name:string) {
    if (this.silent) return;
    let names=this.names.get(kind);
    if (!names) {names=new Set(); this.names.set(kind,names);}
    names.add(name);
  }
  finish() {
    const lines:string[]=[];
    for (const kind of Object.keys(messages) as WarningKind[]) {
      const names=this.names.get(kind);
      if (!names) continue;
      const shown:string[]=[];
      for (const name of names) {shown.push(name || "unnamed layer"); if (shown.length===3) break;}
      if (names.size>3) shown.push((names.size-3)+" more");
      lines.push(messages[kind]+" ("+shown.join(", ")+")");
    }
    return lines;
  }
}
