import type { TextFormatCommand } from "./text-format-commands";

type Key = Pick<KeyboardEvent,"code"|"metaKey"|"ctrlKey"|"altKey"|"shiftKey">;
/** Upstream keymap::Text. Use physical punctuation keys even on layouts where Alt produces text. */
const shortcuts: Record<string,TextFormatCommand> = {
  "mKeyB":"text.bold", "mKeyI":"text.italic", "mKeyU":"text.underline", "msKeyX":"text.strikethrough",
  "msDigit8":"text.bulletList", "msDigit7":"text.numberList", "mBracketRight":"text.listIndent", "mBracketLeft":"text.listOutdent",
  "maKeyL":"text.alignLeft", "maKeyT":"text.alignCenter", "maKeyR":"text.alignRight", "maKeyJ":"text.alignJustify",
  "msPeriod":"text.sizeUp", "msComma":"text.sizeDown", "maPeriod":"text.weightUp", "maComma":"text.weightDown",
  "asPeriod":"text.lineHeightUp", "asComma":"text.lineHeightDown", "aPeriod":"text.trackingUp", "aComma":"text.trackingDown",
};
export function textShortcut(key:Key, editing:boolean) {
  const cmd = shortcuts[(key.metaKey || key.ctrlKey ? "m" : "")+(key.altKey ? "a" : "")+(key.shiftKey ? "s" : "")+key.code];
  if (!editing && (cmd === "text.listIndent" || cmd === "text.listOutdent")) return;
  return cmd;
}
