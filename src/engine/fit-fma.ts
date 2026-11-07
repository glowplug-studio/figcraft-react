const bits = new DataView(new ArrayBuffer(8));
/** Exact finite binary64 decomposition, used only by the completion-time curve fitter. */
function binary(value: number): readonly [bigint, number] {
  bits.setFloat64(0, value); const raw = bits.getBigUint64(0), exponent = Number((raw >> 52n) & 2047n);
  const magnitude = (raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return [raw >> 63n ? -magnitude : magnitude, exponent ? exponent - 1075 : -1074];
}

/** One correctly rounded product-plus-sum, matching Rust f64::mul_add without a Rust runtime.
 * Near repeated cubic roots lose required accuracy with separate JavaScript multiply/add. */
export function fitMultiplyAdd(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return a * b + c;
  // The exact product of two finite operands is finite, even when binary64 multiplication overflows.
  if (!Number.isFinite(c)) return c;
  const [am, ae] = binary(a), [bm, be] = binary(b), [cm, ce] = binary(c), productExponent = ae + be;
  const exponent = Math.min(productExponent, ce);
  const integer = (am * bm << BigInt(productExponent - exponent)) + (cm << BigInt(ce - exponent));
  if (!integer) return 0;
  const negative = integer < 0n, magnitude = negative ? -integer : integer;
  const width = magnitude.toString(2).length, quantum = Math.max(exponent + width - 53, -1074), shift = quantum - exponent;
  let rounded: bigint;
  if (shift > 0) {
    const count = BigInt(shift), halfway = 1n << (count - 1n), remainder = magnitude & ((1n << count) - 1n);
    rounded = magnitude >> count;
    if (remainder > halfway || (remainder === halfway && (rounded & 1n))) rounded++;
  } else rounded = magnitude << BigInt(-shift);
  const result = Number(rounded) * 2 ** quantum;
  return negative ? -result : result;
}
