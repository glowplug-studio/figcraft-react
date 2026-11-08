// ITU-T T.4 terminating and make-up codewords used by the TIFF T.6 horizontal mode.
// Array order gives the run length: 0..63, then multiples of 64.
const whiteTerms = [
  "00110101", "000111", "0111", "1000", "1011", "1100", "1110", "1111",
  "10011", "10100", "00111", "01000", "001000", "000011", "110100", "110101",
  "101010", "101011", "0100111", "0001100", "0001000", "0010111", "0000011", "0000100",
  "0101000", "0101011", "0010011", "0100100", "0011000", "00000010", "00000011", "00011010",
  "00011011", "00010010", "00010011", "00010100", "00010101", "00010110", "00010111", "00101000",
  "00101001", "00101010", "00101011", "00101100", "00101101", "00000100", "00000101", "00001010",
  "00001011", "01010010", "01010011", "01010100", "01010101", "00100100", "00100101", "01011000",
  "01011001", "01011010", "01011011", "01001010", "01001011", "00110010", "00110011", "00110100",
];
const blackTerms = [
  "0000110111", "010", "11", "10", "011", "0011", "0010", "00011",
  "000101", "000100", "0000100", "0000101", "0000111", "00000100", "00000111", "000011000",
  "0000010111", "0000011000", "0000001000", "00001100111", "00001101000", "00001101100", "00000110111", "00000101000",
  "00000010111", "00000011000", "000011001010", "000011001011", "000011001100", "000011001101", "000001101000", "000001101001",
  "000001101010", "000001101011", "000011010010", "000011010011", "000011010100", "000011010101", "000011010110", "000011010111",
  "000001101100", "000001101101", "000011011010", "000011011011", "000001010100", "000001010101", "000001010110", "000001010111",
  "000001100100", "000001100101", "000001010010", "000001010011", "000000100100", "000000110111", "000000111000", "000000100111",
  "000000101000", "000001011000", "000001011001", "000000101011", "000000101100", "000001011010", "000001100110", "000001100111",
];
const whiteMakeup = [
  "11011", "10010", "010111", "0110111", "00110110", "00110111", "01100100", "01100101",
  "01101000", "01100111", "011001100", "011001101", "011010010", "011010011", "011010100", "011010101",
  "011010110", "011010111", "011011000", "011011001", "011011010", "011011011", "010011000", "010011001",
  "010011010", "011000", "010011011",
];
const blackMakeup = [
  "0000001111", "000011001000", "000011001001", "000001011011", "000000110011", "000000110100", "000000110101", "0000001101100",
  "0000001101101", "0000001001010", "0000001001011", "0000001001100", "0000001001101", "0000001110010", "0000001110011", "0000001110100",
  "0000001110101", "0000001110110", "0000001110111", "0000001010010", "0000001010011", "0000001010100", "0000001010101", "0000001011010",
  "0000001011011", "0000001100100", "0000001100101",
];
const commonMakeup = [
  "00000001000", "00000001100", "00000001101", "000000010010", "000000010011", "000000010100", "000000010101", "000000010110",
  "000000010111", "000000011100", "000000011101", "000000011110", "000000011111",
];

function runTable(terms: string[], makeup: string[]) {
  // The leading 1 preserves the number of high zero bits in a codeword.
  const table = new Map<number, number>();
  terms.forEach((code, index) => table.set(parseInt("1"+code, 2), index));
  [...makeup, ...commonMakeup].forEach((code, index) => table.set(parseInt("1"+code, 2), (index+1)*64));
  return table;
}
const tables = [runTable(whiteTerms,whiteMakeup),runTable(blackTerms,blackMakeup)];

/** Decode exactly the requested T.6 rows, relative to the previous all-white or decoded row. */
export async function decodeFax4(input: Uint8Array, width: number, height: number, reverse: boolean) {
  if (width > 65535) throw new Error("Group 4 TIFF row exceeds the native width limit");
  const rowBytes = Math.ceil(width/8), result = new Uint8Array(rowBytes*height);
  let bit = 0;
  function nextBit() {
    if (bit >= input.length*8) throw new Error("Truncated Group 4 TIFF");
    const at = bit++;
    return (input[at>>>3] >>> (reverse ? at%8 : 7-at%8)) & 1;
  }
  function lengthOf(colour: number) {
    let length = 0;
    for (;;) {
      let code = 1;
      do {
        code = code*2 + nextBit();
        if (code >= 1<<14) throw new Error("Invalid Group 4 TIFF run code");
      } while (!tables[colour].has(code));
      const run = tables[colour].get(code)!;
      length += run;
      if (length > width) throw new Error("Group 4 TIFF run exceeds row width");
      if (run < 64) return length;
    }
  }
  let work = 0;
  let reference: number[] = [];
  for (let row=0; row<height; row++) {
    const changes: number[] = [];
    let x=0, colour=0, initial=true;
    function paint(to: number) {
      if (to < x || to > width) throw new Error("Invalid Group 4 TIFF row");
      if (colour) {
        const base = row*rowBytes;
        while (x<to && x%8) { result[base+(x>>>3)] |= 128 >>> (x%8); x++; }
        const whole = to-(to%8);
        if (x<whole) { result.fill(255,base+(x>>>3),base+(whole>>>3)); x=whole; }
        while (x<to) { result[base+(x>>>3)] |= 128 >>> (x%8); x++; }
      } else x=to;
    }
    function switchAt(to: number) { paint(to); changes.push(to); colour ^= 1; }
    while (x<width) {
      let zeros=0;
      while (!nextBit()) if (++zeros>6) throw new Error("Unsupported or premature Group 4 TIFF end code");
      if (zeros===2) {
        switchAt(x+lengthOf(colour));
        switchAt(x+lengthOf(colour));
      } else {
        let low=0, high=reference.length;
        while (low<high) {
          const mid=(low+high)>>>1;
          if (reference[mid] <= (initial ? -1 : x)) low=mid+1;
          else high=mid;
        }
        if ((low%2)!==colour) low++;
        const b1 = reference[low] ?? width;
        if (zeros===3) paint(reference[low+1] ?? width); // 0001: pass
        else {
          // V(0)=1, VR/VL(1)=011/010, VR/VL(2)=000011/000010, VR/VL(3)=0000011/0000010.
          if (zeros===6) throw new Error("Unsupported Group 4 TIFF extension");
          const distance = zeros===0 ? 0 : zeros===1 ? 1 : zeros===4 ? 2 : 3;
          const offset = distance && (nextBit() ? distance : -distance);
          switchAt(b1+offset);
        }
      }
      initial=false;
      if (changes.length>width+2) throw new Error("Too many Group 4 TIFF transitions");
    }
    reference=changes;
    work += width;
    if (work >= 262144) {
      work = 0;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  return result;
}
