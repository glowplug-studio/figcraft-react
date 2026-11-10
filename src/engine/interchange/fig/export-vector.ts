import type {VectorNode} from "../../document";
import {defaultStroke} from "../../stroke";
import {vectorFillPath} from "../../vector-path";
import {drawnVectorNetwork} from "../../vector-rounded";
import type {FigBlobs} from "./export-geometry";
import {wireCap} from "./export-paint";
import type {KiwiObject} from "./kiwi";
export function writeVector(out:KiwiObject,node:VectorNode,blobs:FigBlobs) {
  const {vertices,segments,regions}=node.network;
  if (regions.some(r=>r.fills || r.paintSpace)) blobs.warn("vector region paints were left out of the .fig export");
  let loops=0,entries=0;
  for (const r of regions) {loops+=r.loops.length;for (const loop of r.loops) entries+=loop.length;}
  if (vertices.length+segments.length+entries>200000) blobs.warn("vector networks too large for the format were written as outlines");
  else {
    const bytes=new Uint8Array(12+vertices.length*12+segments.length*28+regions.length*8+(loops+entries)*4);
    const view=new DataView(bytes.buffer);let pos=0;
    const uint=(n:number)=>{view.setUint32(pos,n,true);pos+=4;};
    const float=(n:number)=>{view.setFloat32(pos,Number.isFinite(n) ? Math.min(1e30,Math.max(-1e30,n)) : 0,true);pos+=4;};
    uint(vertices.length);uint(segments.length);uint(regions.length);
    const degree=new Uint32Array(vertices.length);
    for (const s of segments) {degree[s.a]++;degree[s.b]++;}
    const first=degree.indexOf(1),last=degree.lastIndexOf(1),sp=node.stroke ?? defaultStroke;
    const caps=sp.capStart!==sp.capEnd || vertices.some(v=>v.cap!==undefined);
    const indices=new Map<string,number>(),styles:KiwiObject[]=[];
    for (const [i,v] of vertices.entries()) {
      const cap=v.cap ?? (caps ? i===first ? sp.capStart : i===last ? sp.capEnd : undefined : undefined);
      const fields:KiwiObject={...(v.radius>0 && {cornerRadius:v.radius}),...(v.mirror && {handleMirroring:v.mirror==="angleAndLength" ? "ANGLE_AND_LENGTH" : v.mirror.toUpperCase()}),
        ...(cap && {strokeCap:wireCap(cap)}),...(v.join && {strokeJoin:v.join.toUpperCase()})};
      let id=0;
      if (Object.keys(fields).length) {
        const key=JSON.stringify(fields);
        id=indices.get(key) ?? styles.length+1;
        if (!indices.has(key)) {indices.set(key,id);styles.push({styleID:id,...fields});}
      }
      uint(id);float(v.x);float(v.y);
    }
    for (const s of segments) {uint(0);uint(s.a);float(s.ta[0]);float(s.ta[1]);uint(s.b);float(s.tb[0]);float(s.tb[1]);}
    for (const r of regions) {uint(Number(r.winding==="nonZero"));uint(r.loops.length);for (const loop of r.loops) {uint(loop.length);for (const edge of loop) uint(edge);}}
    const index=blobs.add(bytes);
    if (index!==undefined) out.vectorData={vectorNetworkBlob:index,normalizedSize:{x:node.width,y:node.height},styleOverrideTable:styles};
  }
  if (regions.length) {
    const first=regions[0].winding;
    if (regions.some(r=>r.winding!==first)) blobs.warn("vectors whose filled areas use different winding rules use the first one's in their outline");
    blobs.path(out,"fillGeometry",vectorFillPath(drawnVectorNetwork(node)),first==="evenOdd");
  }
}
