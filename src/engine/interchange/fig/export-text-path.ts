import type {CurveElement} from "../../curve-flatten";
import {cubicLength,type Cubic} from "../../cubic";
import type {LayerNode} from "../../document";
import {measurePath,polylineLength} from "../../path-measure";
import {parseSvgPath} from "../../svg-path";
import type {TextData} from "../../text-data";
import type {FigBlobs} from "./export-geometry";
import type {KiwiObject} from "./kiwi";

/**
 * Text on a path in a .fig export. Source: format/fig/export/shape.rs `text_path`, `text_path_net`, `path_chain`,
 * `net_cubic` and `net_length` (upstream #2323). The text is written as the format's own layer kind with where it
 * starts and the first part of its path as a vector network; the reader's `text-path.ts` is the other direction.
 */

/** The style id the format gives the segment a text on a path starts on. */
const MARK=0x01ffffff,MAX_NETWORK=200000,MAX_FLOAT=1e30;
const LINES="text on a path with more than one line was written as plain text";
const CANT="text on a path the format can't hold was written as plain text";
const PARTS="the parts of a text's path after the first were left out";
const INSTANCE="text on a path in an instance but not in its main component, or the other way round, was written as the main has it";
const INSTANCE_LINES="an instance's text of more than one line stays on its main component's text path in the file, as an override can't take it off";

type Pair=readonly [number,number];
interface Segment {style:number;a:number;ta:Pair;b:number;tb:Pair}
interface Network {vertices:{x:number;y:number}[];segments:Segment[]}

const finite=(x:number)=>Number.isFinite(x) ? Math.max(-MAX_FLOAT,Math.min(x,MAX_FLOAT)) : 0;
/** A coordinate as the file's 32-bit number holds it. */
const r=(x:number)=>Math.fround(finite(x));

/** The tangent-to-control-point cubic of a network segment, as the reader builds it, and whether it is a line. */
function netCubic(net:Network,s:Segment):{c:Cubic;line:boolean}|undefined {
  const a=net.vertices[s.a],b=net.vertices[s.b];
  if (!a || !b) return undefined;
  return {c:[{x:a.x,y:a.y},{x:a.x+s.ta[0],y:a.y+s.ta[1]},{x:b.x+s.tb[0],y:b.y+s.tb[1]},{x:b.x,y:b.y}],
    line:s.ta[0]===0 && s.ta[1]===0 && s.tb[0]===0 && s.tb[1]===0};
}
/** The length of a segment, as the reader measures it. */
function netLength(net:Network,s:Segment) {
  const made=netCubic(net,s);
  if (!made) return 0;
  return made.line ? Math.hypot(made.c[3].x-made.c[0].x,made.c[3].y-made.c[0].y) : cubicLength(made.c,1,1e-9);
}
/** The parameter at which the cubic's length from its start is `distance`. */
function parameterAt(c:Cubic,distance:number) {
  let low=0,high=1;
  for (let i=0;i<60;i++) {
    const mid=(low+high)/2;
    if (cubicLength(c,mid,1e-10)<distance) low=mid; else high=mid;
  }
  return (low+high)/2;
}

/** The part of a path (a move and what follows it) as a chain of the network, and whether it is a cycle; nothing
 * without a segment longer than a billionth. */
function pathChain(part:readonly CurveElement[]):{net:Network;cycle:boolean}|undefined {
  const net:Network={vertices:[],segments:[]};
  let closed=false,cur:Pair=[0,0];
  const add=(c1:Pair|undefined,c2:Pair|undefined,end:Pair)=>{
    const last=net.vertices.at(-1);
    if (!last) return;
    const index=net.vertices.length-1,tangent=(c:Pair|undefined,from:Pair):Pair=>c ? [r(c[0]-from[0]),r(c[1]-from[1])] : [0,0];
    const segment:Segment={style:0,a:index,ta:tangent(c1,[last.x,last.y]),b:index+1,tb:tangent(c2,end)};
    net.vertices.push({x:end[0],y:end[1]});
    if (netLength(net,segment)>1e-9) net.segments.push(segment); else net.vertices.pop();
  };
  for (const el of part) {
    if (el[0]==="M") {cur=[r(el[1]),r(el[2])];net.vertices.push({x:cur[0],y:cur[1]});}
    else if (el[0]==="L") {cur=[r(el[1]),r(el[2])];add(undefined,undefined,cur);}
    else if (el[0]==="Q") {
      // The quadratic raised to a cubic, from the points as the file holds them.
      const p0=cur,c:Pair=[r(el[1]),r(el[2])],p:Pair=[r(el[3]),r(el[4])];
      cur=p;
      add([p0[0]+2/3*(c[0]-p0[0]),p0[1]+2/3*(c[1]-p0[1])],[p[0]+2/3*(c[0]-p[0]),p[1]+2/3*(c[1]-p[1])],cur);
    } else if (el[0]==="C") {
      // The control points are not rounded on their own: the format holds each as its offset from the end point, and
      // taken from the point as read that is the offset the file had.
      cur=[r(el[5]),r(el[6])];
      add([finite(el[1]),finite(el[2])],[finite(el[3]),finite(el[4])],cur);
    } else closed=true;
  }
  if (!net.segments.length) return undefined;
  const first=net.vertices[0],last=net.vertices.at(-1)!;
  const near=Math.hypot(last.x-first.x,last.y-first.y)<=1e-6;
  let cycle=false;
  if (closed || near) {
    if (near) {
      // The last segment ends on the first vertex. A single segment stays an open chain of two vertices at one place:
      // the reader refuses a segment from a vertex to itself.
      if (net.segments.length>1) {
        net.vertices.pop();
        const s=net.segments.at(-1)!;
        s.b=0;s.tb=[r(last.x+s.tb[0]-first.x),r(last.y+s.tb[1]-first.y)];cycle=true;
      }
    } else {
      net.segments.push({style:0,a:net.vertices.length-1,ta:[0,0],b:0,tb:[0,0]});cycle=true;
    }
  }
  return {net,cycle};
}

/** A text on a path as the format holds it: one chain or cycle with the segment the text starts on marked and the
 * start as that segment's own parameter. Otherwise the warning for why it stays plain text. */
function textPathNet(text:TextData,width:number,height:number):{net:Network;t:number;laterParts:boolean}|string {
  const tp=text.path;
  if (!tp) return CANT;
  if (/[\n\r]/u.test(text.characters)) return LINES;
  let elements:readonly CurveElement[];
  try {elements=parseSvgPath(tp.d,true);} catch {elements=[];}
  const parts:CurveElement[][]=[];
  for (const el of elements) {
    if (el[0]==="M") parts.push([]);
    parts.at(-1)?.push(el);
  }
  const chains=parts.flatMap(part=>pathChain(part) ?? []);
  if (!chains.length) return CANT;
  const {net,cycle}=chains[0];
  if (net.vertices.length+net.segments.length>MAX_NETWORK) return CANT;
  // The reader scales the coordinates by size over normalized size, which are the same number here; an axis of no
  // extent holds nothing but zeros.
  for (const [extent,axis] of [[r(width),0],[r(height),1]] as const) {
    const flat=net.vertices.every(v=>(axis ? v.y : v.x)===0) && net.segments.every(s=>s.ta[axis]===0 && s.tb[axis]===0);
    if (extent<0 || extent<=1e-9 && (extent!==0 || !flat)) return CANT;
  }
  const lengths=net.segments.map(s=>netLength(net,s)),total=lengths.reduce((sum,length)=>sum+length,0);
  if (!Number.isFinite(total) || total<=1e-10) return CANT;
  // The path the reader builds from it must be one the text renderer can measure.
  const shape:CurveElement[]=[];
  for (const [i,s] of net.segments.entries()) {
    const made=netCubic(net,s);
    if (!made) return CANT;
    const [p0,p1,p2,p3]=made.c;
    if (!i) shape.push(["M",p0.x,p0.y]);
    shape.push(made.line ? ["L",p3.x,p3.y] : ["C",p1.x,p1.y,p2.x,p2.y,p3.x,p3.y]);
  }
  if (cycle) shape.push(["Z"]);
  const measured=measurePath(shape);
  if (!measured?.length || !(polylineLength(measured[0])>1e-9)) return CANT;
  // The start, by length, as a parameter of the segment it falls on.
  const start=Number.isFinite(tp.start) ? Math.max(0,Math.min(tp.start,1)) : 0,at=(tp.flip ? 1-start : start)*total;
  let before=0,k=lengths.length-1;
  for (const [i,length] of lengths.entries()) {
    if (before+length>=at) {k=i;break;}
    before+=length;
  }
  if (k+1===lengths.length && before+lengths[k]<at) before=total-lengths[k];
  const local=Math.max(0,Math.min(at-before,lengths[k])),made=netCubic(net,net.segments[k]);
  let t=!made || made.line ? local/lengths[k] : parameterAt(made.c,local);
  t=Number.isFinite(t) ? Math.max(0,Math.min(t,1)) : 0;
  net.segments[k].style=MARK;
  return {net,t,laterParts:chains.length>1};
}

function encode(net:Network) {
  const bytes=new Uint8Array(12+net.vertices.length*12+net.segments.length*28),view=new DataView(bytes.buffer);
  let pos=0;
  const uint=(n:number)=>{view.setUint32(pos,n,true);pos+=4;},float=(n:number)=>{view.setFloat32(pos,finite(n),true);pos+=4;};
  uint(net.vertices.length);uint(net.segments.length);uint(0);
  for (const v of net.vertices) {uint(0);float(v.x);float(v.y);}
  for (const s of net.segments) {uint(s.style);uint(s.a);float(s.ta[0]);float(s.ta[1]);uint(s.b);float(s.tb[0]);float(s.tb[1]);}
  return bytes;
}

/** The fields of a text on a path (its start and its path as a vector network), or nothing when the text stays plain
 * text, with the warning that says why. `main`: for an instance's override row, the main component's layer it follows. */
export function textPathFields(node:LayerNode & {kind:"text"},main:LayerNode|undefined,blobs:FigBlobs):KiwiObject|undefined {
  const own=textPathNet(node.text,node.width,node.height),ok=typeof own!=="string";
  if (main) {
    const mainOk=main.kind==="text" && typeof textPathNet(main.text,main.width,main.height)!=="string";
    if (mainOk!==ok) {
      // An override can't take its layer off the main's path. So an instance text of more than one line, on a main
      // that is on a path, stays on that path in the file: say so rather than the general mismatch.
      blobs.warn(mainOk && own===LINES ? INSTANCE_LINES : INSTANCE);
      return undefined;
    }
  }
  const tp=node.text.path;
  if (!tp) return undefined;
  if (typeof own==="string") {blobs.warn(own);return undefined;}
  const index=blobs.add(encode(own.net));
  if (index===undefined) {blobs.warn(CANT);return undefined;}
  if (own.laterParts) blobs.warn(PARTS);
  return {textPathStart:{tValue:own.t,forward:!tp.flip},vectorData:{vectorNetworkBlob:index,normalizedSize:{x:node.width,y:node.height}}};
}
