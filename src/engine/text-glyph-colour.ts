import { identity, multiply } from "./affine";
import type { FlowGlyph } from "./text-flow";

/** Bitmap pixels follow the outline warp, while COLR layers inherit the glyph's outline placement. */
export function glyphColour(g:Pick<FlowGlyph,"id" | "face" | "size" | "x" | "y" | "warp">,deviceScale:number) {
  if (!Number.isFinite(deviceScale) || deviceScale<=0 || !g.face.hasColour) return undefined;
  const layers=g.face.colourLayers(g.id);
  if (layers) return {kind:"layers" as const,layers};
  const px=Math.min(512,Math.max(1,Math.round(g.size*deviceScale))), bitmap=g.face.colourBitmap(g.id,px);
  if (!bitmap) return undefined;
  const scale=g.size/px;
  const place=multiply(g.warp ?? identity,[scale,0,0,scale,g.x+bitmap.left*scale,g.y+bitmap.top*scale]);
  return {kind:"bitmap" as const,bitmap,place};
}
