import type { PathCommand } from "./corners";
import type { VectorNode } from "./document";
import { normaliseBooleanPath } from "./path-boolean";
import { simplifyPath } from "./simplify-path";
import { appendNetwork, freezeNetwork, networkFromPath, type VectorRegion, type VectorSegment, type VectorVertex } from "./vector-network";
import { vectorFillPath, vectorRegionPath, vectorStrokePath } from "./vector-path";
import { hasRegionPaints } from "./vector-presentation";
import { drawnVectorNetwork } from "./vector-rounded";

export function simplifyVector(node: VectorNode, accuracy: number): VectorNode {
  const source=node.network, drawn=drawnVectorNetwork(node);
  const result={vertices:[] as VectorVertex[], segments:[] as VectorSegment[], regions:[] as VectorRegion[]};
  const appendArea=(input: readonly PathCommand[], sourceRegion: VectorRegion, legacy: boolean) => {
    let path=simplifyPath(input,accuracy), winding=sourceRegion.winding;
    // Native simplify keeps the fitted contours and their original winding when normalisation refuses.
    try {
      path=normaliseBooleanPath(path,winding==="evenOdd");
      if (legacy) winding="evenOdd";
    } catch { /* The fitted path remains valid for best-effort drawing. */ }
    const part=networkFromPath(path);
    appendNetwork(result,{...part,regions:part.regions.map(r=>({...sourceRegion,loops:r.loops,winding}))});
  };
  if (source.regions.length && !hasRegionPaints(node)) {
    const winding=source.regions.some(r=>r.winding==="evenOdd") ? "evenOdd" : "nonZero";
    appendArea(vectorFillPath(drawn),{loops:[],winding},true);
  } else {
    source.regions.forEach((region,i)=>{
      const path=vectorRegionPath(drawn,i);
      if (path) appendArea(path,region,false);
    });
  }
  const used=new Uint8Array(source.segments.length);
  for (const region of source.regions) for (const loop of region.loops) for (const index of loop) used[index]=1;
  const segments=source.regions.length ? source.segments.filter((_,i)=>!used[i]) : source.segments;
  if (segments.length) {
    const path=vectorStrokePath({...source,segments,regions:[]});
    const loose=networkFromPath(simplifyPath(path,accuracy));
    appendNetwork(result,{...loose,regions:[]});
  }
  return {...node,network:freezeNetwork(result)};
}
