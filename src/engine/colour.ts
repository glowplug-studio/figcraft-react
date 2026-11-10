/** Non-premultiplied native f32 sRGB channels; source: color::Color. */
export interface Colour { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

export function clampChannel(value: number): number {
  return Number.isNaN(value) ? 0 : Math.fround(Math.max(0, Math.min(1, value)));
}
export function colour(r: number, g: number, b: number, a = 1): Colour {
  return Object.freeze({ r: clampChannel(r), g: clampChannel(g), b: clampChannel(b), a: clampChannel(a) });
}
export function fromRgba8(r: number, g: number, b: number, a = 255): Colour {
  return colour(Math.fround(r / 255), Math.fround(g / 255), Math.fround(b / 255), Math.fround(a / 255));
}
export function toRgba8(value: Colour): readonly [number, number, number, number] {
  const byte = (channel: number) => Math.floor(Math.fround(clampChannel(channel) * 255) + .5);
  return [byte(value.r), byte(value.g), byte(value.b), byte(value.a)];
}
export function withAlpha(value: Colour, alpha: number): Colour { return colour(value.r, value.g, value.b, alpha); }
export function toCssHex(value: Colour): string {
  const [r, g, b, a] = toRgba8(value);
  return `#${[r, g, b, ...(a === 255 ? [] : [a])].map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
/** Canvas CSS retains fractional channels; native copy-as-CSS formatting is a separate workflow. */
export function renderColour(value: Colour): string {
  return `rgba(${value.r * 255},${value.g * 255},${value.b * 255},${value.a})`;
}

export function cssColour(c:Colour) {
  if (c.a>=Math.fround(.999)) return toCssHex(c);
  const [r,g,b,a]=toRgba8(c);
  const keeps=(s:string)=>Math.round(Math.fround(Math.fround(Number(s))*255))===a;
  // Rust decimal formatting rounds exact halfway cases to even.
  const fixed=(x:number,n:number)=>{
    const scale=10**n, scaled=x*scale, floor=Math.floor(scaled);
    const rounded=scaled-floor===.5 && floor%2===0 ? floor : Math.round(scaled);
    return (rounded/scale).toFixed(n);
  };
  const alpha=[fixed(c.a,2),fixed(c.a,3)].find(keeps) ?? fixed(Math.fround(a/255),3);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
