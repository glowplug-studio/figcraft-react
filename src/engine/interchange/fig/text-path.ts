import type {PathCommand} from "../../corners";
import {cubicLength,type Cubic} from "../../cubic";
import {measurePath,polylineLength} from "../../path-measure";
import {textPathData} from "../../text-path-data";
import {num,obj} from "./fields";
import type {KiwiObject,KiwiValue} from "./kiwi";
import {readNetworkBlob,type NetworkBlob} from "./network-blob";

function orderedSegments(net:NetworkBlob,marked:number) {
  const adjacent:number[][]=Array.from({length:net.vertices.length},()=>[]);
  for (const [i,s] of net.segments.entries()) {
    if (s.a===s.b) throw new Error("path contains a segment that starts and ends at the same vertex");
    adjacent[s.a].push(i);adjacent[s.b].push(i);
  }
  if (adjacent.some(edges=>edges.length>2)) throw new Error("branched path network");
  let endpoints=0,start=-1;
  for (let i=0;i<adjacent.length;i++) if (adjacent[i].length===1) {endpoints++;if (start===-1) start=i;}
  if (endpoints!==0 && endpoints!==2) throw new Error("disconnected or malformed path network");
  const closed=endpoints===0,used=new Uint8Array(net.segments.length);
  const order:{i:number;forward:boolean}[]=[];
  let vertex=closed ? net.segments[marked].a : start;
  for (;;) {
    const next=closed && !order.length ? marked : adjacent[vertex].find(i=>!used[i]);
    if (next===undefined) break;
    const edge=net.segments[next],forward=edge.a===vertex;
    order.push({i:next,forward});used[next]=1;vertex=forward ? edge.b : edge.a;
  }
  if (!used[marked]) throw new Error("disconnected start segment");
  if (order.length!==net.segments.length) throw new Error("disconnected path network");
  if (!closed && !order.find(item=>item.i===marked)!.forward) {
    order.reverse();for (const item of order) item.forward=!item.forward;
  }
  return {order,closed};
}
function convert(net:NetworkBlob,sx:number,sy:number,t:number,forward:boolean) {
  if (!(t>=0 && t<=1)) throw new Error("invalid start parameter");
  if (!(sx>0 && sy>0 && Number.isFinite(sx) && Number.isFinite(sy))) throw new Error("invalid path scale");
  const marker=net.segments.findIndex(s=>s.style===0x01ffffff);
  if (marker<0 || net.segments.some((s,i)=>i!==marker && s.style===0x01ffffff)) throw new Error("missing or ambiguous start segment marker");
  const {order,closed}=orderedSegments(net,marker),path:PathCommand[]=[];
  let total=0,offset=0;
  for (const use of order) {
    const edge=net.segments[use.i],a=net.vertices[edge.a],b=net.vertices[edge.b];
    const curve:Cubic=[{x:a.x*sx,y:a.y*sy},{x:a.x*sx+edge.ta.x*sx,y:a.y*sy+edge.ta.y*sy},
      {x:b.x*sx+edge.tb.x*sx,y:b.y*sy+edge.tb.y*sy},{x:b.x*sx,y:b.y*sy}];
    const [p,c,d,q]=use.forward ? curve : [curve[3],curve[2],curve[1],curve[0]];
    if (!path.length) path.push(["M",p.x,p.y]);
    const line=p.x===c.x && p.y===c.y && d.x===q.x && d.y===q.y;
    path.push(line ? ["L",q.x,q.y] : ["C",c.x,c.y,d.x,d.y,q.x,q.y]);
    const length=line ? Math.hypot(q.x-p.x,q.y-p.y) : cubicLength(curve,1,1e-9);
    if (!Number.isFinite(length) || length<=1e-10) throw new Error("zero-length path segment");
    if (use.i===marker) offset=total+(line ? length*t : cubicLength(curve,t,1e-9));
    total+=length;
  }
  if (closed) path.push(["Z"]);
  const measured=measurePath(path);
  if (!measured?.length || polylineLength(measured[0])<=1e-9) throw new Error("cannot be measured by text renderer");
  const start=Math.min(1,Math.max(0,offset/total));
  return {d:textPathData(path),start:forward ? start : 1-start,flip:!forward};
}
export function figTextPath(n:KiwiObject,blobs:(KiwiValue|undefined)[],warn:(reason:string)=>void) {
  const fail=(s:string)=>{warn("text path "+s+"; text imports off its path");return undefined;};
  if (n.textPathStart===undefined) return fail("has no start data");
  const start=obj(n.textPathStart),t=num(start.tValue);
  if (t===undefined || typeof start.forward!=="boolean") return fail("has invalid start data");
  if (n.vectorData===undefined) return fail("has no vector data");
  const data=obj(n.vectorData),index=num(data.vectorNetworkBlob),bytes=index===undefined ? undefined : blobs[index];
  if (!(bytes instanceof Uint8Array)) return fail("has no vector network");
  const net=readNetworkBlob(bytes);
  if (!net) return fail("has damaged vector data");
  if (data.normalizedSize===undefined) return fail("has invalid normalized size");
  const axis=(name:"x"|"y")=>{
    const size=num(obj(n.size)[name]),norm=num(obj(data.normalizedSize)[name]);
    if (size===undefined || norm===undefined) return;
    if (size>0 && norm>1e-9) return size/norm;
    if (size===0 && norm>=0 && norm<=1e-9 && net.vertices.every(v=>v[name]===0) && net.segments.every(s=>s.ta[name]===0 && s.tb[name]===0)) return 1;
    return NaN;
  };
  const sx=axis("x"),sy=axis("y");
  if (sx===undefined || sy===undefined) return fail("has invalid dimensions");
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return fail("has invalid path scale");
  if (typeof n.textAlignVertical==="string" && n.textAlignVertical!=="TOP") return fail("uses unsupported vertical placement");
  const characters=obj(n.textData).characters;
  if (typeof characters==="string" && /[\r\n]/u.test(characters)) return fail("contains multiple lines");
  try {return convert(net,sx,sy,t,start.forward);} catch (e) {
    if (!(e instanceof Error)) throw e;
    return fail(e.message);
  }
}
