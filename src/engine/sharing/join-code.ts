const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const invalidSymbol = "a join code has only letters and digits (and no U): check it and try again";
const localTypo = "that local network code has a typing mistake: check it and try again";

export type JoinCode =
  | { kind: "online"; code: string }
  | { kind: "local"; link: string };

/** Matches Figcraft's 8 check bits over the 16-byte big-endian local payload. */
function checksum(bits: bigint): number {
  let hash = 0x811c9dc5;
  for (let shift = 120n; shift >= 0n; shift -= 8n) {
    hash = Math.imul(hash ^ Number((bits >> shift) & 255n), 0x01000193);
  }
  return (hash ^ (hash >>> 8) ^ (hash >>> 16) ^ (hash >>> 24)) & 255;
}

export function parseJoinCode(typed: string): JoinCode {
  if (typed.length > 128 || new TextEncoder().encode(typed).length > 128) {
    throw new Error("that is too long to be a join code");
  }
  let symbols = "";
  for (const character of typed) {
    if (/[\p{White_Space}_.–—-]/u.test(character)) continue;
    if (!/^[A-Za-z0-9]$/.test(character)) throw new Error(invalidSymbol);
    const upper = character.toUpperCase();
    const symbol = upper === "O" ? "0" : upper === "I" || upper === "L" ? "1" : upper;
    if (!alphabet.includes(symbol)) throw new Error(invalidSymbol);
    symbols += symbol;
  }
  if (!symbols) throw new Error("type the join code you were given");
  if (symbols.length === 9) return { kind: "online", code: symbols };
  if (symbols.length !== 20) {
    throw new Error(`a join code has 9 characters (20 on the local network); that one has ${symbols.length}`);
  }
  let value = 0n;
  for (const symbol of symbols) value = (value << 5n) | BigInt(alphabet.indexOf(symbol));
  const bits = value >> 8n;
  const ip = Number(bits >> 60n);
  const port = Number((bits >> 44n) & 0xffffn);
  if (!ip || !port || checksum(bits) !== Number(value & 255n)) throw new Error(localTypo);
  const address = [24, 16, 8, 0].map(shift => (ip >>> shift) & 255).join(".");
  const token = (bits & ((1n << 44n) - 1n)).toString(16).padStart(11, "0");
  return { kind: "local", link: `figcraft://join?host=${address}:${port}&file=local&token=local-${token}` };
}

/** Nine Crockford symbols carry the low 45 bits supplied by the issuer. */
export function encodeOnlineJoinCode(random: bigint): string {
  let code = "";
  for (let shift = 40n; shift >= 0n; shift -= 5n) {
    code += alphabet[Number((random >> shift) & 31n)];
  }
  return code;
}

export function groupedJoinCode(code: string): string {
  const width = code.length === 9 ? 3 : 5;
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += width) groups.push(code.slice(index, index + width));
  return groups.join("-");
}
