/** Match the native archive reader's nesting, Unicode and finite-number checks before materialising JSON. */
export function archiveJsonText(buffer:ArrayBuffer, context:string):string {
  const bytes=new Uint8Array(buffer), length=bytes.length;
  let at=0;
  function error(message:string,end=Math.min(length,at+1)):never {
    let line=1,start=0;
    for (let i=0;i<end;i++) if (bytes[i]===10) {line++; start=i+1;}
    throw new Error(context+": "+message+" at line "+line+" column "+(end-start));
  }
  function whitespace() {
    while (bytes[at]===32 || bytes[at]===9 || bytes[at]===10 || bytes[at]===13) at++;
  }
  function unicodeEscape() {
    let code=0;
    for (let i=0;i<4;i++) {
      if (at===length) error("EOF while parsing a string");
      const b=bytes[at++], n=b-48, letter=(b|32)-97;
      if (n>=0 && n<10) code=16*code+n;
      else if (letter>=0 && letter<6) code=16*code+letter+10;
      else error("invalid escape",at);
    }
    return code;
  }
  function string() {
    at++;
    while (at<length) {
      const b=bytes[at++];
      if (b===34) return;
      if (b<32) error("control character (\\u0000-\\u001F) found while parsing a string",at);
      if (b===92) {
        if (at===length) error("EOF while parsing a string");
        const escaped=bytes[at++];
        if (escaped===117) {
          const code=unicodeEscape();
          if (code>=0xdc00 && code<=0xdfff) error("lone leading surrogate in hex escape",at);
          if (code>=0xd800 && code<=0xdbff) {
            if (bytes[at++]!==92 || bytes[at++]!==117) error("unexpected end of hex escape",Math.min(at,length));
            const next=unicodeEscape();
            if (next<0xdc00 || next>0xdfff) error("lone leading surrogate in hex escape",at);
          }
        } else if (![34,47,92,98,102,110,114,116].includes(escaped)) error("invalid escape",at);
      } else if (b>=128) {
        const width=b<0xe0 ? 2 : b<0xf0 ? 3 : 4, second=bytes[at];
        if (b<0xc2 || b>0xf4 || b===0xe0 && second<0xa0 || b===0xed && second>=0xa0 ||
            b===0xf0 && second<0x90 || b===0xf4 && second>=0x90) error("invalid unicode code point",at);
        for (let i=1;i<width;i++) {
          if ((bytes[at]&0xc0)!==0x80) error("invalid unicode code point",at);
          at++;
        }
      }
    }
    error("EOF while parsing a string");
  }
  const digit=(b:number)=>b>=48 && b<=57;
  function numeric() {
    const start=at;
    if (bytes[at]===45) at++;
    if (!digit(bytes[at])) error(at===length ? "EOF while parsing a value" : "invalid number");
    if (bytes[at++]===48 && digit(bytes[at])) error("invalid number");
    while (digit(bytes[at])) at++;
    if (bytes[at]===46) {
      at++;
      if (!digit(bytes[at])) error(at===length ? "EOF while parsing a value" : "invalid number");
      while (digit(bytes[at])) at++;
    }
    const exponent=(bytes[at]|32)===101;
    if (exponent) {
      at++;
      if (bytes[at]===43 || bytes[at]===45) at++;
      if (!digit(bytes[at])) error(at===length ? "EOF while parsing a value" : "invalid number");
      while (digit(bytes[at])) at++;
    }
    if ((exponent || at-start>308) && !Number.isFinite(Number(new TextDecoder().decode(bytes.subarray(start,at)))))
      error("number out of range",at);
  }
  function value(depth:number) {
    whitespace();
    const b=bytes[at];
    if (b===34) return string();
    if (b===45 || digit(b)) return numeric();
    if (b===110 || b===116 || b===102) {
      const literal=b===110 ? "null" : b===116 ? "true" : "false";
      for (let i=0;i<literal.length;i++) {
        if (at===length) error("EOF while parsing a value");
        if (bytes[at]!==literal.charCodeAt(i)) error("expected ident");
        at++;
      }
      return;
    }
    if (b!==91 && b!==123) error(at===length ? "EOF while parsing a value" : "expected value");
    if (depth>=127) error("recursion limit exceeded");
    const obj=b===123, end=obj ? 125 : 93, eof="EOF while parsing "+(obj ? "an object" : "a list");
    at++; whitespace();
    if (bytes[at]===end) {at++;return;}
    if (at===length) error(eof);
    for (;;) {
      if (obj) {
        if (bytes[at]!==34) error(at===length ? "EOF while parsing a value" : "key must be a string");
        string(); whitespace();
        if (bytes[at]!==58) error(at===length ? "EOF while parsing an object" : "expected `:`");
        at++;
      }
      value(depth+1); whitespace();
      if (bytes[at]===end) {at++;return;}
      if (bytes[at]!==44) error(at===length ? eof : obj ? "expected `,` or `}`" : "expected `,` or `]`");
      at++; whitespace();
      if (bytes[at]===end) error("trailing comma");
    }
  }
  value(0); whitespace();
  if (at!==length) error("trailing characters");
  return new TextDecoder().decode(bytes);
}
