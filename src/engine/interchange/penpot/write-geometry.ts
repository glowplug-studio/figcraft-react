import {inverse,identity,transformPoint,type Affine} from "../../affine";
import {toRgba8,type Colour} from "../../colour";
import {roundedRect,type PathCommand} from "../../corners";
import {isFrameLike,rectanglePaints,type Document,type DocumentNode,type LayerNode} from "../../document";
import {worldTransform} from "../../hierarchy";
import {foldBooleanPaths} from "../../path-boolean";
import {shapePath,strokeGeometry} from "../../shape-path";
import {mapVectorPath} from "../../vector-region-selection";
import {parse} from "lossless-json";

export type Fields=Record<string,unknown>;
export type Warn=(message:string)=>void;
export function sourceValue(node:DocumentNode,key:string):unknown {
  const value=node.sourceMetadata?.["penpot.source."+key];
  if (value===undefined) return;
  try {return parse(value);} catch {return;}
}
export function rawSvg(node:DocumentNode) {
  return node.sourceMetadata?.["penpot.svgRawStatus"]!==undefined && sourceValue(node,"content")!==undefined;
}
export function penpotType(n:DocumentNode) {
  if (rawSvg(n)) return "svg-raw";
  if (isFrameLike(n)) return "frame";
  switch (n.kind) {
    case "group": case "text": return n.kind;
    case "booleanOp": return "bool";
    case "rectangle": return "rect";
    case "ellipse": return Math.abs(n.start)<1e-9 && Math.abs(n.sweep-Math.PI*2)<1e-9 && Math.abs(n.inner)<1e-9 ? "circle" : "path";
    case "line": case "polygon": case "star": case "vector": return "path";
  }
}
export function rgb(c:Colour) {
  return "#"+toRgba8(c).slice(0,3).map(v=>v.toString(16).padStart(2,"0")).join("");
}
export function rounded(v:number) {
  if (!Number.isFinite(v)) return 0;
  return Math.sign(v)*Math.round(Math.abs(v)*1e6)/1e6 || 0;
}
function matrix(t:Affine) {
  const [a,b,c,d,e,f]=t.map(rounded);
  return {a,b,c,d,e,f};
}
export function baseShape(id:string,name:string,type:string,x:number,y:number,w:number,h:number,linear:Affine) {
  const [a,b,c,d]=linear,det=a*d-b*c;
  const cx=x+w/2,cy=y+h/2;
  const world:Affine=[a,b,c,d,cx-a*w/2-c*h/2,cy-b*w/2-d*h/2];
  const points=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>{
    const p=transformPoint(world,{x,y});
    return {x:rounded(p.x),y:rounded(p.y)};
  });
  let rotation=Math.atan2(b,a)*180/Math.PI;
  if (rotation<0) rotation+=360;
  if (rotation<1e-6 || 360-rotation<1e-6) rotation=0;
  const box={x:rounded(x),y:rounded(y),width:rounded(w),height:rounded(h)};
  return {id,name,type,...box,rotation:rounded(rotation),selrect:{...box,x1:box.x,y1:box.y,x2:rounded(x+w),y2:rounded(y+h)},points,
    transform:matrix(linear),transformInverse:matrix(Math.abs(det)>1e-12 ? inverse(linear) : identity),flipX:det<0 ? true : null,flipY:null,proportionLock:false};
}

type Path=readonly PathCommand[];
function closedOperand(path:Path) {
  const closed:PathCommand[]=[];
  let open=false;
  for (const command of path) {
    if (command[0]==="M") {
      if (open) closed.push(["Z"]);
      open=true;
    } else if (command[0]==="Z") open=false;
    closed.push(command);
  }
  if (open) closed.push(["Z"]);
  return closed;
}
function worldOutline(doc:Document,n:LayerNode,warn:Warn,depth=0):Path {
  if (depth>64) return [];
  if (n.kind==="group" || n.kind==="booleanOp") {
    const parts=n.children.flatMap(id=>{
      const child=doc.nodes[id];
      return child && child.kind!=="page" ? [{node:child,path:worldOutline(doc,child,warn,depth+1)}] : [];
    });
    if (n.kind==="group") return parts.flatMap(p=>p.path);
    const operands=parts.map(p=>({path:closedOperand(p.path),operation:p.node.boolOp ?? n.op}));
    try {
      return foldBooleanPaths(operands);
    } catch {
      warn("Boolean layer '"+n.name+"' could not be flattened; its operands were exported as one path");
      return operands.flatMap(p=>p.path);
    }
  }
  const path=n.kind==="text" || n.kind==="slice" ? roundedRect(n.width,n.height) :
    n.kind==="vector" && (!rectanglePaints(n).length || n.strokes?.length) ? strokeGeometry(n) : shapePath(n);
  const m=worldTransform(doc,n.id);
  return mapVectorPath(path,p=>transformPoint(m,p));
}
function pathContent(path:Path) {
  return path.map(op=>{
    if (op[0]==="Z") return {command:"close-path",params:{}};
    if (op[0]==="C") return {command:"curve-to",params:{c1x:rounded(op[1]),c1y:rounded(op[2]),c2x:rounded(op[3]),c2y:rounded(op[4]),x:rounded(op[5]),y:rounded(op[6])}};
    return {command:op[0]==="M"?"move-to":"line-to",params:{x:rounded(op[1]),y:rounded(op[2])}};
  });
}
export function layerGeometry(doc:Document,n:LayerNode,id:string,type:string,warn:Warn):Fields {
  const m=worldTransform(doc,n.id),w=Math.max(n.width,.01),h=Math.max(n.height,.01);
  const centre=transformPoint(m,{x:w/2,y:h/2}),linear:Affine=[m[0],m[1],m[2],m[3],0,0];
  const fields:Fields=baseShape(id,n.name,type,centre.x-w/2,centre.y-h/2,w,h,linear);
  if (type==="path" || type==="bool") fields.content=pathContent(worldOutline(doc,n,warn));
  return fields;
}
