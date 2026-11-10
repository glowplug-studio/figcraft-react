// Sibling order in a collaboration replica is sorted by base-62 position, then numeric node ID.
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const minimum = "A" + "0".repeat(26);
const integerSize = (head: string) => head >= "a" ? head.charCodeAt(0) - 95 : 92 - head.charCodeAt(0);

function integer(key: string) {
  const size = integerSize(key[0] ?? "");
  if (!/^[A-Za-z][0-9A-Za-z]+$/.test(key) || key.length < size || key.length > 128
    || key === minimum || (key.length > size && key.endsWith("0"))) {
    throw new Error("invalid position key " + JSON.stringify(key.slice(0, 40)));
  }
  return key.slice(0, size);
}

function neighbour(value: string, direction: 1 | -1) {
  const head = value[0], digits = value.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const n = alphabet.indexOf(digits[i]) + direction;
    if (n >= 0 && n < 62) { digits[i] = alphabet[n]; return head + digits.join(""); }
    digits[i] = direction === 1 ? "0" : "z";
  }
  if (direction === 1 && head === "Z") return "a0";
  if (direction === -1 && head === "a") return "Zz";
  if (direction === 1 && head === "z" || direction === -1 && head === "A") return undefined;
  const next = String.fromCharCode(head.charCodeAt(0) + direction);
  return next + (direction === 1 ? "0" : "z").repeat(integerSize(next) - 1);
}

function fraction(lower: string, upper?: string) {
  let prefix = "";
  while (prefix.length <= 256) {
    if (upper?.length && (lower[0] ?? "0") === upper[0]) {
      prefix += upper[0]; lower = lower.slice(1); upper = upper.slice(1); continue;
    }
    const a = alphabet.indexOf(lower[0] ?? "0");
    const b = upper === undefined ? 62 : alphabet.indexOf(upper[0]);
    if (b <= a) throw new Error("position keys out of order");
    if (b - a > 1) return prefix + alphabet[Math.ceil((a + b) / 2)];
    if (upper && upper.length > 1) return prefix + upper[0];
    prefix += alphabet[a]; lower = lower.slice(1); upper = undefined;
  }
  throw new Error("no position key fits");
}

function between(lower?: string, upper?: string) {
  const a = lower === undefined ? undefined : integer(lower);
  const b = upper === undefined ? undefined : integer(upper);
  if (lower !== undefined && upper !== undefined && lower >= upper) throw new Error("position keys out of order");
  if (a === undefined) {
    if (b === undefined) return "a0";
    if (b === minimum) return b + fraction("", upper!.slice(b.length));
    if (upper!.length > b.length) return b;
    const previous = neighbour(b, -1)!;
    return previous === minimum ? previous + "z" : previous;
  }
  const rest = lower!.slice(a.length);
  if (a === b) return a + fraction(rest, upper!.slice(a.length));
  const next = neighbour(a, 1);
  if (next && (upper === undefined || next < upper)) return next;
  return a + fraction(rest);
}

export function positionKeys(lower: string | undefined, upper: string | undefined, count: number): string[] {
  if (!count) return [];
  if (lower === undefined || upper === undefined) {
    const keys = new Array<string>(count);
    let key = between(lower, upper);
    const backwards = upper !== undefined;
    for (let i = 0; i < count; i++) {
      keys[backwards ? count - i - 1 : i] = key;
      if (i + 1 < count) key = backwards ? between(undefined, key) : between(key);
    }
    return keys;
  }
  const keys: string[] = [];
  function fill(a: string, b: string, n: number) {
    if (!n) return;
    const mid = Math.floor(n / 2), key = between(a, b);
    fill(a, key, mid); keys.push(key); fill(key, b, n - mid - 1);
  }
  fill(lower, upper, count);
  return keys;
}

// A longest increasing subsequence keeps its existing positions. Only the intervening runs
// receive new keys, so adding or moving siblings does not make unrelated layers conflict.
export function siblingPositions(children: readonly string[], old: (id: string) => string | undefined) {
  const original = children.map(old), tail: number[] = [], previous: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const key = original[i];
    if (key === undefined) continue;
    let low = 0, high = tail.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (original[tail[mid]]! < key) low = mid + 1; else high = mid;
    }
    previous[i] = tail[low - 1] ?? -1; tail[low] = i;
  }
  const keep = new Set<number>();
  for (let i = tail.at(-1) ?? -1; i >= 0; i = previous[i]) keep.add(i);
  const result = new Map<string, string>();
  for (let i = 0; i < children.length;) {
    if (keep.has(i)) { result.set(children[i], original[i]!); i++; continue; }
    const start = i;
    while (i < children.length && !keep.has(i)) i++;
    const keys = positionKeys(original[start - 1], original[i], i - start);
    if (keys.some(key => key.length > 48)) {
      const spaced = positionKeys(undefined, undefined, children.length);
      return new Map(children.map((id, index) => [id, spaced[index]]));
    }
    for (let j = start; j < i; j++) result.set(children[j], keys[j - start]);
  }
  return result;
}
