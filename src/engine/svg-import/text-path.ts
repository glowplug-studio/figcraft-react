import { multiply,transformPoint } from "../affine";
import type { PathCommand } from "../corners";
import { cubicLength } from "../cubic";
import type { CurveElement } from "../curve-flatten";
import { measurePath,polylineLength } from "../path-measure";
import { parseSvgPath } from "../svg-path";
import { textPathData } from "../text-path-data";
import { pathBounds } from "../vector-path";
import { elementPath,transformPath } from "./geometry";
import { elementMatrix,svgLength,type SvgUnits } from "./style";

function arcLength(path:readonly PathCommand[]) {
  let x=0,y=0,firstX=0,firstY=0,total=0;
  for(const c of path) {
    if (c[0]==="M") {x=firstX=c[1];y=firstY=c[2];}
    else if (c[0]==="C") {
      total+=cubicLength([{x,y},{x:c[1],y:c[2]},{x:c[3],y:c[4]},{x:c[5],y:c[6]}]);
      x=c[5];y=c[6];
    } else {
      const nx=c[0]==="Z" ? firstX : c[1],ny=c[0]==="Z" ? firstY : c[2];
      total+=Math.hypot(nx-x,ny-y);x=nx;y=ny;
    }
  }
  return total;
}

export function svgTextPath(el:Element,u:SvgUnits) {
  const href=el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink","href");
  const ref=href?.startsWith("#") && el.ownerDocument.getElementById(href.slice(1));
  if (!ref) return;
  const path=elementPath(ref,u);
  if (!path?.length) return;
  const xf=elementMatrix(ref),cubic=transformPath(path,xf),box=pathBounds(cubic);
  if (!box) return;
  const raw=ref.localName==="path" ? parseSvgPath(ref.getAttribute("d") ?? "",true,"svg") : path;
  const tx=multiply([1,0,0,1,-box.x,-box.y],xf);
  const local=raw.map(c=>{
    const out:(number|string)[]=[c[0]];
    for(let i=1;i<c.length;i+=2) {
      const p=transformPoint(tx,{x:Number(c[i]),y:Number(c[i+1])});
      out.push(p.x,p.y);
    }
    return out as unknown as CurveElement;
  });
  const line=measurePath(local)?.[0],length=line && polylineLength(line);
  if (!length) return;
  return {box,path:{d:textPathData(local),start:svgLength(el.getAttribute("startOffset"),arcLength(cubic),u.font)/length,flip:false}};
}
