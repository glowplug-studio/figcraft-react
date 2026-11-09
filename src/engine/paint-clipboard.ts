import { arrangementTargets } from "./arrange";
import type { Document, NodeId } from "./document";
import { checkPatternTarget } from "./pattern-sources";
import { writeFill } from "./fill-commands";
import { HierarchyDraft } from "./hierarchy";
import { withImageResource } from "./image-import";
import type { ImageResource } from "./image-resource";
import type { Paint } from "./solid-paint";
import type { StrokeProps } from "./stroke";
import { executeStrokeList } from "./stroke-commands";
import type { VectorEditState } from "./vector-edit";

export interface CopiedPaint {
  list: "fill" | "stroke";
  paint: Paint;
  image?: ImageResource;
  documentIdentity?: symbol;
  stroke?: StrokeProps;
}

function restoreImage(document: Document, copied: CopiedPaint) {
  const paint = copied.paint, image = copied.image;
  if (paint.type !== "image" || !image) return {document, paint};
  const images = document.images ?? {};
  const occupied = (key: string): boolean => {
    if (!Object.hasOwn(images,key)) return false;
    const existing = images[key];
    return existing !== image && !(image.digest && existing.digest === image.digest &&
      existing.width === image.width && existing.height === image.height);
  };
  let key = paint.image;
  if (occupied(key)) {
    if (!image.digest) throw new Error("The copied image has no content digest");
    key = image.digest;
    for (let suffix = 1; occupied(key); suffix++) {
      if (suffix > 999) throw new Error("No free image key for the copied image");
      key = image.digest + suffix;
    }
  }
  return {
    document: Object.hasOwn(images,key) ? document : withImageResource(document,{hash:key,resource:image}),
    paint: key === paint.image ? paint : Object.freeze({...paint, image:key}),
  };
}

export function pastePaint(list: CopiedPaint["list"], document: Document, selection: readonly NodeId[],
  params: Record<string,unknown>, copied: CopiedPaint | undefined, state?: VectorEditState, documentIdentity?: symbol): Document {
  if (!copied) throw new Error("No copied " + list);
  if (copied.list !== list) throw new Error("The copied paint is a " + copied.list);
  if (copied.paint.type === "pattern") {
    if (!documentIdentity || copied.documentIdentity !== documentIdentity) throw new Error("A pattern can't be pasted into another file");
    checkPatternTarget(document, arrangementTargets(document,selection,params,false), copied.paint.source);
  }
  const target = restoreImage(document,copied);
  if (list === "fill") return writeFill("fill.paste", target.document, selection, params, state, target.paint);
  const ids = arrangementTargets(document,selection,params,false);
  const action = params.index == null ? "stroke.add" : "stroke.set";
  const changed = executeStrokeList(action,target.document,ids,{ids,index:params.index,paint:target.paint});
  const draft = new HierarchyDraft(changed);
  for (const id of ids) {
    const node = draft.nodes[id];
    if (node.kind !== "page" && node.stroke !== copied.stroke) draft.set({...node,stroke:copied.stroke});
  }
  return draft.finish();
}
