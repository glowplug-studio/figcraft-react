import type { ShapingFace } from "./shaping-face";
import type { TextGraphemes } from "./text-graphemes";

type Coverage = Pick<ShapingFace,"glyphFor" | "hasColour">;
const lineBreak = (cp: number) => cp === 10 || cp === 0x2028;
const emojiHead = (cp: number) => (cp >= 0x1f1e6 && cp <= 0x1f1ff) || (cp >= 0x1f300 && cp <= 0x1faff);
const glyphOptional = (cp: number) => cp === 0x34f || cp === 0x200c || cp === 0x200d ||
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

function clusterFace<F extends Coverage>(chars: readonly string[], start: number, end: number,
  primary: F, emoji: readonly F[], fallbacks: readonly F[]): F {
  const head = chars[start].codePointAt(0)!;
  if (emojiHead(head) && !primary.hasColour) {
    const colour = emoji.find(face => face.glyphFor(head));
    if (colour) return colour;
  }
  const covers = (face: F) => {
    for (let i=start; i<end; i++) {
      const cp = chars[i].codePointAt(0)!;
      if (!glyphOptional(cp) && !face.glyphFor(cp)) return false;
    }
    return true;
  };
  if (lineBreak(head) || covers(primary)) return primary;
  return fallbacks.find(covers) ?? (primary.glyphFor(head) ? primary : fallbacks.find(face=>face.glyphFor(head)) ?? primary);
}

/** Split a style span at native scalar boundaries. A level change can split a grapheme;
 * marks within an uninterrupted grapheme stay with the face that covers the entire cluster. */
export function* fontSegments<F extends Coverage>(chars: readonly string[], boundaries: TextGraphemes,
  start: number, end: number, primary: F, emoji: readonly F[], fallbacks: readonly F[], levels?: ArrayLike<number>) {
  let pos = start;
  while (pos<end) {
    let clusterEnd = boundaries.step(pos,true);
    const face = clusterFace(chars,pos,Math.min(clusterEnd,end),primary,emoji,fallbacks);
    const level = levels?.[pos] ?? 0;
    const first = pos++;
    if (!lineBreak(chars[first].codePointAt(0)!)) {
      while (pos<end && (levels?.[pos] ?? 0) === level && !lineBreak(chars[pos].codePointAt(0)!)) {
        if (pos === clusterEnd) {
          clusterEnd = boundaries.step(pos,true);
          if (clusterFace(chars,pos,Math.min(clusterEnd,end),primary,emoji,fallbacks) !== face) break;
        }
        pos++;
      }
    }
    yield {start:first,end:pos,face,level};
  }
}
