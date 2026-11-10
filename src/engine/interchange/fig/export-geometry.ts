import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {roundedRect,zeroCorners,type PathCommand,type Radii} from "../../corners";
import {isFrameLike,type LayerNode} from "../../document";
import {ellipsePath,fullSweep,TAU} from "../../ellipse";
import {outlineBand} from "../../path-boolean";
import {shapePath,strokeGeometry} from "../../shape-path";
import {defaultStroke} from "../../stroke";
import type {KiwiObject} from "./kiwi";

export class FigBlobs {
  readonly blobs:{bytes:Uint8Array}[]=[];
  readonly #hashes=new Map<string,number>();
  #size=0;
  constructor(readonly warn:(s:string)=>void) {}
  add(bytes:Uint8Array) {
    const hash=bytesToHex(sha256(bytes)),existing=this.#hashes.get(hash);
    if (existing!==undefined) return existing;
    this.#size+=bytes.length;
    if (this.#size>256*1024**2) {this.warn("vector data too large for the format was left out");return;}
    const index=this.blobs.length;this.blobs.push({bytes});this.#hashes.set(hash,index);return index;
  }
  path(out:KiwiObject,key:string,path:readonly PathCommand[],odd=false) {
    if (!path.length) return;
    const length=path.reduce((sum,el)=>sum+1+4*(el.length-1),0);
    if (length>256*1024**2) {this.warn("vector data too large for the format was left out");return;}
    const bytes=new Uint8Array(length),v=new DataView(bytes.buffer);
    let off=0;
    for (const el of path) {
      bytes[off++]="ZMLQC".indexOf(el[0]);
      for (let j=1;j<el.length;j++,off+=4) {
        const n=Number(el[j]);
        v.setFloat32(off,Number.isFinite(n) ? Math.max(-1e30,Math.min(1e30,n)) : 0,true);
      }
    }
    const commandsBlob=this.add(bytes);
    if (commandsBlob!==undefined) out[key]=[{windingRule:odd ? "ODD" : "NONZERO",commandsBlob,styleID:0}];
  }
}
export function shapeGeometry(out:KiwiObject,node:LayerNode,blobs:FigBlobs) {
  const box=node.kind==="rectangle" || node.kind==="section" || isFrameLike(node),curved=["ellipse","polygon","star"].includes(node.kind);
  if (box || curved) blobs.path(out,"fillGeometry",shapePath(node));
  const stroke=node.stroke ?? defaultStroke,w=stroke.weight;
  if (!node.strokes?.some(s=>s.visible) || w<=0 || stroke.dashes.length || stroke.sides || stroke.widthProfile?.points.length || stroke.brush) return;
  const whole=node.kind==="ellipse" && node.inner===0 && fullSweep(node.sweep);
  if (box || whole) {
    const corners=node.corners ?? zeroCorners,outer=stroke.align==="inside" ? 0 : stroke.align==="center" ? w/2 : w;
    function grown(delta:number):PathCommand[] {
      const gw=node.width+2*delta,gh=node.height+2*delta;
      if (gw<=0 || gh<=0) return [];
      const radii=corners.radii.map(r=>r>0 ? Math.max(0,r+delta) : 0) as unknown as Radii;
      const path=whole ? ellipsePath(gw,gh,{start:0,sweep:TAU,inner:0}) : roundedRect(gw,gh,{...corners,radii});
      return path.map(el=>el[0]==="Z" ? el : el[0]==="C" ? ["C",el[1]-delta,el[2]-delta,el[3]-delta,el[4]-delta,el[5]-delta,el[6]-delta] : [el[0],el[1]-delta,el[2]-delta]);
    }
    const ring=grown(outer);
    if (ring.length) blobs.path(out,"strokeGeometry",ring.concat(grown(outer-w)),true);
  } else if (stroke.align==="center" && node.kind!=="text" && node.kind!=="group" && node.kind!=="booleanOp") {
    const path=strokeGeometry(node),cap=stroke.capStart==="round" ? "round" : stroke.capStart==="square" ? "square" : "butt";
    if (path.length) blobs.path(out,"strokeGeometry",outlineBand(path,w,stroke.join,Math.max(1,stroke.miterLimit),[cap,cap],null));
  }
}
