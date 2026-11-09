import { scalarCount } from "./text-ranges";

const segmenter = new Intl.Segmenter("und",{granularity:"grapheme"});
const asciiWithoutCR = /^[\x00-\x0c\x0e-\x7f]*$/;
const alphabetic = /\p{Alphabetic}/u;

/** Whether a scalar joins a preceding plain letter in one extended grapheme. */
export function extendsLetter(char: string) {
  return segmenter.segment("a"+char).containing(0)?.segment.length === 1+char.length;
}

/** Native caret positions are scalar indices. Keep the boundary and UTF-16 offsets
 * with the layout so successive key presses do not rescan the whole paragraph. */
export class TextGraphemes {
  readonly length: number;
  readonly #text: string;
  readonly #offsets?: Uint32Array;
  readonly #starts?: Uint8Array;

  constructor(text: string) {
    this.#text = text;
    if (asciiWithoutCR.test(text)) {
      this.length = text.length;
      return;
    }
    this.length = scalarCount(text);
    const offsets = this.#offsets = new Uint32Array(this.length+1);
    const starts = this.#starts = new Uint8Array(this.length+1);
    let scalar = 0;
    for (const {segment,index} of segmenter.segment(text)) {
      starts[scalar] = 1;
      let pos = index;
      for (const char of segment) {
        offsets[scalar++] = pos;
        pos += char.length;
      }
    }
    offsets[scalar] = text.length;
    starts[scalar] = 1;
  }

  isBoundary(index: number) {
    return Number.isInteger(index) && index >= 0 && index <= this.length && (!this.#starts || this.#starts[index] === 1);
  }

  step(index: number, forward: boolean) {
    if (index > this.length) return this.length;
    if (!Number.isFinite(index)) return 0;
    const step = forward ? 1 : -1;
    let at = Math.max(0,Math.min(this.length,Math.trunc(index)+step));
    while (this.#starts && !this.#starts[at]) at += step;
    return at;
  }

  backspace(index: number) {
    const end = Number.isNaN(index) ? 0 : Math.max(0,Math.min(this.length,Math.trunc(index)));
    const start = this.step(end,false);
    const offsets = this.#offsets;
    if (!offsets || end-start <= 1) return start;
    const head = this.#text.slice(offsets[start],offsets[start+1]);
    const tail = this.#text.slice(offsets[end-1],offsets[end]);
    return alphabetic.test(head) && tail !== "\u200d" && extendsLetter(tail) ? end-1 : start;
  }
}
