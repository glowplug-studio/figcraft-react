import {describe,expect,it} from "vitest";
import {isLosslessNumber} from "lossless-json";
import {readNativeJson} from "../../src/engine/native-json";

function chunks(bytes: Uint8Array<ArrayBuffer>, size: number) {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(stream) {
      for (let at=0;at<bytes.length;at+=size) stream.enqueue(bytes.subarray(at,at+size));
      stream.close();
    },
  });
}

const encode = (text: string) => new TextEncoder().encode(text);
describe("streamed native JSON records", () => {
  it.each([1,2,7,63])("decodes split keys, UTF-8, escapes and exact IDs with %i-byte chunks", async size => {
    const name = 'A "curve", {one:two} 🪶 \\';
    const raw = JSON.stringify({nodes:{mask:{name,paths:[[1,2],{"}":true}]}},"__proto__key":name})
      .replace('"mask":', '"18446744073709551615":').replace('"name":','"id":18446744073709551615,"name":');
    const keys: string[] = [];
    const root = await readNativeJson(chunks(encode(raw),size),(id,raw) => {
      keys.push(id);
      const record = raw as {id:unknown;name:unknown};
      expect(isLosslessNumber(record.id) && record.id.value).toBe(id);
      return record.name;
    });
    expect(keys).toEqual(["18446744073709551615"]);
    expect(root.nodes).toEqual({"18446744073709551615":name});
    expect(root.__proto__key).toBe(name);
  });

  it.each(['{"nodes":{"1":{},"1":{}}}', '{"nodes":{},"nodes":{}}', '{"nodes":{"1":{"x":1,"x":2}}}',
    '{"nodes":[], "x":1}', '{"nodes":{}}x', '{"x":1,}', '{"nodes":{"1":false,}}', '{"x":[1,2}', '{"x":{"name":"unfinished}'])(
    "rejects malformed native JSON %s", async raw => {
      await expect(readNativeJson(chunks(encode(raw),3),(_,value)=>value)).rejects.toThrow();
    });

  it("rejects malformed UTF-8 and preserves special property names", async () => {
    const bytes=Uint8Array.of(123,34,120,34,58,34,255,34,125);
    await expect(readNativeJson(chunks(bytes,1),(_,value)=>value)).rejects.toThrow();
    const root=await readNativeJson(chunks(encode('{"__proto__":true,"nodes":{}}'),1),(_,value)=>value);
    expect(Object.getPrototypeOf(root)).toBeNull();
    expect(root.__proto__).toBe(true);
  });
});
