import { expect,it } from "vitest";
import { parseCssColour } from "../../src/engine/colour-css";
import { toRgba8 } from "../../src/engine/colour";
import type { ColourProfile } from "../../src/engine/colour-spaces";
import { svgColourResolver } from "../../src/engine/svg-import/colour";
import samples from "../fixtures/native-svg-import-colours.json";

for (const [profile,call,rgba,message] of samples as [ColourProfile,string,number[],string|null][]) {
  it(profile+" SVG "+call,()=>{
    const notes:string[]=[];
    const value=svgColourResolver(profile,n=>notes.push(n))(call);
    expect(toRgba8(parseCssColour(value)!)).toEqual(rgba);
    expect(notes).toEqual(message ? [message] : []);
  });
}
