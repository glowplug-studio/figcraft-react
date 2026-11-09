import type { CurveElement } from "./curve-flatten";
import { parseSvgPath } from "./svg-path";

/** kurbo's SVG writer uses Display for f64 (plain decimals, including negative zero). */
function decimal(n:number): string {
  if (!Number.isFinite(n)) throw new Error("Non-finite path coordinate");
  if (Object.is(n,-0)) return "-0";
  const value=String(n);
  if (!value.includes("e")) return value;
  const [mantissa,e]=value.split("e"), sign=mantissa.startsWith("-") ? "-" : "";
  const digits=mantissa.slice(sign.length).replace(".","");
  const point=1+Number(e);
  if (point<=0) return sign+"0."+"0".repeat(-point)+digits;
  if (point>=digits.length) return sign+digits+"0".repeat(point-digits.length);
  return sign+digits.slice(0,point)+"."+digits.slice(point);
}

export function textPathData(elements:readonly CurveElement[], sx=1, sy=1) {
  return elements.map(el=>{
    const points=[];
    for (let i=1;i<el.length;i+=2) points.push(decimal(Number(el[i])*sx)+","+decimal(Number(el[i+1])*sy));
    return el[0]+points.join(" ");
  }).join(" ");
}

export function scaleTextPathData(d:string,sx:number,sy:number) {
  let elements:readonly CurveElement[];
  try { elements=parseSvgPath(d,true); } catch { return ""; }
  return textPathData(elements,sx,sy);
}
