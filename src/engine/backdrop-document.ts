import { isFrameLike, isLeaf, type Document, type DocumentNode } from "./document";

/**
 * Native render/src/backdrop.rs `hide_above`: the document as it is under layer `id`, for what a background blur or
 * glass in it reads. `id` and everything painted after it are hidden: later siblings at each ancestor in paint order
 * (reversed auto layout included) and, at the level of `roots`, the roots after the one holding `id`. Ancestor strokes,
 * which would paint over the children, are cleared.
 */
export function beneathDocument(doc:Document, roots:readonly string[], id:string):Document {
  const nodes:Record<string,DocumentNode>={...doc.nodes};
  function hide(key:string) {
    const n=nodes[key];
    if (n && n.kind!=="page") nodes[key]={...n,visible:false};
  }
  hide(id);
  let current=id;
  for (let depth=0;depth<=256;depth++) {
    const root=roots.indexOf(current);
    if (root>=0) { for (let i=root+1;i<roots.length;i++) hide(roots[i]); break; }
    const parentId=nodes[current]?.parent;
    if (!parentId) break;
    const p=nodes[parentId];
    if (!p || isLeaf(p)) break;
    const siblings=p.children, index=siblings.indexOf(current);
    if (index>=0) {
      if (isFrameLike(p) && p.layout?.reverseZ) { for (let i=0;i<index;i++) hide(siblings[i]); }
      else for (let i=index+1;i<siblings.length;i++) hide(siblings[i]);
    }
    nodes[parentId]={...p,strokes:[]};
    current=parentId;
  }
  return {...doc,nodes};
}
