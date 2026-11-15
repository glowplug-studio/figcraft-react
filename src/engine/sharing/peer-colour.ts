/** Native live UI accent, used when an incoming identity has no #RRGGBB colour. */
export const peerColourFallback="#00875F";

/** Derive a display colour without changing the retained protocol identity. */
export function peerColour(colour:string):string {
  // Check length separately: a JavaScript `$` can also match before a final newline.
  return colour.length===7 && /^#[0-9a-fA-F]{6}$/.test(colour)?colour.toUpperCase():peerColourFallback;
}

/** Native live UI text contrast, applied to the accepted RGB colour or accent. */
export function peerTextColour(colour:string):string {
  const rgb=Number.parseInt(peerColour(colour).slice(1),16);
  const f=Math.fround;
  const luminance=f(f(f(f(0.299)*(rgb>>16))+f(f(0.587)*(rgb>>8&255)))+f(f(0.114)*(rgb&255)));
  return luminance>170?"#1e1e1e":"#fff";
}
