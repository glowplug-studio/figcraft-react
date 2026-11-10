import { expect, it } from "vitest";
import { decodeFigCanvas } from "../../src/engine/interchange/fig/canvas";
import { readKiwiMessage, readKiwiSchema } from "../../src/engine/interchange/fig/kiwi";
import corpus from "../fixtures/native-fig-containers.json";

it.each(corpus)("reads the native Fig canvas container for $name", async ({data, response}) => {
  const bytes = Uint8Array.from(Buffer.from(data, "base64"));
  const decoded = decodeFigCanvas(bytes, bytes.length);
  if (response.error) {
    await expect(decoded).rejects.toThrow(response.error);
  } else {
    const msg = await decoded;
    expect(msg).toHaveProperty("nodeChanges");
    const changes = (msg as {nodeChanges: {type: string}[]}).nodeChanges;
    expect(changes.filter(c => !["CANVAS", "DOCUMENT"].includes(c.type))).toHaveLength(response.summary!.layers);
  }
});

const str = (s: string) => [...new TextEncoder().encode(s), 0];
const messageSchema = (...fields: number[][]) => readKiwiSchema(Uint8Array.from([
  1, ...str("Message"), 2, fields.length, ...fields.flat(),
]));
it("preserves signed and unsigned 64-bit integer limits and the first duplicate field", () => {
  const schema = messageSchema([...str("__proto__"), 15, 0, 1], [...str("signed"), 13, 0, 2]);
  const max = Array(9).fill(255);
  const result = readKiwiMessage(schema, Uint8Array.from([1, ...max, 2, ...max, 1, 0, 0]), 4);
  expect(Object.getPrototypeOf(result)).toBe(null);
  expect(result).toHaveProperty("__proto__", (1n << 64n) - 1n);
  expect(result).toHaveProperty("signed", -(1n << 63n));
});
it("stops at the native recursion depth and charges for empty arrays", () => {
  const recursive = messageSchema([...str("child"), 0, 0, 1]);
  const depth = (n: number) => Uint8Array.from([...Array(n).fill(1), ...Array(n + 1).fill(0)]);
  expect(() => readKiwiMessage(recursive, depth(64), 100)).not.toThrow();
  expect(() => readKiwiMessage(recursive, depth(65), 100)).toThrow("nested too deeply");
  const arrays = messageSchema([...str("items"), 7, 1, 1]);
  expect(() => readKiwiMessage(arrays, Uint8Array.of(1, 0, 1, 0, 0), 2)).toThrow("too many values");
  expect(() => readKiwiMessage(arrays, Uint8Array.of(1, 3, 0), 20)).toThrow("array longer than the data");
});
