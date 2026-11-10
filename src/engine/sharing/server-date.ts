// Figcraft uses the proleptic Gregorian calendar throughout the u64 range.
export function serverUtcDate(seconds: string) {
  const value = BigInt(seconds);
  const cycle = 146097n * 86400n;
  const instant = new Date(Number(value % cycle) * 1000);
  const year = BigInt(instant.getUTCFullYear()) + (value / cycle) * 400n;
  return year.toString().padStart(4, "0") + instant.toISOString().slice(4, 16).replace("T", " ") + " UTC";
}
